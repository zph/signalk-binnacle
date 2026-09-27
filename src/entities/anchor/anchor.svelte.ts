import type { OwnVessel } from '$entities/vessel';
import { asNumber, isLatLon, type LatLon } from '$shared/geo';
import { HeldFlag, isFiniteNumber, isRecord, type ReactiveClock } from '$shared/lib';
import { haversineMeters, rhumbBearingRad } from '$shared/nav';
import { binnacleStorageKey } from '$shared/persistence';
import {
  boundedNumberPersistedCodec,
  exactShapeCodec,
  PersistedValue,
  type StorageLike,
} from '$shared/settings';
import {
  isSoundingNotification,
  notificationState,
  predatesReconnect,
  type SignalKStore,
  SK_PATHS,
} from '$shared/signalk';
import { DEFAULT_RADIUS_M, MIN_RADIUS_M } from './anchor-geometry';
import { type AnchorZone, distanceToZoneBoundaryMeters, parseAnchorZone } from './anchor-zone';
// The anchor watch is never browser-only. A server position on the stream is the sole active mode.
export type AnchorMode = 'off' | 'server';
export type AnchorDegradedCause = 'server-stale';

// How long server-state staleness must persist before it is reported as a cause: the worker bumps
// the store generation on every socket open, so each reconnect reads as stale for the sub-second
// window until the resubscribed anchor cells re-arrive, and reporting that blip would raise a
// false alert on every reconnect. Without a clock the cause reports immediately.
const SERVER_STALE_GRACE_MS = 5_000;

// Only used to recognize and retire an old browser-only watch on upgrade. Its position must never
// be silently promoted to a server watch, because it may be stale.
interface LegacyLocalAnchor {
  position: LatLon;
  radiusMeters: number;
  dragging: boolean;
}

export const MAX_ANCHOR_RADIUS_M = 1_000_000;

function clampRadius(radiusMeters: number): number {
  return Math.min(MAX_ANCHOR_RADIUS_M, Math.max(MIN_RADIUS_M, radiusMeters));
}

function validLocal(value: unknown): LegacyLocalAnchor | null {
  if (!isRecord(value)) return null;
  if (!isLatLon(value.position)) return null;
  if (
    !isFiniteNumber(value.radiusMeters) ||
    value.radiusMeters < MIN_RADIUS_M ||
    value.radiusMeters > MAX_ANCHOR_RADIUS_M
  ) {
    return null;
  }
  // Rebuilt as a clean literal: spreading the raw localStorage object would re-persist any
  // unknown extra properties forever.
  return {
    position: { latitude: value.position.latitude, longitude: value.position.longitude },
    radiusMeters: value.radiusMeters,
    dragging: value.dragging === true,
  };
}

function isExactAnchorShape(value: unknown): boolean {
  return (
    isRecord(value) &&
    isRecord(value.position) &&
    Object.keys(value).length === 3 &&
    Object.keys(value.position).length === 2 &&
    typeof value.dragging === 'boolean'
  );
}

const localAnchorCodec = exactShapeCodec(validLocal, isExactAnchorShape);

// The anchor watch state machine. Server mode is fully stream-driven: the plugin's
// navigation.anchor.position and maxRadius cells are the source of truth, and its
// notifications.navigation.anchor grades the drag alarm. A legacy browser-only watch is discarded
// with a visible warning; only the preferred radius remains as a local setting.
export class AnchorWatch {
  #store: SignalKStore;
  #vessel: OwnVessel;
  #preferredRadius: PersistedValue<number>;
  #retiredLocalWatch = $state(false);
  // The notification state string the navigator acknowledged, so the sound stays off while the
  // server keeps reporting that same grade; an escalation (a new state) sounds again.
  #ackState = $state<string | undefined>(undefined);
  // The server-stale grace, constructed with the clock; undefined without one.
  #staleHeld: HeldFlag | undefined;

