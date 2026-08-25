export type { AisOverlayOptions, AisVesselKindMode } from './ais-overlay';
export { AIS_OVERLAY_ID, createAisOverlay } from './ais-overlay';
export { createAisTrailsOverlay } from './ais-trails-overlay';
export { createAisVectorsOverlay } from './ais-vectors-overlay';

import { createRetryableLazyUiLoader } from '$shared/lib';

const aisDisplaySettingsLoader = createRetryableLazyUiLoader(
  () => import('./AisDisplaySettings.svelte'),
);

export function loadAisDisplaySettings(): Promise<typeof import('./AisDisplaySettings.svelte')> {
  return aisDisplaySettingsLoader();
}
