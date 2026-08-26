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
const dialTicks = Array.from({ length: 36 }, (_, index) => ({
  angle: index * 10,
  major: index % 3 === 0,
}));
const dialLabels = [
  { angle: 0, label: 'N' },
  { angle: 30, label: '30' },
  { angle: 60, label: '60' },
  { angle: 90, label: 'E' },
  { angle: 120, label: '120' },
  { angle: 150, label: '150' },
  { angle: 180, label: 'S' },
  { angle: 210, label: '210' },
  { angle: 240, label: '240' },
  { angle: 270, label: 'W' },
  { angle: 300, label: '300' },
  { angle: 330, label: '330' },
];

function metricText(metric: InstrumentMetric | undefined, angle = false): string {
  if (!metric || metric.state === 'never') return 'Unavailable';
  const value = `${metric.value}${metric.unit ? ` ${metric.unit}` : ''}`;
  return angle && metric.angleRad !== undefined
    ? `${value}, ${formatSignedAngleOr(metric.angleRad)} degrees`
    : value;
}

const accessibleLabel = $derived(
  rose
    ? `${label}. Heading ${metricText(rose.heading)}. Apparent wind ${metricText(rose.apparent, true)}. True wind ${metricText(rose.trueWind, true)}. Speed over ground ${metricText(rose.speedOverGround)}. Depth ${metricText(rose.depth)}${depthZone === 'alarm' ? ', alarm' : depthZone === 'warning' ? ', warning' : ''}${reading.state === 'stale' ? '. Wind data stale' : ''}. Open details`
    : `${label}, ${sensorGloss}. Open details`,
);
const apparentDeg = $derived((rose?.apparent.angleRad ?? 0) * RAD_TO_DEG);
const trueDeg = $derived((rose?.trueWind.angleRad ?? 0) * RAD_TO_DEG);
const headingDeg = $derived((rose?.heading.siValue ?? 0) * RAD_TO_DEG);
const cardRotation = $derived(-headingDeg);
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
    <svg class="rose" viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle class="fixed-dial" cx="500" cy="500" r="444" />
      <path class="port-sector" d="M86 337 A444 444 0 0 1 344 84" />
      <path class="starboard-sector" d="M656 84 A444 444 0 0 1 914 337" />

      <g class="compass-card" transform="rotate({cardRotation} 500 500)">
        <circle class="card-backplate" cx="500" cy="500" r="354" />
        {#each dialTicks as tick (tick.angle)}
          <line
            class:major-tick={tick.major}
            class="dial-tick"
            x1="500"
            y1={tick.major ? 61 : 69}
            x2="500"
            y2={tick.major ? 99 : 89}
            transform="rotate({tick.angle} 500 500)"
          />
        {/each}
        {#each dialLabels as item (item.angle)}
          <g transform="rotate({item.angle} 500 500)">
            <text
              class:cardinal={item.label.length === 1}
              class="dial-label"
              x="500"
              y="158"
              transform="rotate({-item.angle} 500 158)"
            >
              {item.label}
            </text>
          </g>
        {/each}
      </g>

      <g class="crosshair">
        <path d="M500 166 V360 M500 640 V834" />
        <path d="M166 500 H360 M640 500 H834" />
      </g>
      <path
        class="boat-outline"
        d="M500 260 C430 342 397 512 410 720 M500 260 C570 342 603 512 590 720"
      />

      {#if rose?.apparent.angleRad !== undefined}
        <g class="wind-pointer wind-pointer--apparent" transform="rotate({apparentDeg} 500 500)">
          <path class="apparent-pointer" d="M447 67 L500 24 L553 67 L512 294 Q500 326 488 294 Z" />
          <text class="pointer-label" x="500" y="113">A</text>
        </g>
      {/if}
      {#if rose?.trueWind.angleRad !== undefined}
        <g class="wind-pointer wind-pointer--true" transform="rotate({trueDeg} 500 500)">
          <path class="true-pointer" d="M462 75 L500 42 L538 75 L508 260 Q500 284 492 260 Z" />
          <text class="pointer-label" x="500" y="113">T</text>
        </g>
      {/if}

      <g class="wind-counter wind-counter--apparent">
        <text class="counter-label" x="105" y="72">AWS</text>
        <text class="counter-value apparent-color" x="105" y="132">
          {rose?.apparent.value ?? '---'}
        </text>
        <text class="counter-detail apparent-color" x="105" y="169">
          {rose?.apparent.unit ?? ''}
          · AWA {formatSignedAngleOr(rose?.apparent.angleRad)}
        </text>
      </g>
      <g class="wind-counter wind-counter--true">
        <text class="counter-label" x="895" y="72">TWS</text>
        <text class="counter-value true-color" x="895" y="132">
          {rose?.trueWind.value ?? '---'}
        </text>
        <text class="counter-detail true-color" x="895" y="169">
          {rose?.trueWind.unit ?? ''}
          · TWA {formatSignedAngleOr(rose?.trueWind.angleRad)}
        </text>
      </g>

      <g class="heading-window">
        <rect x="370" y="18" width="260" height="112" rx="25" />
        <text x="500" y="98">{rose?.heading.value ?? '---'}</text>
        {#if rose?.heading.referenceLabel}
          <text class="heading-reference" x="615" y="109">{rose.heading.referenceLabel}</text>
        {/if}
      </g>
    </svg>

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
  --wind-port: #8f0000;
  --wind-starboard: #008700;
  --wind-apparent: #ff9100;
  --wind-true: #d89a00;
  --wind-pointer-label: #170b00;
  grid-column: 1 / -1;
}
:global(:root[data-theme="dusk"]) .tile--wind-rose {
  --wind-port: #d0523e;
  --wind-starboard: #3fae6a;
  --wind-apparent: #ff9100;
  --wind-true: #ffcf4d;
  --wind-pointer-label: #0f1a24;
}
:global(:root[data-theme="night-red"]) .tile--wind-rose {
  --wind-port: #a23500;
  --wind-starboard: #c05800;
  --wind-apparent: #e04900;
  --wind-true: #ff9f00;
  --wind-pointer-label: #1a0000;
}
.rose-layout {
  position: relative;
  inline-size: min(100%, 26rem);
  aspect-ratio: 1;
}
.rose {
  display: block;
  inline-size: 100%;
  block-size: auto;
}
.fixed-dial,
.port-sector,
.starboard-sector,
.dial-tick,
.crosshair,
.boat-outline {
  fill: none;
}
.fixed-dial {
  stroke: color-mix(in srgb, var(--text-muted) 62%, var(--surface-raised));
  stroke-width: 82;
}
.port-sector,
.starboard-sector {
  stroke-width: 44;
  stroke-linecap: butt;
}
.port-sector {
  stroke: var(--wind-port);
}
.starboard-sector {
  stroke: var(--wind-starboard);
}
.card-backplate {
  fill: color-mix(in srgb, var(--surface) 55%, transparent);
  stroke: color-mix(in srgb, var(--border) 72%, transparent);
  stroke-width: 2;
}
.dial-tick {
  stroke: var(--text-muted);
  stroke-width: 2;
}
.dial-tick.major-tick {
  stroke: var(--text);
  stroke-width: 5;
}
.dial-label {
  fill: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 42px;
  font-weight: 600;
  text-anchor: middle;
}
.dial-label.cardinal {
  fill: var(--text);
  font-size: 50px;
  font-weight: 800;
}
.crosshair {
  opacity: 0.28;
  stroke: var(--text-muted);
  stroke-width: 2;
}
.boat-outline {
  opacity: 0.48;
  stroke: var(--text-muted);
  stroke-linecap: round;
  stroke-width: 4;
}
.apparent-pointer {
  fill: var(--wind-apparent);
  stroke: color-mix(in srgb, var(--wind-apparent) 70%, var(--text));
  stroke-width: 2;
}
.true-pointer {
  fill: var(--wind-true);
  stroke: color-mix(in srgb, var(--wind-true) 70%, var(--text));
  stroke-width: 2;
}
.pointer-label {
  fill: var(--wind-pointer-label);
  font-family: var(--font-sans);
  font-size: 58px;
  font-weight: 900;
  text-anchor: middle;
}
.wind-pointer--true .pointer-label {
  font-size: 50px;
}
.tile--stale .apparent-pointer,
.tile--stale .true-pointer {
  fill: var(--text-muted);
}
.wind-counter text,
.heading-window text {
  font-family: var(--font-mono);
  text-anchor: middle;
}
.counter-label {
  fill: var(--text-muted);
  font-size: 35px;
  font-weight: 800;
}
.counter-value {
  font-size: 66px;
  font-weight: 800;
}
.counter-detail {
  font-size: 27px;
  font-weight: 650;
}
.apparent-color {
  fill: var(--wind-apparent);
}
.true-color {
  fill: var(--wind-true);
}
.heading-window rect {
  fill: var(--surface-raised);
  stroke: var(--border);
  stroke-width: 4;
}
.heading-window text {
  fill: var(--text);
  font-size: 88px;
  font-weight: 800;
}
.heading-window .heading-reference {
  fill: var(--text-muted);
  font-size: 24px;
  font-weight: 700;
}
.corner {
  position: absolute;
  inset-block-end: 2.5%;
  min-inline-size: 24%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: var(--space-1) var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--surface-raised) 88%, transparent);
  text-align: start;
}
.corner--sog {
  inset-inline-start: 2.5%;
}
.corner--depth {
  inset-inline-end: 2.5%;
  align-items: flex-end;
  text-align: end;
}
.corner .num {
  font-family: var(--font-mono);
  font-size: var(--text-readout);
  font-weight: 750;
}
.corner .unit {
  margin-inline-start: var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-xs);
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
