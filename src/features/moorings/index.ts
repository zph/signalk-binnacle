import { createRetryableLazyUiLoader } from '$shared/lib';

export { createMooringsOverlay, type MooringsOverlay } from './moorings-overlay';
export type { MooringPoint, MooringViewState } from './moorings-types';

const panelLoader = createRetryableLazyUiLoader(() => import('./MooringsPanel.svelte'), {
  timeoutMessage: 'Moorings controls took too long to load.',
});

export function loadMooringsPanel(): Promise<typeof import('./MooringsPanel.svelte')> {
  return panelLoader();
}
