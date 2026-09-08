import { createRetryableLazyUiLoader } from '$shared/lib';

export {
  cancelWayfinderPlan,
  fetchWayfinderCapabilities,
  fetchWayfinderRouteGeometry,
  fetchWayfinderStatus,
  parseCapabilities,
  parseStatus,
  saveWayfinderPlan,
  startWayfinderPlan,
  WAYFINDER_API_PATH,
  WAYFINDER_PLUGIN_ID,
  type WayfinderConstraints,
  type WayfinderRouteGeometry,
} from './wayfinder-client';
export { createWayfindingController } from './wayfinding-controller.svelte';
export {
  createWayfindingOverlay,
  type WayfindingVisualizationSource,
} from './wayfinding-overlay';

const wayfindingPanelLoader = createRetryableLazyUiLoader(() => import('./WayfindingPanel.svelte'));

export function loadWayfindingPanel(): Promise<typeof import('./WayfindingPanel.svelte')> {
  return wayfindingPanelLoader();
}
