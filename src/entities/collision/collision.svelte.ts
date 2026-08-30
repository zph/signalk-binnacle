import type { AisTargets } from '$entities/ais';
import type { OwnVessel } from '$entities/vessel';
import type { LatLon } from '$shared/geo';
import { isFiniteNumber, knotsToMetersPerSecond } from '$shared/lib';
import { computeCpa } from '$shared/nav';
import type { PersistedValue, Thresholds } from '$shared/settings';

// The contact fields the assessment reads. AisTargetView satisfies it structurally, and a secondary
// source (radar ARPA targets) supplies exactly this shape without the assessment depending on the
// AIS entity's view type. A secondary source must namespace its ids (the radar one prefixes
// 'radar:') so they can never collide with an AIS context id, and should set name to what displays
// render, since the danger strip prefers a contact's name over its id.
export interface CollisionContact {
  id: string;
  name?: string;
  position: LatLon;
  sogMps?: number;
  cogRad?: number;
  cpaMeters?: number;
  tcpaSeconds?: number;
  navigationState?: string;
}

export type Severity = 'danger' | 'warning' | 'clear';
// A contact only enters the danger list once it is past 'clear', so its severity is always one of
// the two active grades. The full Severity stays on Assessment.worst, which can read 'clear'.
export type ActiveSeverity = Exclude<Severity, 'clear'>;
type CpaSource = 'provider' | 'computed';

export interface DangerContact {
  id: string;
  name?: string;
  position: LatLon;
  cpaMeters: number;
  tcpaSeconds: number;
  severity: ActiveSeverity;
  source: CpaSource;
}

// A data-quality state, not a danger severity: the target is retained and may be moving, but its
// closest approach cannot be computed honestly, so it must never read as clear.
export type UnassessedReason = 'course-unavailable' | 'motion-unknown';

export interface UnassessedContact {
  id: string;
  name?: string;
  position: LatLon;
  reason: UnassessedReason;
}

export interface Assessment {
  contacts: DangerContact[];
  worst: Severity;
  unassessed: UnassessedContact[];
}

interface OwnFix {
  position: LatLon;
  sogMps: number;
  cogRad: number;
}

const SEVERITY_RANK: Record<Severity, number> = { danger: 0, warning: 1, clear: 2 };

// The default secondary source: identity-stable so the no-radar default never dirties the derived.
const NO_SECONDARY_CONTACTS: readonly CollisionContact[] = [];

// A hard inner ring. A danger contact closer than this, and closing within this time, is an
// emergency that overrides both mute and acknowledge so the alarm sounds regardless. These are fixed
// safety floors, not the user thresholds, so a generously wide threshold setting can never silence a
// genuinely close, imminent contact.
const ESCALATE_CPA_METERS = 185; // about 0.1 nm
const ESCALATE_TCPA_SECONDS = 120;

// A target slower than this is a moored or swinging boat, not a vessel making way. When the own
// vessel is also near stationary (anchored, or under this same speed), such a target is the
// busy-marina and at-anchor nuisance the alarm must not fire on; a genuinely moving target, or own
// vessel underway toward a slow target, still alarms. One knot.
const SLOW_TARGET_SOG_MPS = knotsToMetersPerSecond(1);

// Severity is sticky on the way down: an upgrade applies immediately (an escalation is never
// delayed), but a downgrade only happens once the value clears its old band by this margin, so GPS
// scatter right at a threshold cannot flap the tone off and on or bust an acknowledge.
const DOWNGRADE_MARGIN = 1.1;
const WARNING_CONFIRMATION_UPDATES = 2;
const DOWNGRADE_HOLD_MS = 30_000;

interface ContactStability {
  stable?: DangerContact;
  warningUpdates: number;
  lastWarningRevision?: number;
  outsideDangerSince?: number;
  outsideWarningSince?: number;
}

// The identity-stable all-clear result: empty water yields this same object every pass, so
// consumers that dirty-check the assessment by reference (the chart overlay does, every animation
// frame) see no change instead of a fresh empty object per own-fix tick.
const EMPTY_ASSESSMENT: Assessment = { contacts: [], worst: 'clear', unassessed: [] };
Object.freeze(EMPTY_ASSESSMENT);
Object.freeze(EMPTY_ASSESSMENT.contacts);
Object.freeze(EMPTY_ASSESSMENT.unassessed);

// The Signal K navigation.state values that justify treating a target with no fresh speed as
// genuinely stationary rather than unassessed.
const STATIONARY_NAV_STATES = new Set(['anchored', 'moored', 'aground']);

