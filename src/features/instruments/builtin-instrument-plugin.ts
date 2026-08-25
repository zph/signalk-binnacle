import { INSTRUMENT_PLUGIN_API_VERSION, type InstrumentPlugin } from './instrument-registry.svelte';
import { TILE_CATALOG, tileById } from './tile-catalog';

// Binnacle's own instruments are a plugin registration, not a privileged catalog. The generated
// resolver preserves stored dynamic instance selections until live or history discovery confirms
// that the instrument is currently available in Customize.
export const BINNACLE_INSTRUMENT_PLUGIN: InstrumentPlugin = {
  apiVersion: INSTRUMENT_PLUGIN_API_VERSION,
  id: 'binnacle.builtins',
  name: 'Binnacle built-in instruments',
  instruments: TILE_CATALOG,
  resolve: tileById,
};
