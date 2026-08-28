import { createRetryableLazyUiLoader } from '$shared/lib';

export { createTrackController } from './track-controller.svelte';
export type { TripDay, TripPortion, TripStop } from './trip-log';
export { createTripLogController, type TripLogController } from './trip-log-controller.svelte';

const tracksPanelLoader = createRetryableLazyUiLoader(() => import('./TracksPanel.svelte'), {
  timeoutMessage: 'Tracks controls took too long to load.',
});

export function loadTracksPanel(): Promise<typeof import('./TracksPanel.svelte')> {
  return tracksPanelLoader();
}