function immediateSeverity(cpaMeters: number, tcpaSeconds: number, t: Thresholds): Severity {
  if (
    t.dangerCpaMeters > 0 &&
    t.dangerTcpaSeconds > 0 &&
    cpaMeters <= t.dangerCpaMeters &&
    tcpaSeconds <= t.dangerTcpaSeconds
  )
    return 'danger';
  if (
    t.warningCpaMeters > 0 &&
    t.warningTcpaSeconds > 0 &&
    cpaMeters <= t.warningCpaMeters &&
    tcpaSeconds <= t.warningTcpaSeconds
  )
    return 'warning';
  return 'clear';
}

function classify(
  cpaMeters: number,
  tcpaSeconds: number,
  t: Thresholds,
  previous?: Severity,
): Severity {
  const immediate = immediateSeverity(cpaMeters, tcpaSeconds, t);
  if (previous === undefined || SEVERITY_RANK[immediate] <= SEVERITY_RANK[previous]) {
    return immediate;
  }
  if (
    previous === 'danger' &&
    t.dangerCpaMeters > 0 &&
    t.dangerTcpaSeconds > 0 &&
    cpaMeters <= t.dangerCpaMeters * DOWNGRADE_MARGIN &&
    tcpaSeconds <= t.dangerTcpaSeconds * DOWNGRADE_MARGIN
  ) {
    return 'danger';
  }
  // Reached from previous danger as well as previous warning: a danger contact that has drifted
  // outside the danger margin but still sits inside the warning margin steps down one level
  // rather than snapping straight to clear.
  if (
    t.warningCpaMeters > 0 &&
    t.warningTcpaSeconds > 0 &&
    cpaMeters <= t.warningCpaMeters * DOWNGRADE_MARGIN &&
    tcpaSeconds <= t.warningTcpaSeconds * DOWNGRADE_MARGIN
  ) {
    return 'warning';
  }
  return immediate;
}

export function assessContacts(
  own: OwnFix | undefined,
  targets: readonly CollisionContact[],
  thresholds: Thresholds,
  previous?: ReadonlyMap<string, Severity>,
  anchored = false,
): Assessment {
  const ownK = own
    ? {
        latitude: own.position.latitude,
        longitude: own.position.longitude,
        sogMps: own.sogMps,
        cogRad: own.cogRad,
      }
    : undefined;
  const contacts: DangerContact[] = [];
  const unassessed: UnassessedContact[] = [];
  for (const t of targets) {
    let cpaMeters: number;
    let tcpaSeconds: number;
    let source: CpaSource;
    if (isFiniteNumber(t.cpaMeters) && t.cpaMeters >= 0 && isFiniteNumber(t.tcpaSeconds)) {
      // A TCPA at or below zero means the closest approach is now or already past, so the
      // target is no longer closing and is not a danger even at a small CPA. This matches the
      // computed branch, which also treats tcpa <= 0 as not closing, so the two CPA sources
      // apply the same gate.
      if (t.tcpaSeconds <= 0) continue;
      cpaMeters = t.cpaMeters;
      tcpaSeconds = t.tcpaSeconds;
      source = 'provider';
    } else {
      // Computing CPA needs a live own fix; the provider branch above does not (its CPA and TCPA
      // come from the server), so a lost fix stands down only the locally computed geometry.
      if (!ownK) continue;
      // Both motion fields arrive through the AIS freshness window, so undefined means missing or
      // expired. Never fabricate a track: a target without fresh speed is stationary only when its
      // reported navigation state says so, and a moving target without a fresh course cannot be
      // assessed at all. Unassessed is a data-quality outcome, never a danger and never clear.
      const sog = t.sogMps;
      const cog = t.cogRad;
      if (sog === undefined) {
        if (!STATIONARY_NAV_STATES.has(t.navigationState ?? '')) {
          unassessed.push({
            id: t.id,
            name: t.name,
            position: t.position,
            reason: 'motion-unknown',
          });
        }
        continue;
      }
      const targetSlow = sog < SLOW_TARGET_SOG_MPS;
      if (!targetSlow && cog === undefined) {
        unassessed.push({
          id: t.id,
          name: t.name,
          position: t.position,
          reason: 'course-unavailable',
        });
        continue;
      }
      // The busy-marina and at-anchor false-alarm case: a near-stationary target (a moored or
      // swinging boat) is not a collision risk to an own vessel that is itself not making way. Own
      // vessel counts as stationary when anchored, so GPS wander at anchor cannot reinstate the
      // noise. This gate is computed-branch only: a provider's CPA and TCPA are left authoritative.
      const ownStationary = anchored || ownK.sogMps < SLOW_TARGET_SOG_MPS;
      if (ownStationary && targetSlow) continue;
      const r = computeCpa(ownK, {
        latitude: t.position.latitude,
        longitude: t.position.longitude,
        sogMps: sog,
        // A near-stationary target's course is geometrically negligible, so the fallback cannot
        // fabricate closing geometry; a moving target never reaches here without a fresh course.
        cogRad: cog ?? 0,
      });
      if (!r.closing) continue;
      cpaMeters = r.cpaMeters;
      tcpaSeconds = r.tcpaSeconds;
      source = 'computed';
    }
    const severity = classify(cpaMeters, tcpaSeconds, thresholds, previous?.get(t.id));
    if (severity === 'clear') continue;
    contacts.push({
      id: t.id,
      name: t.name,
      position: t.position,
      cpaMeters,
      tcpaSeconds,
      severity,
      source,
    });
  }
  if (contacts.length === 0 && unassessed.length === 0) return EMPTY_ASSESSMENT;
  contacts.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.tcpaSeconds - b.tcpaSeconds,
  );
  return { contacts, worst: contacts[0]?.severity ?? 'clear', unassessed };
}

