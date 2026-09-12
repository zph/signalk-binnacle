import { createRetryableLazyUiLoader } from '$shared/lib';

const displayPanelLoader = createRetryableLazyUiLoader(() => import('./DisplayPanel.svelte'));

export function loadDisplayPanel(): Promise<typeof import('./DisplayPanel.svelte')> {
  return displayPanelLoader();
}
export {
  createDisplaySettingsController,
  type DisplaySettingsController,
  type DisplaySettingsDeps,
} from './display-settings.svelte';
