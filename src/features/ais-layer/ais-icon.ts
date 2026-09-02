import type { AisVesselKind } from '$entities/ais';
import type { Severity } from '$entities/collision';

export const AIS_ICON_IDS = {
  ship: 'binnacle-ais-icon-ship',
  cargo: 'binnacle-ais-icon-cargo',
  tanker: 'binnacle-ais-icon-tanker',
  passenger: 'binnacle-ais-icon-passenger',
  fishing: 'binnacle-ais-icon-fishing',
  service: 'binnacle-ais-icon-service',
  tug: 'binnacle-ais-icon-tug',
  motorboat: 'binnacle-ais-icon-motorboat',
  sailboat: 'binnacle-ais-icon-sailboat',
} as const satisfies Record<AisVesselKind, string>;

export const AIS_ICON_KINDS = Object.keys(AIS_ICON_IDS) as AisVesselKind[];

export const AIS_ICON_SEVERITIES = [
  'clear',
  'warning',
  'danger',
] as const satisfies readonly Severity[];

export function aisIconId(kind: AisVesselKind, severity: Severity): string {
  const baseId = AIS_ICON_IDS[kind];
  return severity === 'clear' ? baseId : `${baseId}-${severity}`;
}

export function aisStaleIconId(kind: AisVesselKind): string {
  return `${AIS_ICON_IDS[kind]}-stale`;
}

export const AIS_ICON_IMAGE_IDS = AIS_ICON_KINDS.flatMap((kind) => [
  ...AIS_ICON_SEVERITIES.map((severity) => aisIconId(kind, severity)),
  aisStaleIconId(kind),
]);

export const AIS_ICON_PIXEL_RATIO = 4;

const LENGTH_SCALE_STOPS = [
  [5, 0.9],
  [15, 1],
  [30, 1.1],
  [60, 1.2],
  [120, 1.35],
  [250, 1.8],
  [400, 2.7],
] as const;

export function aisVesselIconScale(lengthMeters: number | undefined): number {
  if (lengthMeters === undefined || !Number.isFinite(lengthMeters) || lengthMeters <= 0) return 1;
  const first = LENGTH_SCALE_STOPS[0];
  if (lengthMeters <= first[0]) return first[1];
  for (let index = 1; index < LENGTH_SCALE_STOPS.length; index += 1) {
    const lower = LENGTH_SCALE_STOPS[index - 1];
    const upper = LENGTH_SCALE_STOPS[index];
    if (lengthMeters > upper[0]) continue;
    const fraction = (lengthMeters - lower[0]) / (upper[0] - lower[0]);
    return lower[1] + fraction * (upper[1] - lower[1]);
  }
  return LENGTH_SCALE_STOPS[LENGTH_SCALE_STOPS.length - 1][1];
}

export function loadAisIconArtwork(): Promise<typeof import('./ais-icon-artwork')> {
  return import('./ais-icon-artwork');
}
