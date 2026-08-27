import { clamp } from '$shared/lib';

export const DEFAULT_INSTRUMENT_DOCK_WIDTH_PX = 352;
export const MIN_INSTRUMENT_DOCK_WIDTH_PX = 320;
export const MAX_INSTRUMENT_DOCK_WIDTH_PX = 768;
const MIN_CHART_WIDTH_PX = 320;

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
