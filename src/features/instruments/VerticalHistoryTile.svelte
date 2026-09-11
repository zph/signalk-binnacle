<script lang="ts">
import type { ZoneState } from '$shared/signalk';
import TileStateBadge from './TileStateBadge.svelte';
import { tileAccessibleLabel } from './tile-accessibility';
import type { TileReading } from './tile-catalog';
import type { TileHistoryPoint } from './tile-history.svelte';
import { type VerticalHistoryMode, verticalHistoryGeometry } from './vertical-history';
import {
  DEFAULT_VERTICAL_HISTORY_WINDOW_MINUTES,
  VERTICAL_HISTORY_WINDOW_MINUTES,
  type VerticalHistoryWindowMinutes,
  verticalHistoryWindowLabel,
} from './vertical-history-window';

interface Props {
  label: string;
  reading: TileReading;
  zone: ZoneState;
  sensorGloss: string;
  abbr?: string;
  mode: VerticalHistoryMode;
  points: readonly TileHistoryPoint[];
  maximumPoints?: readonly TileHistoryPoint[];
  nowMs: number;
  windowMinutes?: VerticalHistoryWindowMinutes;
  onWindowChange?: (minutes: VerticalHistoryWindowMinutes) => void;
  staleAgeText?: string;
  expanded?: boolean;
  actionLabel?: string;
  onOpen?: () => void;
}

const {
  label,
  reading,
  zone,
  sensorGloss,
  abbr,
  mode,
  points,
  maximumPoints = [],
  nowMs,
  windowMinutes = DEFAULT_VERTICAL_HISTORY_WINDOW_MINUTES,
  onWindowChange = () => {},
  staleAgeText,
  expanded = false,
  actionLabel = 'Expand instrument',
  onOpen,
}: Props = $props();

const labelText = $derived(
  `${label}${reading.referenceLabel ? ` (${reading.referenceLabel})` : ''}`,
);
const geometry = $derived(
  verticalHistoryGeometry(points, nowMs, mode, windowMinutes * 60_000, maximumPoints),
);
const accessibleDelta = $derived(
  geometry.deltaLabel
    ? `${geometry.deltaLabel.replace(' Δ', '')}${mode === 'speed' ? ' knots' : ''}`
    : undefined,
);
const accessibleLabel = $derived(
  `${tileAccessibleLabel(labelText, reading, zone, sensorGloss, actionLabel)} ${verticalHistoryWindowLabel(windowMinutes)} vertical history, newest at top.${accessibleDelta ? ` Historical range ${accessibleDelta}.` : ''}${mode === 'speed' ? ' Solid line average, dashed line maximum.' : ''}`,
);
const midpointLabel = $derived(verticalHistoryWindowLabel(windowMinutes / 2));
const windowLabel = $derived(verticalHistoryWindowLabel(windowMinutes));
const windowIndex = $derived(Math.max(0, VERTICAL_HISTORY_WINDOW_MINUTES.indexOf(windowMinutes)));

function changeWindow(event: Event): void {
  const index = Number((event.currentTarget as HTMLInputElement).value);
  const minutes = VERTICAL_HISTORY_WINDOW_MINUTES[index];
  if (minutes !== undefined) onWindowChange(minutes);
}
</script>

<div
  class="tile card-frame tile--vertical-history"
  class:tile--warning={zone === 'warning'}
  class:tile--alarm={zone === 'alarm'}
  class:tile--stale={reading.state === 'stale'}
  class:tile--empty={reading.state === 'never'}
  class:tile--expanded={expanded}
