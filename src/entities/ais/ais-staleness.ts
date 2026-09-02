import { MINUTE_MS } from '$shared/lib';

// Default retention for a target's last reported position. The user can tune this, but an hour
// keeps intermittent fishing and aggregated AIS traffic available without presenting it as live.
export const AIS_STALE_TTL_MS = 60 * MINUTE_MS;

// Staleness changes on a minutes scale, so prune on this coarse cadence, and from a timer rather
// than the render path: rendering pauses in a hidden tab while the collision math keeps consuming
// the store, so an expiry tied to rendering would feed it stale targets.
export const AIS_PRUNE_INTERVAL_MS = 5_000;

// A provider's CPA and TCPA are one safety assertion and expire together. They are derived from
// both vessels' motion, so keeping them for the full slow-target TTL would present obsolete risk
// long after either vessel changed course.
export const AIS_APPROACH_STALE_TTL_MS = 30_000;

// Motion drives local CPA projection and must age out much sooner than the target's slow-reporting
// position. Aggregated feeds may deliver only once per minute, and slow AIS classes can be quieter,
// so retain five minutes. A TTL equal to a nominal interval makes independent clients flap at
// slightly different moments as network delivery and prune timers drift.
export const AIS_MOTION_STALE_TTL_MS = 5 * MINUTE_MS;

export function aisTargetAgeOpacity(ageMs: number, retentionMs: number): number {
  if (ageMs <= AIS_MOTION_STALE_TTL_MS) return 1;
  if (retentionMs <= AIS_MOTION_STALE_TTL_MS || ageMs >= retentionMs) return 0;
  return 1 - (ageMs - AIS_MOTION_STALE_TTL_MS) / (retentionMs - AIS_MOTION_STALE_TTL_MS);
}

// The floor for how often a rendered view of the traffic is rebuilt. A rendered position does not
// need better than about 1 Hz, and a glanceable list needs it less. Declared here with the other
// AIS timings so the overlays and the list cannot be tuned apart, which a comment in each feature
// asserting they agree would not prevent.
export const AIS_REFRESH_MIN_MS = 1_000;
