<script lang="ts">
import ChevronLeft from '@lucide/svelte/icons/chevron-left';
import ChevronRight from '@lucide/svelte/icons/chevron-right';
import Pause from '@lucide/svelte/icons/pause';
import Play from '@lucide/svelte/icons/play';
import RefreshCw from '@lucide/svelte/icons/refresh-cw';
import { onDestroy } from 'svelte';
import type { UnitsStore } from '$entities/units';
import type { WeatherStore } from '$entities/weather';
import { formatDayClock, HOUR_MS, type ReactiveClock, speedUnitLabel } from '$shared/lib';
import {
  type PersistedValue,
  WEATHER_SOURCE_OPTIONS,
  type WeatherSourceId,
} from '$shared/settings';
import { createForecastPlayback } from './forecast-playback.svelte';
import type { TimeRange } from './time-scrub';

interface Props {
  store: WeatherStore;
  weatherSource: PersistedValue<WeatherSourceId>;
  units: UnitsStore;
  clock: ReactiveClock;
  onRetry?: () => void;
  onHide: () => void;
}

const { store, weatherSource, units, clock, onRetry, onHide }: Props = $props();
const STEP_MS = 3 * HOUR_MS;

const range = $derived<TimeRange | undefined>(
  store.grid && store.grid.times.length > 0
    ? {
        start: store.grid.times[0],
        end: store.grid.times[store.grid.times.length - 1],
        stepMs: STEP_MS,
      }
    : undefined,
);
const timeLabel = $derived(store.grid ? formatDayClock(store.selectedTime, { zone: true }) : '');
const timeKind = $derived(store.selectedTime < clock.now - STEP_MS / 2 ? 'Past' : 'Forecast');
const sourceTitle = $derived(
  WEATHER_SOURCE_OPTIONS.find((option) => option.id === weatherSource.value)?.title ?? 'Automatic',
);
const nowFrac = $derived.by<number | undefined>(() => {
  if (!range || range.end <= range.start) return undefined;
  const fraction = (clock.now - range.start) / (range.end - range.start);
  return fraction >= 0 && fraction <= 1 ? fraction : undefined;
});
const statusNote = $derived.by(() => {
  if (store.status === 'loading' && !store.grid) return 'Loading wind forecast';
  if (store.status === 'error') return 'Wind forecast unavailable';
  if (store.status === 'stale') return 'Showing the last cached wind forecast';
  if (!store.grid) return 'Waiting for wind forecast';
  return `${sourceTitle} · wind speed in ${speedUnitLabel(units.speedUnit)}`;
});

const playback = createForecastPlayback(
  () => store,
  () => range,
);

onDestroy(() => playback.destroy());
</script>

<aside class="bottom-strip bottom-strip--accent wind-strip" aria-label="Wind forecast overlay">
  <div class="head">
    <span class="title">Wind forecast</span>
    <label class="source-field">
      <span class="visually-hidden">Wind forecast source</span>
      <select
        class="input source-select"
        value={weatherSource.value}
        onchange={(event) => weatherSource.set(event.currentTarget.value as WeatherSourceId)}
      >
        {#each WEATHER_SOURCE_OPTIONS as option (option.id)}
          <option value={option.id}>{option.title} ({option.coverage})</option>
        {/each}
      </select>
    </label>
    <button type="button" class="ack" onclick={onHide}>Hide</button>
  </div>

  {#if range}
    <div class="scrubber" role="group" aria-label="Wind forecast playback">
      <button
        type="button"
        class="icon-btn step"
        aria-label="Earlier"
        onclick={() => playback.step(-1)}
      >
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        class="icon-btn step"
        aria-label={playback.playing ? 'Pause wind forecast' : 'Play wind forecast'}
        onclick={playback.toggle}
      >
        {#if playback.playing}
          <Pause size={16} aria-hidden="true" />
        {:else}
          <Play size={16} aria-hidden="true" />
        {/if}
      </button>
      <button
        type="button"
        class="icon-btn step"
        aria-label="Later"
        onclick={() => playback.step(1)}
      >
        <ChevronRight size={16} aria-hidden="true" />
      </button>
      <span class="track-wrap">
        <input
          class="track range"
          type="range"
          min={range.start}
          max={range.end}
          step={range.stepMs}
          value={store.selectedTime}
          aria-label="Wind forecast time"
          aria-valuetext="{timeKind} {timeLabel}"
          oninput={(event) => playback.setTime(Number(event.currentTarget.value))}
        >
        {#if nowFrac !== undefined}
          <span
            class="now-tick"
            style="inset-inline-start: {nowFrac * 100}%"
            aria-hidden="true"
          ></span>
        {/if}
      </span>
      <span class="time num">{timeKind} · {timeLabel}</span>
    </div>
  {/if}

  <div class="status-row" role={store.status === 'error' ? 'alert' : 'status'}>
    <span class="note">{statusNote}</span>
    {#if (store.status === 'error' || store.status === 'stale') && onRetry}
      <button type="button" class="btn btn-ghost retry" onclick={onRetry}>
        <RefreshCw size={14} aria-hidden="true" />
        Retry
      </button>
    {/if}
  </div>
</aside>

<style>
.wind-strip {
  --strip-max-width: 40rem;
}
.source-field {
  min-inline-size: 0;
  flex: 1;
}
.source-select {
  inline-size: 100%;
  min-block-size: 2rem;
  block-size: 2rem;
  padding-block: 0;
  font-size: var(--text-xs);
}
.scrubber {
  display: grid;
  grid-template-columns: auto auto auto minmax(5rem, 1fr);
  align-items: center;
  gap: var(--space-1);
}
.step {
  inline-size: 2.25rem;
  min-inline-size: 2.25rem;
  block-size: 2.25rem;
  min-block-size: 2.25rem;
}
.track-wrap {
  position: relative;
  display: flex;
  align-items: center;
  min-inline-size: 0;
}
.track {
  inline-size: 100%;
}
.now-tick {
  position: absolute;
  inline-size: 2px;
  block-size: 0.75rem;
  background: var(--text-muted);
  pointer-events: none;
}
.time {
  grid-column: 1 / -1;
  font-size: var(--text-xs);
  color: var(--text-muted);
}
.status-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-block-start: var(--space-1);
}
.status-row .note {
  flex: 1;
}
.retry {
  min-block-size: 2rem;
  padding-block: 0;
}
</style>