  constructor(
    store: SignalKStore,
    vessel: OwnVessel,
    clock?: ReactiveClock,
    storage?: StorageLike,
  ) {
    this.#store = store;
    this.#vessel = vessel;
    // Without a clock the stale cause reports immediately; the graced flag needs one to count.
    this.#staleHeld = clock
      ? new HeldFlag(clock, SERVER_STALE_GRACE_MS, () => this.#serverStateStale)
      : undefined;
    const oldWatch = new PersistedValue<LegacyLocalAnchor | null>(
      binnacleStorageKey('anchorWatch'),
      null,
      storage,
      localAnchorCodec,
    );
    if (oldWatch.value !== null) {
      this.#retiredLocalWatch = true;
      oldWatch.set(null);
    }
    this.#preferredRadius = new PersistedValue<number>(
      binnacleStorageKey('anchorRadius'),
      DEFAULT_RADIUS_M,
      storage,
      boundedNumberPersistedCodec(MIN_RADIUS_M, MAX_ANCHOR_RADIUS_M),
    );
    // Pre-create the cells this watch reads, so the first reactive read finds a tracked cell
    // (see OwnVessel for the lazily-created-cell pitfall).
    store.ensureCells([
      SK_PATHS.anchorPosition,
      SK_PATHS.anchorMaxRadius,
      SK_PATHS.anchorWatchZone,
      SK_PATHS.anchorNotification,
    ]);
  }

