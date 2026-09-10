import { metersPerSecondToKnots, RAD_TO_DEG } from '$shared/lib';
import type { TileHistoryPoint } from './tile-history.svelte';

export type VerticalHistoryMode = 'speed' | 'angle';

export interface VerticalHistoryGeometry {
  paths: string[];
  current?: { x: number; y: number };
  scale: [string, string, string];
}

const VIEWBOX_SIZE = 100;
const ANGLE_SPAN_DEG = 360;
const GAP_BREAK_MS = 15_000;

function coordinate(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function normalizeSignedDegrees(value: number): number {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

// Choose a familiar 1, 2, or 5 times power-of-ten ceiling, keeping the speed scale anchored at
// zero. A gust beyond the current ceiling expands the plot without producing awkward labels.
function niceSpeedCeiling(maximum: number): number {
  const safeMaximum = Math.max(1, maximum);
  const magnitude = 10 ** Math.floor(Math.log10(safeMaximum));
  const normalized = safeMaximum / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

function speedLabel(value: number): string {
  return value < 10 ? value.toFixed(1) : value.toFixed(0);
}

export function verticalHistoryGeometry(
  points: readonly TileHistoryPoint[],
  nowMs: number,
  mode: VerticalHistoryMode,
  windowMs: number,
): VerticalHistoryGeometry {
  const visible = points
    .filter(
      (point) =>
        Number.isFinite(point.value) &&
        Number.isFinite(point.atMs) &&
        point.atMs <= nowMs &&
        nowMs - point.atMs <= windowMs,
    )
    .toReversed();

  const values = visible.map((point) =>
    mode === 'speed'
      ? (metersPerSecondToKnots(point.value) ?? 0)
      : normalizeSignedDegrees(point.value * RAD_TO_DEG),
  );
  const speedCeiling = niceSpeedCeiling(Math.max(0, ...values));
  const xFor = (value: number): number =>
    mode === 'speed'
      ? (Math.max(0, value) / speedCeiling) * VIEWBOX_SIZE
      : ((value + 180) / ANGLE_SPAN_DEG) * VIEWBOX_SIZE;

  const paths: string[] = [];
  let path = '';
  let previous: { atMs: number; value: number } | undefined;
  values.forEach((value, index) => {
    const point = visible[index];
    const x = Math.min(VIEWBOX_SIZE, Math.max(0, xFor(value)));
    const y = ((nowMs - point.atMs) / windowMs) * VIEWBOX_SIZE;
    const wrapsAngle = mode === 'angle' && previous && Math.abs(value - previous.value) > 180;
    const hasGap = previous && previous.atMs - point.atMs > GAP_BREAK_MS;
    if (wrapsAngle || hasGap) {
      if (path) paths.push(path);
      path = '';
    }
    path += `${path ? ' L' : 'M'}${coordinate(x)} ${coordinate(y)}`;
    previous = { atMs: point.atMs, value };
  });
  if (path) paths.push(path);

  return {
    paths,
    current:
      visible.length > 0 && nowMs - visible[0].atMs <= GAP_BREAK_MS
        ? { x: xFor(values[0]), y: ((nowMs - visible[0].atMs) / windowMs) * VIEWBOX_SIZE }
        : undefined,
    scale:
      mode === 'speed'
        ? ['0', speedLabel(speedCeiling / 2), speedLabel(speedCeiling)]
        : ['P 180', '0', 'S 180'],
  };
}