export class CollisionAssessment {
  #vessel: OwnVessel;
  #targets: AisTargets;
  #thresholds: PersistedValue<Thresholds>;
  // Reads anchor-watch state so an anchored own vessel treats moored and swinging boats as the
  // non-hazards they are, silencing the busy-anchorage nuisance. A callback, not the anchor entity,
  // keeps this entity from importing a sibling and lets the composition root wire the dependency.
  #anchored: () => boolean;

  // A secondary contact source (radar ARPA targets), merged into the same pass so its contacts
  // grade through the identical thresholds, hysteresis, receding hold, and acknowledge lifecycle
  // as AIS traffic. A getter read inside the derived recompute, so a reactive source re-runs the
  // assessment and a value captured at construction cannot go stale.
  #radarContacts: () => readonly CollisionContact[];
  #radarRevision: (id: string) => number | undefined;

  // The worst-contact signature (id and severity) that was acknowledged. The alert is
  // suppressed only while the current worst contact still matches it, so a new or more
  // severe contact re-arms the alert automatically. Held as fields rather than a joined
  // string so suppressed, read every animation frame, allocates nothing. Full mute
  // lifecycle is Lookout step 4.
  #ackSignature = $state<{ id: string; severity: ActiveSeverity } | null>(null);

  // Set during the assessment recompute when the situation goes all-clear, so the same vessel
  // re-approaching later at the same severity is a new event, never auto-suppressed by a stale
  // acknowledge. A plain field, not $state: it is written inside the $derived recompute, where
  // reactive writes are forbidden, and the assessment change itself re-runs every suppressed
  // reader anyway.
  #ackExpired = false;

  // Per-contact confirmation and clearance state. Upgrades to danger remain immediate, warnings
  // need two distinct AIS updates, and a downgrade needs 30 continuous seconds beyond the existing
  // 10 percent margin. Plain fields are used for the same reason as #ackExpired.
  #stability = new Map<string, ContactStability>();
  #now: () => number;

