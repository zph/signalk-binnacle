<script lang="ts">
import Settings from '@lucide/svelte/icons/settings';
import { formatTideHeight, tideCurveSamples, tideHoverReading } from '$features/tides';
import { formatClockTime, formatMonthDay } from '$shared/lib';
import type { TileReading } from './tile-catalog';

interface Props {
  label: string;
  reading: TileReading;
  sensorGloss: string;
  expanded?: boolean;
  actionLabel: string;
  onOpen: () => void;
  onSettings?: () => void;
}

const {
  label,
  reading,
  sensorGloss,
  expanded = false,
  actionLabel,
  onOpen,
  onSettings,
}: Props = $props();

const WIDTH = 600;
const HEIGHT = 240;
const LEFT = 58;
const RIGHT = 18;
const TOP = 18;
const BOTTOM = 34;
const PLOT_WIDTH = WIDTH - LEFT - RIGHT;
const PLOT_HEIGHT = HEIGHT - TOP - BOTTOM;

const tide = $derived(reading.tide);
const unitsMode = $derived(reading.tideUnitsMode ?? 'metric');
const samples = $derived(
  tide ? (tide.samples?.length ? tide.samples : tideCurveSamples(tide.events)) : [],
);
const tideNowHeight = $derived.by(() => {
  if (!tide || reading.tideNowMs === undefined) return undefined;
  return tideHoverReading(tide.events, reading.tideNowMs, undefined, undefined, tide.samples)
    ?.tideHeightMeters;
});
const depthSamples = $derived.by(() => {
  const depthMeters = reading.tideDepthMeters;
  if (depthMeters === undefined || reading.tideDepthStale || tideNowHeight === undefined) return [];
  return samples.map((sample) => ({
    ...sample,
    heightMeters: depthMeters + sample.heightMeters - tideNowHeight,
  }));
});
const range = $derived.by(() => {
  if (samples.length === 0) return undefined;
  let minimum = samples[0].heightMeters;
  let maximum = minimum;
  for (const sample of samples) {
    minimum = Math.min(minimum, sample.heightMeters);
    maximum = Math.max(maximum, sample.heightMeters);
  }
  for (const sample of depthSamples) {
    minimum = Math.min(minimum, sample.heightMeters);
    maximum = Math.max(maximum, sample.heightMeters);
  }
  if (minimum === maximum) maximum = minimum + 1;
  return { minimum, maximum };
});
function pathFor(values: Array<{ timeMs: number; heightMeters: number }>): string {
  if (!range || samples.length < 2) return '';
  const start = samples[0].timeMs;
  const span = samples[samples.length - 1].timeMs - start || 1;
  const heightSpan = range.maximum - range.minimum || 1;
  return values
    .map((sample, index) => {
      const x = LEFT + ((sample.timeMs - start) / span) * PLOT_WIDTH;
      const y = TOP + (1 - (sample.heightMeters - range.minimum) / heightSpan) * PLOT_HEIGHT;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}
const curvePath = $derived(pathFor(samples));
const depthPath = $derived(pathFor(depthSamples));
const ticks = $derived(
  range
    ? Array.from({ length: 5 }, (_, index) => {
        const fraction = index / 4;
        return {
          fraction,
          value: range.minimum + fraction * (range.maximum - range.minimum),
          y: TOP + (1 - fraction) * PLOT_HEIGHT,
        };
      })
    : [],
);
const timeTicks = $derived.by(() => {
  if (samples.length < 2) return [];
  const start = samples[0].timeMs;
  const end = samples[samples.length - 1].timeMs;
  return Array.from({ length: 5 }, (_, index) => {
    const fraction = index / 4;
    return { fraction, timeMs: start + fraction * (end - start) };
  });
});

let svg = $state<SVGSVGElement>();
let hoverFraction = $state<number | undefined>();
const hover = $derived.by(() => {
  if (hoverFraction === undefined || !tide || samples.length < 2) return undefined;
  const start = samples[0].timeMs;
  const end = samples[samples.length - 1].timeMs;
  return tideHoverReading(
    tide.events,
    start + hoverFraction * (end - start),
    reading.tideDepthStale ? undefined : reading.tideDepthMeters,
    reading.tideNowMs,
    tide.samples,
  );
});

function pointerMove(event: PointerEvent): void {
  if (!expanded || !svg) return;
  const bounds = svg.getBoundingClientRect();
  const x = ((event.clientX - bounds.left) / bounds.width) * WIDTH;
  hoverFraction = Math.max(0, Math.min(1, (x - LEFT) / PLOT_WIDTH));
}

function keyboardScrub(event: KeyboardEvent): void {
  if (!expanded || samples.length < 2) return;
  const start = samples[0].timeMs;
  const end = samples[samples.length - 1].timeMs;
  const nowFraction = Math.max(
    0,
    Math.min(1, ((reading.tideNowMs ?? start) - start) / (end - start || 1)),
  );
  if (event.key === 'Home') hoverFraction = 0;
  else if (event.key === 'End') hoverFraction = 1;
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    const step = ((event.shiftKey ? 60 : 6) * 60_000) / (end - start || 1);
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    hoverFraction = Math.max(0, Math.min(1, (hoverFraction ?? nowFraction) + direction * step));
  } else return;
  event.preventDefault();
}
</script>

<div class="tide-tile" class:tide-tile--expanded={expanded}>
  <button
    type="button"
    class="tile tide-main"
    aria-label={`${actionLabel}: ${label}, ${reading.value} ${reading.unit}`}
    title={reading.state === 'never' ? sensorGloss : actionLabel}
    onclick={onOpen}
    onkeydown={keyboardScrub}
  >
    <span class="tide-heading">
      <span class="title">{label}</span>
      {#if tide}
        <span class="station">{tide.station.name}</span>
      {/if}
    </span>
    {#if curvePath}
      <svg
        bind:this={svg}
        class="tide-chart"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        aria-hidden="true"
        onpointermove={pointerMove}
        onpointerleave={() => (hoverFraction = undefined)}
      >
        {#if expanded}
          {#each ticks as tick (tick.value)}
            <line class="grid" x1={LEFT} x2={WIDTH - RIGHT} y1={tick.y} y2={tick.y} />
            <text class="axis" x={LEFT - 7} y={tick.y + 4} text-anchor="end">
              {formatTideHeight(tick.value, unitsMode)}
            </text>
          {/each}
          {#each timeTicks as tick (tick.timeMs)}
            {@const x = LEFT + tick.fraction * PLOT_WIDTH}
            <line class="grid" x1={x} x2={x} y1={TOP} y2={HEIGHT - BOTTOM} />
            <text class="axis" {x} y={HEIGHT - 9} text-anchor="middle">
              {formatClockTime(tick.timeMs)}
            </text>
          {/each}
        {/if}
        <path class="curve" d={curvePath} fill="none" />
        {#if depthPath}
          <path class="depth-curve" d={depthPath} fill="none" />
        {/if}
        {#if expanded && hoverFraction !== undefined}
          {@const x = LEFT + hoverFraction * PLOT_WIDTH}
          <line class="cursor" x1={x} x2={x} y1={TOP} y2={HEIGHT - BOTTOM} />
        {/if}
      </svg>
    {:else}
      <span class="empty">{sensorGloss}</span>
    {/if}
    <span class="current-value"><strong>{reading.value}</strong> {reading.unit}</span>
    {#if expanded}
      <span class="legend">
        <i class="tide-key"></i>Tide
        {#if depthPath}
          <i class="depth-key"></i>Estimated depth
        {/if}
      </span>
    {/if}
  </button>

  {#if expanded && onSettings}
    <button type="button" class="btn btn-pill tide-settings" onclick={onSettings}>
      <Settings size={16} aria-hidden="true" />
      Tide station settings
    </button>
  {/if}

  {#if expanded && hover}
    <div class="tide-tooltip" style={`--hover-x: ${(hoverFraction ?? 0) * 100}%`} role="status">
      <strong>{formatMonthDay(hover.timeMs)} · {formatClockTime(hover.timeMs)}</strong>
      <span>Tide {formatTideHeight(hover.tideHeightMeters, unitsMode)}</span>
      {#if hover.estimatedDepthMeters !== undefined}
        <span>Estimated depth {formatTideHeight(hover.estimatedDepthMeters, unitsMode)}</span>
      {/if}
    </div>
  {/if}
</div>

<style>
.tide-tile {
  position: relative;
  display: flex;
  flex: 1;
  min-inline-size: 0;
}
.tide-main {
  position: relative;
  display: grid;
  grid-template-rows: auto minmax(5rem, 1fr);
  inline-size: 100%;
  padding: var(--space-2);
  overflow: hidden;
  text-align: start;
}
.tide-heading {
  z-index: 1;
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
}
.title {
  font-weight: 700;
}
.station,
.empty {
  color: var(--text-muted);
  font-size: var(--text-xs);
}
.station {
  max-inline-size: 65%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tide-chart {
  inline-size: 100%;
  block-size: 100%;
  min-block-size: 5rem;
}
.curve {
  stroke: var(--accent);
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.depth-curve {
  stroke: var(--text);
  stroke-width: 3;
  stroke-dasharray: 8 5;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.grid {
  stroke: var(--border);
  stroke-width: 1;
  opacity: 0.7;
}
.axis {
  fill: var(--text-muted);
  font-family: var(--font-ui);
  font-size: 10px;
}
.cursor {
  stroke: var(--text);
  stroke-width: 1;
  stroke-dasharray: 3 3;
}
.current-value {
  position: absolute;
  inset-inline-end: var(--space-3);
  inset-block-end: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--surface-overlay);
  font-variant-numeric: tabular-nums;
}
.current-value strong {
  font-family: var(--font-mono);
  font-size: var(--text-readout);
}
.legend {
  position: absolute;
  inset-inline-start: var(--space-4);
  inset-block-end: var(--space-3);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-xs);
}
.legend i {
  display: inline-block;
  inline-size: 1.5rem;
  block-size: 3px;
}
.tide-key {
  background: var(--accent);
}
.depth-key {
  background: var(--text);
}
.tide-tile--expanded .tide-main {
  grid-template-rows: auto 1fr;
  padding: var(--space-4);
}
.tide-tile--expanded .tide-chart {
  min-block-size: 0;
}
.tide-settings {
  position: absolute;
  inset-block-start: calc(var(--space-3) + env(safe-area-inset-top));
  inset-inline-end: calc(var(--space-3) + env(safe-area-inset-right));
  z-index: 2;
}
.tide-tooltip {
  position: absolute;
  inset-block-start: 18%;
  inset-inline-start: clamp(6rem, var(--hover-x), calc(100% - 6rem));
  z-index: 3;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-inline-size: 11rem;
  padding: var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-overlay);
  box-shadow: var(--shadow-overlay);
  pointer-events: none;
  transform: translateX(-50%);
}
</style>
