import { clamp } from '$shared/lib';

export const DEFAULT_INSTRUMENT_DOCK_WIDTH_PX = 352;
export const MIN_INSTRUMENT_DOCK_WIDTH_PX = 320;
export const MAX_INSTRUMENT_DOCK_WIDTH_PX = 2560;
// A slim chart sliver is all a fully opened dock leaves on a wide display. The value also keeps
// the dock's drag handle over live chart pixels, so the dock can always be dragged back open.
const MIN_CHART_WIDTH_PX = 48;

export type InstrumentDockLayout = 'half' | 'quarter';

export function clampInstrumentDockWidth(width: number, viewportWidth: number): number {
  const viewportMaximum = Math.max(
    MIN_INSTRUMENT_DOCK_WIDTH_PX,
    viewportWidth - MIN_CHART_WIDTH_PX,
  );
  return clamp(
    Math.round(width),
    MIN_INSTRUMENT_DOCK_WIDTH_PX,
    Math.min(MAX_INSTRUMENT_DOCK_WIDTH_PX, viewportMaximum),
  );
}

export function instrumentDockWidthForLayout(
  layout: InstrumentDockLayout,
  viewportWidth: number,
): number {
  return clampInstrumentDockWidth(viewportWidth * (layout === 'half' ? 0.5 : 0.25), viewportWidth);
}

/** Widest the dock may grow on this viewport, so keyboard resize matches the pointer range. */
export function maxInstrumentDockWidthForViewport(viewportWidth: number): number {
  return clampInstrumentDockWidth(MAX_INSTRUMENT_DOCK_WIDTH_PX, viewportWidth);
}