  // Memoized so the O(targets) CPA loop runs once per real change, not once per read. The
  // assessment is read several times per frame (alarm, notifier, danger strip, overlay), and
  // the overlay reads it every animation frame; $derived recomputes only when traffic, the
  // own fix, or the thresholds actually change. The version read tracks the non-reactive Map.
  #assessment = $derived.by<Assessment>(() => {
    void this.#targets.version;
    const position = this.#vessel.position;
    // A stale own fix is treated as no fix: computing CPA and TCPA against a position the boat
    // left minutes ago would alarm (or fail to alarm) on geometry that no longer exists. Only the
    // locally computed branch stands down for it; provider-sourced contacts keep alarming, since
    // their CPA and TCPA come from the server and need no local fix.
    const sogMps = this.#vessel.sogMps;
    const cogRad = this.#vessel.cogRad;
    const own =
      position &&
      !this.#vessel.positionStale &&
      sogMps !== undefined &&
      !this.#vessel.sogStale &&
      cogRad !== undefined &&
      !this.#vessel.cogStale
        ? { position, sogMps, cogRad }
        : undefined;
    // Radar contacts ride along only when present, so the everyday no-radar pass hands the AIS
    // list through without an allocation.
    const radarContacts = this.#radarContacts();
    const targets =
      radarContacts.length === 0
        ? this.#targets.list()
        : [...this.#targets.list(), ...radarContacts];
    const previous = new Map<string, Severity>();
    for (const [id, state] of this.#stability) {
      if (state.stable) previous.set(id, state.stable.severity);
    }
    const immediate = assessContacts(
      own,
      targets,
      this.#thresholds.value,
      previous,
      this.#anchored(),
    );
    const next = this.#stabilize(immediate, targets, this.#now());
    if (next.contacts.length === 0) {
      this.#ackExpired = true;
    }
    return next;
  });

  constructor(
    vessel: OwnVessel,
    targets: AisTargets,
    thresholds: PersistedValue<Thresholds>,
    anchored: () => boolean = () => false,
    now: () => number = Date.now,
    radarContacts: () => readonly CollisionContact[] = () => NO_SECONDARY_CONTACTS,
    radarRevision: (id: string) => number | undefined = () => undefined,
  ) {
    this.#vessel = vessel;
    this.#targets = targets;
    this.#thresholds = thresholds;
    this.#anchored = anchored;
    this.#now = now;
    this.#radarContacts = radarContacts;
    this.#radarRevision = radarRevision;
  }

  #stabilize(immediate: Assessment, targets: readonly CollisionContact[], now: number): Assessment {
    const immediateById = new Map(immediate.contacts.map((contact) => [contact.id, contact]));
    const targetById = new Map(targets.map((target) => [target.id, target]));
    const ids = new Set([...this.#stability.keys(), ...immediateById.keys()]);
    const contacts: DangerContact[] = [];

    for (const id of ids) {
      const contact = immediateById.get(id);
      const severity = contact?.severity ?? 'clear';
      let state = this.#stability.get(id);
      if (!state) {
        state = { warningUpdates: 0 };
        this.#stability.set(id, state);
      }

      if (severity === 'danger' && contact) {
        state.stable = contact;
        state.warningUpdates = 0;
        state.lastWarningRevision = undefined;
        state.outsideDangerSince = undefined;
        state.outsideWarningSince = undefined;
        contacts.push(contact);
        continue;
      }

      if (severity === 'warning') {
        state.outsideDangerSince ??= now;
        state.outsideWarningSince = undefined;
      } else {
        state.outsideDangerSince ??= now;
        state.outsideWarningSince ??= now;
      }

      if (state.stable?.severity === 'danger') {
        const clearsWarning =
          state.outsideWarningSince !== undefined &&
          now - state.outsideWarningSince >= DOWNGRADE_HOLD_MS;
        if (clearsWarning) {
          this.#stability.delete(id);
          continue;
        }
        const clearsDanger =
          state.outsideDangerSince !== undefined &&
          now - state.outsideDangerSince >= DOWNGRADE_HOLD_MS;
        if (clearsDanger) {
          state.stable = { ...(contact ?? state.stable), severity: 'warning' };
          state.outsideDangerSince = undefined;
        } else {
          state.stable = { ...(contact ?? state.stable), severity: 'danger' };
        }
        contacts.push(state.stable);
        continue;
      }

      if (state.stable?.severity === 'warning') {
        if (
          state.outsideWarningSince !== undefined &&
          now - state.outsideWarningSince >= DOWNGRADE_HOLD_MS
        ) {
          this.#stability.delete(id);
          continue;
        }
        if (contact) state.stable = contact;
        contacts.push(state.stable);
        continue;
      }

      if (severity === 'warning' && contact) {
        const revision = targetById.has(id)
          ? (this.#targets.revision(id) ?? this.#radarRevision(id))
          : undefined;
        if (revision !== undefined && revision !== state.lastWarningRevision) {
          state.lastWarningRevision = revision;
          state.warningUpdates += 1;
        }
        if (state.warningUpdates >= WARNING_CONFIRMATION_UPDATES) {
          state.stable = contact;
          state.outsideDangerSince = undefined;
          contacts.push(contact);
        }
        continue;
      }

      this.#stability.delete(id);
    }

    if (contacts.length === 0 && immediate.unassessed.length === 0) return EMPTY_ASSESSMENT;
    contacts.sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.tcpaSeconds - b.tcpaSeconds,
    );
    return {
      contacts,
      worst: contacts[0]?.severity ?? 'clear',
      unassessed: immediate.unassessed,
    };
  }

  get assessment(): Assessment {
    return this.#assessment;
  }

  // True when the current worst contact has been acknowledged and has not since changed or
  // gone clear in between.
  get suppressed(): boolean {
    const top = this.#topContact;
    const ack = this.#ackSignature;
    return (
      top !== undefined &&
      ack !== null &&
      !this.#ackExpired &&
      top.id === ack.id &&
      top.severity === ack.severity
    );
  }

  // True when the worst contact is inside the hard inner ring: close enough and imminent enough that
  // the alarm must sound even if muted or acknowledged. Consumers use it to override suppression.
  get escalating(): boolean {
    const top = this.#topContact;
    return (
      !!top &&
      top.severity === 'danger' &&
      top.cpaMeters <= ESCALATE_CPA_METERS &&
      top.tcpaSeconds <= ESCALATE_TCPA_SECONDS
    );
  }

  acknowledge(): void {
    this.#ackExpired = false;
    const top = this.#topContact;
    this.#ackSignature = top ? { id: top.id, severity: top.severity } : null;
  }

  get #topContact(): DangerContact | undefined {
    return this.#assessment.contacts[0];
  }
}