>
  <button type="button" class="history-activate" aria-label={accessibleLabel} onclick={onOpen}>
    {#if reading.state === 'never'}
      <span class="value"><span class="muted-note">{sensorGloss}</span></span>
    {:else}
      <span class="history-readout">
        <span class="num">{reading.value}</span>
        {#if reading.unit}
          <span class="unit">{reading.unit}</span>
        {/if}
      </span>
      <span class="history-scale num" aria-hidden="true">
        <span>{geometry.scale[0]}</span>
        <span>{geometry.scale[1]}</span>
        <span>{geometry.scale[2]}</span>
      </span>
      <span class="history-plot" aria-hidden="true">
        <svg
          class="history-trace"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <title>{abbr ?? label} {windowLabel} history</title>
          {#each [0, 20, 40, 60, 80, 100] as y (y)}
            <line class="time-grid" x1="0" x2="100" y1={y} y2={y} />
          {/each}
          {#each [0, 50, 100] as x (x)}
            <line
              class:center-reference={mode === 'angle' && x === 50}
              x1={x}
              x2={x}
              y1="0"
              y2="100"
            />
          {/each}
          {#each geometry.paths as path (path)}
            <path class="squiggle" d={path} />
          {/each}
          {#each geometry.maximumPaths as path (path)}
            <path class="squiggle squiggle--maximum" d={path} />
          {/each}
          {#if geometry.current}
            <circle class="current" cx={geometry.current.x} cy={geometry.current.y} r="2.25" />
          {/if}
        </svg>
        <span class="time-axis num">
          <span>Now</span>
          <span>-{midpointLabel}</span>
          <span>-{windowLabel}</span>
        </span>
      </span>
    {/if}

    <span class="history-footer">
      {#if reading.state !== 'never' && staleAgeText}
        <span class="tile-secondary">{staleAgeText}</span>
      {/if}
      <span class="caps-label abbr">{abbr ?? labelText}</span>
      {#if geometry.deltaLabel}
        <span class="history-delta num" aria-hidden="true">{geometry.deltaLabel}</span>
      {/if}
      <TileStateBadge state={reading.state} />
    </span>
  </button>

  <label
    class="history-window-control"
    onpointerdown={(event) => event.stopPropagation()}
    onpointerup={(event) => event.stopPropagation()}
  >
    <span class="visually-hidden">{abbr ?? labelText} history window</span>
    <input
      class="range history-window-range"
      type="range"
      min="0"
      max={VERTICAL_HISTORY_WINDOW_MINUTES.length - 1}
      step="1"
      value={windowIndex}
      aria-label={`${abbr ?? labelText} history window`}
      aria-valuetext={windowLabel}
      oninput={changeWindow}
    >
    <output class="history-window-value num">{windowLabel}</output>
  </label>
</div>

<style>
.tile--vertical-history {
  align-items: stretch;
  justify-content: flex-start;
  gap: var(--space-1);
  overflow: hidden;
  padding: var(--space-2);
  text-align: start;
}
.history-activate {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  gap: var(--space-1);
  min-block-size: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
}
.history-window-control {
  display: grid;
  flex: 0 0 auto;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-2);
}
.history-window-range {
  min-block-size: var(--control-size);
}
.history-window-value {
  min-inline-size: 2.5rem;
  color: var(--text-muted);
  font-size: var(--text-xs);
  text-align: end;
}

.history-delta {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: var(--text-sm);
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
}

.history-readout {
  display: flex;
  align-items: baseline;
  justify-content: center;
  min-block-size: 0;
}
.history-readout .num {
  font-size: var(--text-readout-lg);
  font-weight: 800;
}

.history-scale {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  color: var(--text-muted);
  font-size: var(--text-xs);
  line-height: 1;
}
.history-scale span:nth-child(2) {
  text-align: center;
}
.history-scale span:last-child {
  text-align: end;
}

.history-plot {
  display: grid;
  flex: 1 1 auto;
  grid-template-columns: minmax(0, 1fr) auto;
  min-block-size: 0;
  overflow: hidden;
}
.history-trace {
  inline-size: 100%;
  block-size: 100%;
  min-block-size: var(--tile-min-height);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--surface) 72%, transparent);
  overflow: hidden;
}
.history-trace line {
  stroke: var(--border);
  stroke-width: 0.75;
  vector-effect: non-scaling-stroke;
}
.history-trace .time-grid {
  stroke-dasharray: 2 3;
}
.history-trace .center-reference {
  stroke: var(--text-muted);
  stroke-dasharray: 3 3;
  stroke-width: 1.25;
}
.squiggle {
  fill: none;
  stroke: var(--accent);
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}
.squiggle--maximum {
  stroke-dasharray: 4 3;
  stroke-width: 1.5;
  opacity: 0.72;
}
.current {
  fill: var(--select);
  stroke: var(--surface-raised);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}
.time-axis {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding-block: 0.1rem;
  padding-inline-start: var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-xs);
  line-height: 1;
}

.history-footer {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  min-inline-size: 0;
  line-height: 1;
}
.history-footer > .caps-label {
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tile--stale .squiggle {
  stroke: var(--text-muted);
}

.tile--expanded {
  display: flex;
}
.tile--expanded .history-activate {
  display: grid;
  grid-template-columns: minmax(10rem, 1fr) minmax(12rem, 3fr);
  grid-template-rows: auto auto minmax(0, 1fr);
  column-gap: var(--space-5);
}
.tile--expanded .history-readout,
.tile--expanded .history-scale,
.tile--expanded .history-footer {
  grid-column: 1;
}
.tile--expanded .history-readout {
  align-self: end;
}
.tile--expanded .history-readout .num {
  font-size: clamp(4rem, 16vmin, 12rem);
}
.tile--expanded .history-scale {
  grid-column: 2;
  grid-row: 2;
  font-size: clamp(var(--text-sm), 2vmin, var(--text-xl));
}
.tile--expanded .history-plot {
  grid-column: 2;
  grid-row: 3;
}
.tile--expanded .history-footer {
  align-self: start;
  grid-row: 3;
}
.tile--expanded .history-trace {
  min-block-size: 0;
}
.tile--expanded .time-axis {
  font-size: clamp(var(--text-sm), 2vmin, var(--text-xl));
}

@media (max-width: 700px) {
  .tile--expanded .history-activate {
    display: flex;
  }
  .tile--expanded .history-readout .num {
    font-size: clamp(3rem, 18vmin, 8rem);
  }
}
</style>
