import { createRetryableLazyUiLoader } from '$shared/lib';

export { BINNACLE_INSTRUMENT_PLUGIN } from './builtin-instrument-plugin';
export {
  DEFAULT_INSTRUMENT_DOCK_WIDTH_PX,
  type InstrumentDockLayout,
  instrumentDockWidthForLayout,
  MAX_INSTRUMENT_DOCK_WIDTH_PX,
  MIN_INSTRUMENT_DOCK_WIDTH_PX,
} from './dock-width';
export {
  parseInstrumentPluginManifest,
  SIGNALK_INSTRUMENT_PLUGINS_PATH,
} from './instrument-plugin-manifest';
export type {
  InstrumentPlugin,
  InstrumentPluginInfo,
  InstrumentRegistry,
} from './instrument-registry.svelte';
export {
  createInstrumentRegistry,
  INSTRUMENT_PLUGIN_API_VERSION,
} from './instrument-registry.svelte';
export type { InstrumentsController } from './instruments-controller.svelte';
export { createInstrumentsController } from './instruments-controller.svelte';
export { DEFAULT_TILES } from './tile-catalog';

const instrumentsPanelLoader = createRetryableLazyUiLoader(
  () => import('./InstrumentsPanel.svelte'),
);

export function loadInstrumentsPanel(): Promise<typeof import('./InstrumentsPanel.svelte')> {
  return instrumentsPanelLoader();
}
