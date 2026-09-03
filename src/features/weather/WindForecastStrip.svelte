<script lang="ts">
import ChevronLeft from '@lucide/svelte/icons/chevron-left';
import ChevronRight from '@lucide/svelte/icons/chevron-right';
import Pause from '@lucide/svelte/icons/pause';
import Play from '@lucide/svelte/icons/play';
import RefreshCw from '@lucide/svelte/icons/refresh-cw';
import { onDestroy } from 'svelte';
import type { TidesStore } from '$entities/tides';
import type { UnitsStore } from '$entities/units';
import type { WeatherStore } from '$entities/weather';
import { formatDayClock, HOUR_MS, type ReactiveClock, speedUnitLabel } from '$shared/lib';
import {
  type PersistedValue,
  WEATHER_SOURCE_OPTIONS,
  type WeatherSourceId,
} from '$shared/settings';
import type { Theme } from '$shared/ui';
import { createForecastPlayback } from './forecast-playback.svelte';
import { weatherLegend } from './legend';
import type { TimeRange } from './time-scrub';

interface Props {
  store: WeatherStore;
  tides: TidesStore;
  weatherSource: PersistedValue<WeatherSourceId>;
  units: UnitsStore;
  clock: ReactiveClock;
  kind: 'Conditions' | 'Wind and gusts' | 'Ocean currents' | 'Temperature' | 'UV index';
  layerId: string;
  theme: Theme;
  onRetry?: () => void;
  onHide: () => void;
}

const { store, tides, weatherSource, units, clock, kind, layerId, theme, onRetry, onHide }: Props =
  $props();
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
const legend = $derived(weatherLegend(layerId, theme, units.mode, units.speedUnit));
const uvUnavailable = $derived(
  kind === 'UV index' &&
    store.grid !== undefined &&
    !store.grid.uvIndex?.some((step) => step.some(Number.isFinite)),
);
const currentUnavailable = $derived(
  kind === 'Ocean currents' && tides.status !== 'loading' && tides.current === undefined,
);
const conditionsUnavailable = $derived(
  kind === 'Conditions' &&
    store.grid !== undefined &&
    !store.grid.waveHeight?.some((step) => step.some(Number.isFinite)) &&
    !store.grid.oceanCurrentSpeed?.some((step) => step.some(Number.isFinite)),
);
const nowFrac = $derived.by<number | undefined>(() => {
  if (!range || range.end <= range.start) return undefined;
  const fraction = (clock.now - range.start) / (range.end - range.start);
  return fraction >= 0 && fraction <= 1 ? fraction : undefined;
});
const statusNote = $derived.by(() => {
  if (kind === 'Ocean currents' && tides.status === 'loading') {
    return 'Loading local NOAA current predictions';
  }
  if (kind === 'Ocean currents' && tides.failure('current')) {
    return 'NOAA current predictions are temporarily unavailable.';
  }
  if (store.status === 'loading' && !store.grid) return `Loading ${kind.toLowerCase()} forecast`;
  if (store.status === 'loading') {
    return `Updating ${kind.toLowerCase()} forecast for this chart view`;
  }
  if (store.status === 'error') return `${kind} forecast unavailable`;
  if (store.status === 'stale') return `Showing the last cached ${kind.toLowerCase()} forecast`;
  if (!store.grid) return `Waiting for ${kind.toLowerCase()} forecast`;
  if (uvUnavailable) {
    return `UV index is unavailable from ${sourceTitle}. Choose Automatic or NOAA for UV.`;
  }
  if (currentUnavailable) return 'No NOAA current-prediction station is available for this area.';
  if (conditionsUnavailable) {
    return 'Marine forecast data is unavailable for combined conditions in this area.';
  }
  if (kind === 'Ocean currents') {
    return `NOAA CO-OPS · ${tides.current?.station.name ?? 'nearest local station'} · predicted tidal-current speed in ${speedUnitLabel(units.speedUnit)}`;
  }
  if (kind === 'Conditions') {
    return `${sourceTitle} + Open-Meteo Marine · icons flag notable combined conditions; hover or tap for detail`;
  }
  return kind === 'Wind and gusts'
    ? `${sourceTitle} · color shows sustained wind; barbs show direction; labels show integer gust speed with units`
    : `${sourceTitle} · ${kind.toLowerCase()} forecast`;
});

const playback = createForecastPlayback(
  () => store,
  () => range,
);

onDestroy(() => playback.destroy());
</script>

<aside class="bottom-strip bottom-strip--accent wind-strip" aria-label={`${kind} forecast overlay`}>
  <div class="head">
    <span class="title">{kind}</span>
    {#if kind === 'Ocean currents'}
      <span class="source-field current-source">NOAA CO-OPS</span>
    {:else}
      <label class="source-field">
        <span class="visually-hidden">Weather forecast source</span>
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
    {/if}
    <button type="button" class="ack" onclick={onHide}>Hide</button>
  </div>

  {#if range}
    <div class="scrubber" role="group" aria-label="Weather forecast playback">
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
        aria-label={playback.playing ? 'Pause weather forecast' : 'Play weather forecast'}
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
          aria-label="Weather forecast time"
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
  {#if legend?.gradient}
    <div class="forecast-legend">
      <span class="legend-title">{legend.title}</span>
      <span class="legend-value num">{legend.lowLabel}</span>
      <span class="legend-ramp" style:background={legend.gradient} aria-hidden="true"></span>
      <span class="legend-value num">{legend.highLabel}</span>
    </div>
  {:else if legend?.swatches}
    <div class="condition-legend" role="group" aria-label={legend.title}>
      {#each legend.swatches as swatch (swatch.label)}
        <span class="condition-key">
          <span class="condition-dot" style:background={swatch.color} aria-hidden="true"></span>
          {swatch.label}
        </span>
      {/each}
    </div>
  {/if}
  {#if legend?.note}
    <p class="legend-note">{legend.note}</p>
  {/if}
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
.current-source {
  color: var(--text-muted);
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
.forecast-legend {
  display: grid;
  grid-template-columns: auto auto minmax(80px, 1fr) auto;
  align-items: center;
  gap: var(--space-1);
  min-inline-size: 0;
  font-size: var(--font-size-xs);
}
.legend-title {
  color: var(--text-muted);
  white-space: nowrap;
}
.legend-value {
  min-inline-size: 2ch;
  color: var(--text-muted);
  text-align: center;
}
.legend-ramp {
  block-size: 0.45rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
}
.legend-note {
  margin-block-start: var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-xs);
}
.condition-legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-xs);
}
.condition-key {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}
.condition-dot {
  inline-size: 0.6rem;
  block-size: 0.6rem;
  border: 1px solid var(--border);
  border-radius: 50%;
}
.status-row .note {
  flex: 1;
}
.retry {
  min-block-size: 2rem;
  padding-block: 0;
}
</style>
