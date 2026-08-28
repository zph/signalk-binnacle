import type { WeatherStore } from '$entities/weather';
import { advancePlay, clampTime, stepTime, type TimeRange } from './time-scrub';

// How long each playback frame holds before advancing to the next forecast step.
const PLAY_INTERVAL_MS = 700;

// Shared forecast playback for the full Forecast view and the primary-chart wind strip. The range
// is injected as a getter because it changes when a newly selected model finishes loading.
export function createForecastPlayback(
  getStore: () => WeatherStore,
  range: () => TimeRange | undefined,
) {
  let playing = $state(false);
  let playTimer: ReturnType<typeof setInterval> | undefined;

  function stopPlay(): void {
    playing = false;
    if (playTimer) clearInterval(playTimer);
    playTimer = undefined;
  }

  function setTime(t: number): void {
    // A manual scrub or step takes the wheel: the play timer must not move the thumb afterward.
    stopPlay();
    const currentRange = range();
    if (currentRange) getStore().setSelectedTime(clampTime(t, currentRange));
  }

  function step(dir: 1 | -1): void {
    const currentRange = range();
    if (currentRange) setTime(stepTime(getStore().selectedTime, dir, currentRange));
  }

  function toggle(): void {
    const currentRange = range();
    if (playing || !currentRange) {
      stopPlay();
      return;
    }
    playing = true;
    playTimer = setInterval(() => {
      const nextRange = range();
      if (nextRange) {
        getStore().setSelectedTime(advancePlay(getStore().selectedTime, nextRange));
      }
    }, PLAY_INTERVAL_MS);
  }

  function destroy(): void {
    stopPlay();
  }

  return {
    toggle,
    setTime,
    step,
    destroy,
    get playing() {
      return playing;
    },
  };
}
