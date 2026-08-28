import { createRetryableLazyUiLoader } from '$shared/lib';

export { default as ChartCanvas } from './ChartCanvas.svelte';
export type { MapCommands, UserChartRegistrar } from './commands';
export { CRITICAL_OVERLAY_LABELS } from './critical-overlays';

const instrumentChartLoader = createRetryableLazyUiLoader(() => import('./InstrumentChart.svelte'));

export function loadInstrumentChart(): Promise<typeof import('./InstrumentChart.svelte')> {
  return instrumentChartLoader();
}
