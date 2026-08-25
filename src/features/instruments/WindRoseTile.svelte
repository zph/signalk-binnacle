<script lang="ts">
import { formatSignedAngleOr, RAD_TO_DEG } from '$shared/lib';
import type { ZoneState } from '$shared/signalk';
import TileStateBadge from './TileStateBadge.svelte';
import type { InstrumentMetric, TileReading } from './tile-catalog';

interface Props {
  label: string;
  reading: TileReading;
  zone: ZoneState;
  depthZone: ZoneState;
  sensorGloss: string;
  staleAgeText?: string;
  onOpen?: () => void;
}

const { label, reading, zone, depthZone, sensorGloss, staleAgeText, onOpen }: Props = $props();
const rose = $derived(reading.windRose);

function metricText(metric: InstrumentMetric | undefined, angle = false): string {
  if (!metric || metric.state === 'never') return 'Unavailable';
  const value = `${metric.value}${metric.unit ? ` ${metric.unit}` : ''}`;
  return angle && metric.angleRad !== undefined
    ? `${value}, ${formatSignedAngleOr(metric.angleRad)} degrees`
    : value;
}

const accessibleLabel = $derived(
  rose
    ? `${label}. Apparent wind ${metricText(rose.apparent, true)}. True wind ${metricText(rose.trueWind, true)}. Speed over ground ${metricText(rose.speedOverGround)}. Depth ${metricText(rose.depth)}${depthZone === 'alarm' ? ', alarm' : depthZone === 'warning' ? ', warning' : ''}${reading.state === 'stale' ? '. Wind data stale' : ''}. Open details`
    : `${label}, ${sensorGloss}. Open details`,
);
const apparentDeg = $derived((rose?.apparent.angleRad ?? 0) * RAD_TO_DEG);
const trueDeg = $derived((rose?.trueWind.angleRad ?? 0) * RAD_TO_DEG);
</script>

<button
  type="button"
  class="tile card-frame tile--wide tile--wind-rose"
  class:tile--warning={zone === 'warning'}
  class:tile--alarm={zone === 'alarm'}
  class:tile--stale={reading.state === 'stale'}
  class:tile--empty={reading.state === 'never'}
  aria-label={accessibleLabel}
  onclick={onOpen}
