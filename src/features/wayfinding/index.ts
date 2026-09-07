import { createRetryableLazyUiLoader } from '$shared/lib';

export {
  cancelWayfinderPlan,
  fetchWayfinderCapabilities,
  fetchWayfinderStatus,
  parseCapabilities,
  parseStatus,
  saveWayfinderPlan,
  startWayfinderPlan,
  WAYFINDER_API_PATH,
  WAYFINDER_PLUGIN_ID,
  type WayfinderConstraints,
} from './wayfinder-client';
export { createWayfindingController } from './wayfinding-controller.svelte';

const wayfindingPanelLoader = createRetryableLazyUiLoader(() => import('./WayfindingPanel.svelte'));

export function loadWayfindingPanel(): Promise<typeof import('./WayfindingPanel.svelte')> {
  return wayfindingPanelLoader();
}
