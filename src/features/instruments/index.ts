import { createRetryableLazyUiLoader } from '$shared/lib';

export {
  DEFAULT_INSTRUMENT_DOCK_WIDTH_PX,
  MAX_INSTRUMENT_DOCK_WIDTH_PX,
  MIN_INSTRUMENT_DOCK_WIDTH_PX,
} from './dock-width';
export type { InstrumentsController } from './instruments-controller.svelte';
export { createInstrumentsController } from './instruments-controller.svelte';
export { detectKip, KIP_URL } from './kip-launcher';
export { DEFAULT_TILES } from './tile-catalog';

const instrumentsPanelLoader = createRetryableLazyUiLoader(
  () => import('./InstrumentsPanel.svelte'),
);

export function loadInstrumentsPanel(): Promise<typeof import('./InstrumentsPanel.svelte')> {
  return instrumentsPanelLoader();
}