  #serverPosition = $derived.by<LatLon | undefined>(() => {
    const value = this.#currentRaw(SK_PATHS.anchorPosition);
    return isLatLon(value) ? value : undefined;
  });

  #serverRadius = $derived.by<number | undefined>(() =>
    asNumber(this.#currentRaw(SK_PATHS.anchorMaxRadius)),
  );

  #serverZone = $derived.by<AnchorZone | undefined>(() =>
    parseAnchorZone(this.#currentRaw(SK_PATHS.anchorWatchZone)),
  );

  #serverStateStale = $derived.by<boolean>(() => {
    const cell = this.#store.cell(SK_PATHS.anchorPosition);
    const radiusCell = this.#store.cell(SK_PATHS.anchorMaxRadius);
    const zoneCell = this.#store.cell(SK_PATHS.anchorWatchZone);
    return (
      isLatLon(cell.value) &&
      (this.#store.connection.phase !== 'open' ||
        predatesReconnect(cell, this.#store.generation) ||
        (asNumber(radiusCell.value) !== undefined &&
          predatesReconnect(radiusCell, this.#store.generation)) ||
        (parseAnchorZone(zoneCell.value) !== undefined &&
          predatesReconnect(zoneCell, this.#store.generation)))
    );
  });

  #notificationState = $derived.by<string | undefined>(() =>
    notificationState(this.#raw(SK_PATHS.anchorNotification)),
  );

  #serverDragging = $derived.by<boolean>(() =>
    isSoundingNotification(this.#raw(SK_PATHS.anchorNotification)),
  );

  get mode(): AnchorMode {
    return this.#serverPosition || this.#serverStateStale ? 'server' : 'off';
  }

  get watching(): boolean {
    return this.mode !== 'off';
  }

  get retiredLocalWatch(): boolean {
    return this.#retiredLocalWatch && !this.watching;
  }

  // A lost local GPS fix makes this display's distance unavailable, but the server alarm continues.
  get fixLost(): boolean {
    return this.watching && (!this.#vessel.position || this.#vessel.positionStale);
  }

  get degraded(): boolean {
    return this.#serverStateStale;
  }

  // Why the watch is degraded. The
  // server-stale cause waits out a short grace so a reconnect's routine sub-second blip never
  // reaches a live region or panel; immediateDegradedCause skips the grace for surfaces that
  // must not show reassuring text over untrusted geometry, and `degraded` stays immediate too.
  get degradedCause(): AnchorDegradedCause | undefined {
    if (this.#staleHeld ? this.#staleHeld.held : this.#serverStateStale) return 'server-stale';
    return undefined;
  }

  // The same classification without the server-stale grace, for panels (not live regions) that
  // word the state the moment it exists.
  get immediateDegradedCause(): AnchorDegradedCause | undefined {
    if (this.#serverStateStale) return 'server-stale';
    return undefined;
  }

  get position(): LatLon | undefined {
    return this.mode === 'server' && !this.degraded ? this.#serverPosition : undefined;
  }

  // A read-only, in-memory copy of the last server position. It is never promoted to a new watch
  // or used for browser-side drag detection during an outage.
  get lastKnownPosition(): LatLon | undefined {
    if (!this.degraded) return undefined;
    const value = this.#raw(SK_PATHS.anchorPosition);
    return isLatLon(value) ? value : undefined;
  }

  // The active watch radius in meters, or undefined when off (or when a server watch has not
  // published its radius yet, so no circle is drawn for it).
  get radiusMeters(): number | undefined {
    return this.mode === 'server' && !this.degraded ? this.#serverRadius : undefined;
  }

  get zone(): AnchorZone | undefined {
    if (this.mode !== 'server' || this.degraded) return undefined;
    return (
      this.#serverZone ??
      (this.#serverRadius ? { type: 'circle', radius: this.#serverRadius } : undefined)
    );
  }

  get lastKnownZone(): AnchorZone | undefined {
    if (!this.degraded) return undefined;
    return (
      parseAnchorZone(this.#raw(SK_PATHS.anchorWatchZone)) ??
      (this.lastKnownRadiusMeters
        ? { type: 'circle', radius: this.lastKnownRadiusMeters }
        : undefined)
    );
  }

  get lastKnownRadiusMeters(): number | undefined {
    if (!this.degraded) return undefined;
    return asNumber(this.#raw(SK_PATHS.anchorMaxRadius));
  }

  get lastKnownAt(): number | undefined {
    if (!this.degraded) return undefined;
    const epoch = this.#store.cell(SK_PATHS.anchorPosition).epoch;
    return epoch > 0 ? epoch : undefined;
  }

  // The radius the next drop starts from: the last radius the navigator set, on any watch.
  get preferredRadiusMeters(): number {
    return this.#preferredRadius.value;
  }

  // Live distance from the anchor to the boat, in meters. A $derived so the haversine runs once
  // per position change, not on every read (the strip, panel, and chip all read it).
  #distance = $derived.by<number | undefined>(() => {
    const anchor = this.position;
    const boat = this.#vessel.position;
    if (!anchor || !boat || this.#vessel.positionStale || this.degraded) return undefined;
    return haversineMeters(anchor.latitude, anchor.longitude, boat.latitude, boat.longitude);
  });

  get distanceMeters(): number | undefined {
    return this.#distance;
  }

  // Distance from the current boat fix to the closest watch boundary. The live zone and
  // boat fix both invalidate this value; cached geometry never supplies a live clearance.
  #boundaryDistance = $derived.by<number | undefined>(() => {
    const zone = this.zone;
    const anchor = this.position;
    const boat = this.#vessel.position;
    const boatDistance = this.#distance;
    if (!zone || !anchor || !boat || boatDistance === undefined) return undefined;
    return distanceToZoneBoundaryMeters(zone, boatDistance, rhumbBearingRad(anchor, boat));
  });

  get boundaryDistanceMeters(): number | undefined {
    return this.#boundaryDistance;
  }

  get dragging(): boolean {
    return this.mode === 'server' && this.#serverDragging;
  }

  // True while the navigator has silenced the current server drag grade.
  get acknowledged(): boolean {
    const notification = this.#raw(SK_PATHS.anchorNotification);
    const status =
      isRecord(notification) && isRecord(notification.status) ? notification.status : undefined;
    const serverBacked =
      isRecord(notification) &&
      typeof notification.id === 'string' &&
      typeof status?.acknowledged === 'boolean';
    return (
      this.mode === 'server' &&
      this.#serverDragging &&
      (serverBacked
        ? status?.acknowledged === true
        : this.#ackState !== undefined && this.#ackState === this.#notificationState)
    );
  }

  // Reconcile server notification state after each stream update.
  updateFix(): void {
    if (!this.#serverStateStale) this.#staleHeld?.reset();
    if (this.mode === 'server') this.#retiredLocalWatch = false;
    if (!this.#serverDragging) this.#ackState = undefined;
  }

  // Remember the radius the navigator chose, so the next drop starts from it.
  rememberRadius(radiusMeters: number): void {
    if (!isFiniteNumber(radiusMeters)) return;
    this.#preferredRadius.set(clampRadius(radiusMeters));
  }

  // Silence the current server notification grade until it changes or clears.
  acknowledge(): void {
    if (this.mode === 'server') this.#ackState = this.#notificationState;
  }

  #raw(path: string): unknown {
    return this.#store.cell(path).value;
  }

  #currentRaw(path: string): unknown {
    const cell = this.#store.cell(path);
    return predatesReconnect(cell, this.#store.generation) ? undefined : cell.value;
  }
}