>
  <div class="rose-layout">
    <svg class="rose" viewBox="0 0 200 190" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle class="rose-ring" cx="100" cy="86" r="68" />
      <path class="boat" d="M100 27 L91 104 L100 96 L109 104 Z" />
      <g class="ticks">
        <path d="M100 18 V29 M100 154 V143 M32 86 H43 M168 86 H157" />
        <path d="M52 38 L60 46 M148 38 L140 46 M52 134 L60 126 M148 134 L140 126" />
        <path d="M66 27 L70 35 M134 27 L130 35 M41 52 L49 56 M159 52 L151 56" />
        <path d="M41 120 L49 116 M159 120 L151 116 M66 145 L70 137 M134 145 L130 137" />
      </g>
      <g class="rose-labels">
        <text x="100" y="14">0</text>
        <text x="153" y="36">45</text>
        <text x="176" y="90">90</text>
        <text x="151" y="145">135</text>
        <text x="100" y="166">180</text>
        <text x="49" y="145">135</text>
        <text x="24" y="90">90</text>
        <text x="47" y="36">45</text>
      </g>
      {#if rose?.trueWind.angleRad !== undefined}
        <g transform="rotate({trueDeg} 100 86)">
          <path class="true-needle" d="M100 27 V91" />
          <circle class="true-tip" cx="100" cy="27" r="4" />
        </g>
      {/if}
      {#if rose?.apparent.angleRad !== undefined}
        <g transform="rotate({apparentDeg} 100 86)">
          <path class="apparent-needle" d="M100 22 L94 34 H98 V92 H102 V34 H106 Z" />
        </g>
      {/if}
      <circle class="hub" cx="100" cy="86" r="4" />
      <text class="side side--port" x="39" y="104">P</text>
      <text class="side side--starboard" x="161" y="104">S</text>
    </svg>

    <div class="wind-readouts" aria-hidden="true">
      <span><b>AWS</b> {rose?.apparent.value ?? '---'} {rose?.apparent.unit ?? ''}</span>
      <span><b>AWA</b> {formatSignedAngleOr(rose?.apparent.angleRad)}</span>
      <span><b>TWS</b> {rose?.trueWind.value ?? '---'} {rose?.trueWind.unit ?? ''}</span>
      <span><b>TWA</b> {formatSignedAngleOr(rose?.trueWind.angleRad)}</span>
    </div>

    <div class="corner corner--sog">
      <span class="corner-label">SOG</span>
      <span
        ><span class="num">{rose?.speedOverGround.value ?? '---'}</span>
        <span class="unit">{rose?.speedOverGround.unit ?? ''}</span></span
      >
    </div>
    <div
      class="corner corner--depth"
      class:corner--warning={depthZone === 'warning'}
      class:corner--alarm={depthZone === 'alarm'}
    >
      <span class="corner-label">Depth</span>
      <span
        ><span class="num">{rose?.depth.value ?? '---'}</span>
        <span class="unit">{rose?.depth.unit ?? ''}</span></span
      >
      {#if depthZone === 'warning'}
        <span class="corner-state">Warning</span>
      {:else if depthZone === 'alarm'}
        <span class="corner-state">Alarm</span>
      {/if}
    </div>
  </div>

  {#if staleAgeText}
    <span class="tile-secondary">{staleAgeText}</span>
  {/if}
  <span class="caps-label">{label}</span>
  <TileStateBadge state={reading.state} {zone} />
</button>

<style>
.tile--wind-rose,
.tile--empty.tile--wind-rose {
  grid-column: 1 / -1;
}
.rose-layout {
  position: relative;
  inline-size: min(100%, 24rem);
  min-block-size: 12rem;
}
.rose {
  inline-size: 100%;
  block-size: 12rem;
}
.rose-ring,
.ticks,
.true-needle {
  fill: none;
  stroke: var(--text-muted);
  vector-effect: non-scaling-stroke;
}
.rose-ring {
  stroke-width: 1.5;
}
.ticks {
  stroke-width: 1.5;
}
.rose-labels,
.side {
  fill: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 8px;
  text-anchor: middle;
}
.side {
  font-weight: 700;
}
.boat {
  fill: var(--accent-tint-strong);
  stroke: var(--text-muted);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}
.apparent-needle {
  fill: var(--accent);
}
.true-needle {
  stroke: var(--select);
  stroke-width: 2.5;
  stroke-dasharray: 5 4;
}
.true-tip {
  fill: var(--surface-raised);
  stroke: var(--select);
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}
.hub {
  fill: var(--text);
}
.tile--stale .apparent-needle,
.tile--stale .true-tip {
  fill: var(--text-muted);
}
.tile--stale .true-needle,
.tile--stale .true-tip {
  stroke: var(--text-muted);
}
.wind-readouts {
  position: absolute;
  inset-block-start: 3.65rem;
  inset-inline-start: 50%;
  translate: -50% 0;
  display: grid;
  grid-template-columns: auto auto;
  gap: var(--space-1) var(--space-2);
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  white-space: nowrap;
}
.wind-readouts b {
  color: var(--text);
}
.corner {
  position: absolute;
  inset-block-end: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
}
.corner--sog {
  inset-inline-start: 0;
}
.corner--depth {
  inset-inline-end: 0;
  align-items: flex-end;
}
.corner .num {
  font-size: var(--text-readout);
}
.corner-label,
.corner-state {
  color: var(--text-muted);
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: var(--tracking-caps);
}
.corner--warning {
  border-color: var(--warning);
  background: var(--warning-tint);
  color: var(--warning);
}
.corner--alarm {
  border-color: var(--alarm);
  background: var(--alarm-tint);
  color: var(--alarm);
}
.corner--warning .corner-label,
.corner--warning .corner-state {
  color: var(--warning);
}
.corner--alarm .corner-label,
.corner--alarm .corner-state {
  color: var(--alarm);
}
</style>
