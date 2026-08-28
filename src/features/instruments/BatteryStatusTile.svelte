<script lang="ts">
import { Tween } from 'svelte/motion';
import { prefersReducedMotion } from '$shared/lib';
import type { ZoneState } from '$shared/signalk';
import TileStateBadge from './TileStateBadge.svelte';
import { tileAccessibleLabel } from './tile-accessibility';
import type { InstrumentMetric, TileReading } from './tile-catalog';

interface Props {
  label: string;
  reading: TileReading;
  zone: ZoneState;
  sensorGloss: string;
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
  staleAgeText,
  expanded = false,
  actionLabel = 'Expand instrument',
  onOpen,
}: Props = $props();

const battery = $derived(reading.battery);

// The drawn charge fraction animates between samples, so the fill and the percent inside it count
// toward the new value instead of snapping. Reduced motion lands on the sample immediately.
const charge = new Tween<number | undefined>(undefined, {
  duration: prefersReducedMotion() ? 0 : 600,
  easing: (t: number) => t,
});
$effect(() => {
  charge.set(battery?.soc.siValue);
});

// Until the tween emits (SSR, first paint), the drawn charge is the reading itself, so the tile
// never renders an empty battery for the value it already has.
const displayedFraction = $derived(
  battery?.soc.siValue === undefined ? undefined : Math.max(0, Math.min(1, battery.soc.siValue)),
);
const drawnFraction = $derived(charge.current ?? displayedFraction);
// 64 units of vertical travel inside the body (interior y 8..72); the fill rises from the bottom
// and spans the full interior at 100%.
const fillY = $derived(drawnFraction === undefined ? undefined : 72 - 64 * drawnFraction);
const fillHeight = $derived(drawnFraction === undefined ? 0 : 64 * drawnFraction);
const percentText = $derived(
  drawnFraction === undefined ? '--' : `${Math.round(drawnFraction * 100)}%`,
);

const stats = $derived([
  { id: 'power', caps: 'WATTS', metric: battery?.power },
  { id: 'current', caps: 'CURRENT', metric: battery?.current },
  { id: 'voltage', caps: 'VOLTAGE', metric: battery?.voltage },
] as const);

function metricValue(metric: InstrumentMetric | undefined): string {
  if (!metric || metric.state === 'never') return '--';
  return metric.value;
}
function metricUnit(metric: InstrumentMetric | undefined): string {
  if (!metric || metric.state === 'never') return '';
  return metric.unit;
}
function metricLine(metric: InstrumentMetric | undefined): string {
  if (!metric || metric.state === 'never') return 'no data';
  return `${metric.value}${metric.unit ? ` ${metric.unit}` : ''}`;
}

const accessibleLabel = $derived(
  battery
    ? `${label}. ${metricLine(battery.soc)} charged. Power ${metricLine(battery.power)}. Current ${metricLine(battery.current)}. Voltage ${metricLine(battery.voltage)}${zone === 'alarm' ? ', alarm' : zone === 'warning' ? ', warning' : ''}${reading.state === 'stale' ? '. Battery data stale' : ''}. ${actionLabel}`
    : tileAccessibleLabel(label, reading, zone, sensorGloss, actionLabel),
);
</script>

<button
  type="button"
  class="tile card-frame tile--visual tile--battery"
  class:tile--warning={zone === 'warning'}
  class:tile--alarm={zone === 'alarm'}
  class:tile--stale={reading.state === 'stale'}
  class:tile--empty={reading.state === 'never'}
  class:tile--expanded={expanded}
  aria-label={accessibleLabel}
  onclick={onOpen}
>
  {#if reading.state === 'never'}
    <span class="value"><span class="muted-note">{sensorGloss}</span></span>
  {:else}
    <span class="battery-face">
      <svg
        class="battery-drawing"
        viewBox="0 0 48 76"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <!-- Vertical battery: cap on top, rounded body, fill rising from the bottom. -->
        <rect x="16" y="0" width="16" height="6" rx="2" fill="currentColor" />
        <rect x="2" y="6" width="44" height="68" rx="5" fill="none" stroke="currentColor" />
        {#if drawnFraction !== undefined}
          <rect
            class="fill"
            class:sev-danger={zone === 'alarm'}
            class:sev-warning={zone === 'warning'}
            x="4"
            y={fillY}
            width="40"
            height={fillHeight}
            fill="currentColor"
          />
        {/if}
        <!-- The percent rides inside the body, centered on the full charge range so it stays legible
             over both the lit fill and the empty interior. -->
        <text class="percent" x="24" y="44" text-anchor="middle">{percentText}</text>
      </svg>
      <span class="battery-stats">
        {#each stats as stat (stat.id)}
          <span class="battery-stat">
            <span class="stat-value">
              <span class="num">{metricValue(stat.metric)}</span>
              <span class="unit">{metricUnit(stat.metric)}</span>
            </span>
            <span class="caps-label">{stat.caps}</span>
          </span>
        {/each}
      </span>
    </span>
  {/if}
  <span class="tile-footer">
    {#if reading.state !== 'never'}
      {#if staleAgeText}
        <span class="tile-secondary">{staleAgeText}</span>
      {/if}
    {/if}
    <span class="caps-label">{label}</span>
    <TileStateBadge state={reading.state} />
  </span>
</button>

<style>
.battery-face {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  justify-content: center;
  gap: var(--space-2);
  inline-size: 100%;
  min-block-size: 0;
  flex: 1 1 auto;
  overflow: hidden;
}
.battery-stats {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-block-size: 0;
}
.battery-drawing {
  inline-size: min(30%, 5.5rem);
  max-block-size: 100%;
  flex-shrink: 0;
}
.percent {
  fill: var(--text);
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 700;
}
.tile--stale .battery-drawing,
.tile--stale .fill {
  color: var(--text-muted);
}
.battery-stats {
  flex: 1;
  gap: var(--space-1);
  align-self: stretch;
  inline-size: 100%;
  min-inline-size: 0;
}
.battery-stat {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  inline-size: 100%;
  min-inline-size: 0;
  gap: 0.05rem;
}
.stat-value {
  display: inline-flex;
  align-items: baseline;
  justify-content: flex-start;
  inline-size: 100%;
  min-inline-size: 0;
  gap: var(--space-1);
}
.stat-value .num {
  font-size: var(--text-readout);
  line-height: var(--hero-leading);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stat-value .unit {
  flex-shrink: 0;
  color: var(--text-muted);
  font-size: var(--text-xs);
}
.tile--expanded .battery-drawing {
  inline-size: min(18vmin, 12rem);
}
.tile--expanded .stat-value .num {
  font-size: var(--text-readout-lg);
}
</style>
