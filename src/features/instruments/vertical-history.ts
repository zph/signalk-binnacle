import { metersPerSecondToKnots, RAD_TO_DEG } from '$shared/lib';
import type { TileHistoryPoint } from './tile-history.svelte';

export type VerticalHistoryMode = 'speed' | 'angle';

export interface VerticalHistoryGeometry {
  paths: string[];
  maximumPaths: string[];
  current?: { x: number; y: number };
  scale: [string, string, string];
}

const VIEWBOX_SIZE = 100;
const GAP_BREAK_MS = 15_000;

function coordinate(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function normalizeSignedDegrees(value: number): number {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

function speedLabel(value: number): string {
  return value < 10 ? value.toFixed(1) : value.toFixed(0);
}

function angleLabel(value: number): string {
  const rounded = Math.round(value);
  return rounded < 0 ? `P ${Math.abs(rounded)}` : rounded > 0 ? `S ${rounded}` : '0';
}

export function verticalHistoryGeometry(
  points: readonly TileHistoryPoint[],
  nowMs: number,
  mode: VerticalHistoryMode,
  windowMs: number,
  maximumPoints: readonly TileHistoryPoint[] = [],
): VerticalHistoryGeometry {
  const visiblePoints = (series: readonly TileHistoryPoint[]): TileHistoryPoint[] =>
    series
      .filter(
        (point) =>
          Number.isFinite(point.value) &&
          Number.isFinite(point.atMs) &&
          point.atMs <= nowMs &&
          nowMs - point.atMs <= windowMs,
      )
      .toReversed();
  const visible = visiblePoints(points);
  const visibleMaximums = visiblePoints(maximumPoints);

  const displayValues = (series: readonly TileHistoryPoint[]): number[] =>
    series.map((point) =>
      mode === 'speed'
        ? (metersPerSecondToKnots(point.value) ?? 0)
        : normalizeSignedDegrees(point.value * RAD_TO_DEG),
    );
  const values = displayValues(visible);
  const maximumValues = displayValues(visibleMaximums);
  const scaleValues = [...values, ...maximumValues];
  const defaultBounds: [number, number] = mode === 'speed' ? [0, 1] : [-180, 180];
  const minimum = scaleValues.length > 0 ? Math.min(...scaleValues) : defaultBounds[0];
  const maximum = scaleValues.length > 0 ? Math.max(...scaleValues) : defaultBounds[1];
  const span = maximum - minimum;
  const xFor = (value: number): number =>
    span === 0 ? VIEWBOX_SIZE / 2 : ((value - minimum) / span) * VIEWBOX_SIZE;

  const pathsFor = (
    series: readonly TileHistoryPoint[],
    seriesValues: readonly number[],
  ): string[] => {
    const paths: string[] = [];
    let path = '';
    let previous: { atMs: number; value: number } | undefined;
    seriesValues.forEach((value, index) => {
      const point = series[index];
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
    return paths;
  };

  return {
    paths: pathsFor(visible, values),
    maximumPaths: pathsFor(visibleMaximums, maximumValues),
    current:
      visible.length > 0 && nowMs - visible[0].atMs <= GAP_BREAK_MS
        ? { x: xFor(values[0]), y: ((nowMs - visible[0].atMs) / windowMs) * VIEWBOX_SIZE }
        : undefined,
    scale:
      mode === 'speed'
        ? [speedLabel(minimum), speedLabel((minimum + maximum) / 2), speedLabel(maximum)]
        : [angleLabel(minimum), angleLabel((minimum + maximum) / 2), angleLabel(maximum)],
  };
}
