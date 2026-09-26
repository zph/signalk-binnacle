import type { AnchorWatch } from '$entities/anchor';
import type { OwnVessel } from '$entities/vessel';
import type { GatedAlarm } from '$shared/audio';
import type { LatLon } from '$shared/geo';
import { createBusyGate } from '$shared/lib';
import { shouldSoundAnchorAlarm } from './anchor-alarm';
import {
  dropAnchorOnServer,
  raiseServerAnchor,
  setServerAnchorPosition,
  setServerRadius,
} from './anchor-client';

export interface AnchorControllerDeps {
  // The Signal K server origin, captured once for the page lifetime.
  origin: string;
  // The Signal K auth token, when one is configured. A getter so a token that arrives or changes
  // mid-session is read live by the transport, not frozen at construction.
  getToken: () => string | undefined;
  // The anchor watch, a stable instance passed by reference.
  anchor: AnchorWatch;
  // The own vessel, a stable instance passed by reference; the drop reads its live position.
  vessel: OwnVessel;
  // The anchor-drag alarm, a stable instance passed by reference.
  anchorAlarm: GatedAlarm;
  // Fires after a drop or raise succeeds; the composition root offers a logbook entry from it.
  onAnchorLogMoment?: (kind: 'dropped' | 'raised', radiusMeters?: number) => void;
  writeBlocked: () => boolean;
}

// The anchor watch orchestration is server-driven. Owns the anchor error shown until the next action, the resolved
// transport, the action chain, the anchor live-region string, and the two anchor effects (the
// position-fix update and the drag alarm). The host wires onDrop, onRaise, onSetRadius, and
// onAnchorMoved to the panel and chart, reads anchorError into the panel, and reads anchorAlert into
// LiveRegions.
export function createAnchorController(deps: AnchorControllerDeps) {
  const { anchor, vessel, anchorAlarm } = deps;

  // An anchor error shown in the panel until the next anchor action clears it, rather than
  // auto-dismissing: on a boat an error must persist until the operator has acted on it.
  let anchorError = $state<string | undefined>();
  let busy = $state(false);

  // Reconcile server notifications and staleness after stream updates.
  $effect(() => {
    anchor.updateFix();
  });

  // Sound only a server-reported drag alarm, until its current grade is acknowledged.
  $effect(() => {
    anchorAlarm.update(shouldSoundAnchorAlarm(anchor.dragging, anchor.acknowledged));
  });

  // The anchor channel of the assertive live region, separate from the collision channel so a drag
  // alarm is announced even while a collision alert holds the other region.
  const anchorAlert = $derived.by(() => {
    const cause = anchor.degradedCause;
    if (anchor.retiredLocalWatch)
      return 'Previous browser-only anchor watch stopped. Set a server anchor watch before relying on an alarm.';
    if (cause === 'server-stale') {
      return 'Last known server anchor only. Connection lost or state not refreshed; watch status is unconfirmed.';
    }
    if (!anchor.dragging || anchor.acknowledged) return '';
    return 'Anchor alarm: the boat is dragging.';
  });

  const withBusy = createBusyGate(
    () => busy,
    (next) => {
      busy = next;
    },
  );

  async function performDrop(): Promise<void> {
    anchorError = undefined;
    const position = vessel.position;
    if (!position || vessel.positionStale) {
      anchorError = 'A fresh GPS fix is needed to drop the anchor.';
      return;
    }
    const radius = anchor.preferredRadiusMeters;
    if (deps.writeBlocked()) {
      anchorError =
        'Could not drop the anchor. Server write access is required; no watch was started.';
      return;
    }
    // A successful plugin drop hands the watch to the server. A missing or disabled plugin never
    // becomes a browser-only watch.
    if (await dropAnchorOnServer(deps.origin, deps.getToken(), radius)) {
      deps.onAnchorLogMoment?.('dropped', radius);
      return;
    }
    anchorError =
      'Could not confirm a server anchor watch. Check the connection and anchor-alarm plugin; do not rely on an alarm.';
  }
  const onDrop = withBusy(performDrop);

  // Route an anchor action by mode. In server mode the plugin call must succeed; a failure is
  // surfaced, never papered over with a local-only change.
  async function performAnchorAction(
    serverCall: () => Promise<boolean>,
    action: string,
  ): Promise<boolean> {
    anchorError = undefined;
    if (anchor.mode === 'server' && deps.writeBlocked()) {
      anchorError = `Could not ${action}. Server write access is required.`;
      return false;
    }
    if (anchor.mode !== 'server') {
      anchorError = `Could not ${action}. No server anchor watch is active.`;
      return false;
    }
    if (anchor.degraded) {
      anchorError = `Could not ${action}. The last known server anchor is not current; reconnect first.`;
      return false;
    }
    if (!(await serverCall())) {
      anchorError = `Could not ${action} on the server. Check the connection.`;
      return false;
    }
    return true;
  }
  const anchorAction = withBusy(performAnchorAction);

  async function onRaise(): Promise<void> {
    const wasWatching = anchor.watching;
    const raised = await anchorAction(
      () => raiseServerAnchor(deps.origin, deps.getToken()),
      'raise the anchor',
    );
    // Only a raise that actually ended a watch is worth a log line.
    if (wasWatching && raised) deps.onAnchorLogMoment?.('raised');
  }

  function onSetRadius(meters: number): Promise<void> {
    if (!anchor.watching) {
      anchor.rememberRadius(meters);
      return Promise.resolve();
    }
    return anchorAction(
      () => setServerRadius(deps.origin, deps.getToken(), meters),
      'set the radius',
    ).then((set) => {
      if (set) anchor.rememberRadius(meters);
    });
  }

  function onAnchorMoved(position: LatLon): Promise<void> {
    return anchorAction(
      () => setServerAnchorPosition(deps.origin, deps.getToken(), position),
      'move the anchor',
    ).then(() => {});
  }

  return {
    onDrop,
    onRaise,
    onSetRadius,
    onAnchorMoved,
    get anchorError() {
      return anchorError;
    },
    get anchorAlert() {
      return anchorAlert;
    },
    get busy() {
      return busy;
    },
  };
}
