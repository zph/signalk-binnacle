import { createRetryableLazyUiLoader } from '$shared/lib';

export {
  AIS_RADAR_RANGES_NM,
  type AisRadarRangeNm,
  DEFAULT_AIS_RADAR_RANGE_NM,
  isAisRadarRangeNm,
} from './ais-radar-model';
export { BINNACLE_INSTRUMENT_PLUGIN } from './builtin-instrument-plugin';
export {
  DEFAULT_INSTRUMENT_DOCK_WIDTH_PX,
  type InstrumentDockLayout,
  instrumentDockWidthForLayout,
  MAX_INSTRUMENT_DOCK_WIDTH_PX,
  MIN_INSTRUMENT_DOCK_WIDTH_PX,
} from './dock-width';
export type { FloatingInstrumentBox } from './floating-layout';
export { floatingInstrumentBoxesCodec } from './floating-layout';
export type { InstrumentAlias } from './instrument-alias';
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
export {
  createShallowAheadMonitor,
  type ShallowAheadMonitor,
} from './shallow-ahead.svelte';
export { DEFAULT_TILES } from './tile-catalog';
export {
  type InstrumentTileLayouts,
  type InstrumentTileSize,
  instrumentTileLayoutsCodec,
} from './tile-layout';
export { type WebviewInstrument, webviewInstrumentsCodec } from './webview-sources';

const instrumentsPanelLoader = createRetryableLazyUiLoader(
  () => import('./InstrumentsPanel.svelte'),
);

export function loadInstrumentsPanel(): Promise<typeof import('./InstrumentsPanel.svelte')> {
  return instrumentsPanelLoader();
}

const instrumentsScreenLayerLoader = createRetryableLazyUiLoader(
  () => import('./InstrumentScreenLayer.svelte'),
);

export function loadInstrumentScreenLayer(): Promise<
  typeof import('./InstrumentScreenLayer.svelte')
> {
  return instrumentsScreenLayerLoader();
}
