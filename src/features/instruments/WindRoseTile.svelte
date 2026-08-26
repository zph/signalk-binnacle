<script lang="ts">
import { onDestroy } from 'svelte';
import { formatSignedAngleOr, prefersReducedMotion, RAD_TO_DEG } from '$shared/lib';
import type { ZoneState } from '$shared/signalk';
import TileStateBadge from './TileStateBadge.svelte';
import type { InstrumentMetric, TileReading } from './tile-catalog';
import { createWindAngleAnimator } from './wind-angle-animator';
import { createWindSectorTracker, type WindSectorReference } from './wind-sector-tracker';

interface Props {
  label: string;
  reading: TileReading;
  zone: ZoneState;
  depthZone: ZoneState;
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
  depthZone,
  sensorGloss,
  staleAgeText,
  expanded = false,
  actionLabel = 'Expand instrument',
  onOpen,
}: Props = $props();
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
    ? `${label}. Heading ${metricText(rose.heading)}. Apparent wind ${metricText(rose.apparent, true)}. True wind ${metricText(rose.trueWind, true)}. Speed over ground ${metricText(rose.speedOverGround)}. Depth ${metricText(rose.depth)}${depthZone === 'alarm' ? ', alarm' : depthZone === 'warning' ? ', warning' : ''}${reading.state === 'stale' ? '. Wind data stale' : ''}. ${actionLabel}`
    : `${label}, ${sensorGloss}. ${actionLabel}`,
);
let displayedApparentRad = $state<number>();
let displayedTrueRad = $state<number>();
let displayedHeadingRad = $state<number>();
let displayedSectorRad = $state<number>();
const motionOptions = { reducedMotion: prefersReducedMotion };
const apparentAnimator = createWindAngleAnimator(
  (angleRad) => (displayedApparentRad = angleRad),
  motionOptions,
);
const trueAnimator = createWindAngleAnimator(
  (angleRad) => (displayedTrueRad = angleRad),
  motionOptions,
);
const headingAnimator = createWindAngleAnimator(
  (angleRad) => (displayedHeadingRad = angleRad),
  motionOptions,
);
const sectorAnimator = createWindAngleAnimator(
  (angleRad) => (displayedSectorRad = angleRad),
  motionOptions,
);
const apparentDeg = $derived((displayedApparentRad ?? rose?.apparent.angleRad ?? 0) * RAD_TO_DEG);
const trueDeg = $derived((displayedTrueRad ?? rose?.trueWind.angleRad ?? 0) * RAD_TO_DEG);
const headingDeg = $derived((displayedHeadingRad ?? rose?.heading.siValue ?? 0) * RAD_TO_DEG);
const cardRotation = $derived(-headingDeg);
const sectorTracker = createWindSectorTracker();
let filteredSectorAngleRad = $state<number>();
let filteredSectorReference = $state<WindSectorReference>();
const rawSectorReference = $derived.by(() => {
  const trueAngle = rose?.trueWind.angleRad;
  if (trueAngle !== undefined) {
    return {
      angleRad: trueAngle,
      epochMs: rose?.trueWind.angleEpoch,
      reference: 'true' as const,
    };
  }
  const apparentAngle = rose?.apparent.angleRad;
  if (apparentAngle !== undefined) {
    return {
      angleRad: apparentAngle,
      epochMs: rose?.apparent.angleEpoch,
      reference: 'apparent' as const,
    };
  }
  return undefined;
});
$effect(() => {
  const angleRad = rose?.apparent.angleRad;
  if (angleRad === undefined) {
    apparentAnimator.reset();
    return;
  }
  apparentAnimator.push(angleRad, rose?.apparent.angleEpoch ?? Date.now());
});
$effect(() => {
  const angleRad = rose?.trueWind.angleRad;
  if (angleRad === undefined) {
    trueAnimator.reset();
    return;
  }
  trueAnimator.push(angleRad, rose?.trueWind.angleEpoch ?? Date.now());
});
$effect(() => {
  const angleRad = rose?.heading.siValue;
  if (angleRad === undefined) {
    headingAnimator.reset();
    return;
  }
  headingAnimator.push(angleRad, rose?.heading.angleEpoch ?? Date.now());
});
$effect(() => {
  const next = rawSectorReference;
  if (!next) {
    sectorTracker.reset();
    sectorAnimator.reset();
    filteredSectorAngleRad = undefined;
    filteredSectorReference = undefined;
    return;
  }
  filteredSectorAngleRad = sectorTracker.push(
    next.angleRad,
    next.epochMs ?? Date.now(),
    next.reference,
  );
  sectorAnimator.push(filteredSectorAngleRad, next.epochMs ?? Date.now());
  filteredSectorReference = next.reference;
});
onDestroy(() => {
  apparentAnimator.destroy();
  trueAnimator.destroy();
  headingAnimator.destroy();
  sectorAnimator.destroy();
});
const sectorReference = $derived(filteredSectorReference ?? rawSectorReference?.reference);
const sectorRotation = $derived(
  (displayedSectorRad ?? filteredSectorAngleRad ?? rawSectorReference?.angleRad ?? 0) * RAD_TO_DEG,
);
</script>

<button
  type="button"
  class="tile card-frame tile--wide tile--wind-rose"
  class:tile--warning={zone === 'warning'}
  class:tile--alarm={zone === 'alarm'}
  class:tile--stale={reading.state === 'stale'}
  class:tile--empty={reading.state === 'never'}
  class:tile--expanded={expanded}
  aria-label={accessibleLabel}
  onclick={onOpen}
>
  <div class="rose-layout">
    <svg class="rose" viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle class="fixed-dial" cx="500" cy="500" r="444" />
      {#if rawSectorReference}
        <g
          class="wind-sectors"
          data-reference={sectorReference}
          transform="rotate({sectorRotation} 500 500)"
        >
          <path class="port-sector" d="M86 337 A444 444 0 0 1 344 84" />
          <path class="starboard-sector" d="M656 84 A444 444 0 0 1 914 337" />
        </g>
      {/if}

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

      {#if rawSectorReference}
        <g class="wind-sector-lines" transform="rotate({sectorRotation} 500 500)">
          <path class="port-sector-line" d="M186 186 L500 500" />
          <path class="starboard-sector-line" d="M814 186 L500 500" />
        </g>
      {/if}

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
        <rect
          class="counter-box"
          class:counter-box--warning={zone === 'warning'}
          class:counter-box--alarm={zone === 'alarm'}
          x="8"
          y="8"
          width="240"
          height="190"
          rx="22"
        />
        <text class="counter-label" x="128" y="42">AWS</text>
        <text class="counter-value" x="128" y="128">
          {rose?.apparent.value ?? '---'}
        </text>
        <text class="counter-unit counter-unit--inset" x="22" y="186">
          {rose?.apparent.unit ?? ''}
        </text>
        <text class="counter-angle-inline" x="236" y="186">
          <tspan class="counter-angle-prefix">AWA</tspan>
          <tspan>{formatSignedAngleOr(rose?.apparent.angleRad)}</tspan>
        </text>
      </g>
      <g class="wind-counter wind-counter--true">
        <rect
          class="counter-box"
          class:counter-box--warning={zone === 'warning'}
          class:counter-box--alarm={zone === 'alarm'}
          x="752"
          y="8"
          width="240"
          height="190"
          rx="22"
        />
        <text class="counter-label" x="872" y="42">TWS</text>
        <text class="counter-value" x="872" y="128">
          {rose?.trueWind.value ?? '---'}
        </text>
        <text class="counter-unit counter-unit--inset" x="766" y="186">
          {rose?.trueWind.unit ?? ''}
        </text>
        <text class="counter-angle-inline" x="980" y="186">
          <tspan class="counter-angle-prefix">TWA</tspan>
          <tspan>{formatSignedAngleOr(rose?.trueWind.angleRad)}</tspan>
        </text>
      </g>

      <g class="heading-window">
        <rect x="370" y="8" width="260" height="112" rx="25" />
        <text x="500" y="88">{rose?.heading.value ?? '---'}</text>
        {#if rose?.heading.referenceLabel}
          <text class="heading-reference" x="615" y="99">{rose.heading.referenceLabel}</text>
        {/if}
      </g>
    </svg>

    <div class="corner corner--sog">
      <span class="corner-label">SOG</span>
      <span class="num">{rose?.speedOverGround.value ?? '---'}</span>
      <span class="unit">{rose?.speedOverGround.unit ?? ''}</span>
    </div>
    <div
      class="corner corner--depth"
      class:corner--warning={depthZone === 'warning'}
      class:corner--alarm={depthZone === 'alarm'}
    >
      <span class="corner-label">DEPTH</span>
      <span class="num">{rose?.depth.value ?? '---'}</span>
      <span class="unit">{rose?.depth.unit ?? ''}</span>
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
  --wind-dial: color-mix(in srgb, var(--text) 12%, var(--surface-raised));
  grid-column: 1 / -1;
}
:global(:root[data-theme="dusk"]) .tile--wind-rose {
  --wind-port: #d0523e;
  --wind-starboard: #3fae6a;
  --wind-apparent: #ff9100;
  --wind-true: #ffcf4d;
  --wind-pointer-label: #0f1a24;
  --wind-dial: color-mix(in srgb, var(--text) 70%, var(--surface-raised));
}
:global(:root[data-theme="night-red"]) .tile--wind-rose {
  --wind-port: #a23500;
  --wind-starboard: #c05800;
  --wind-apparent: #e04900;
  --wind-true: #ff9f00;
  --wind-pointer-label: #1a0000;
  --wind-dial: color-mix(in srgb, var(--text-muted) 28%, var(--surface-raised));
}
.rose-layout {
  position: relative;
  inline-size: min(100%, 26rem);
  aspect-ratio: 1;
  container-type: inline-size;
}
.tile--expanded .rose-layout {
  inline-size: min(88vmin, 54rem);
}
.rose {
  display: block;
  inline-size: 100%;
  block-size: auto;
}
.fixed-dial,
.port-sector,
.starboard-sector,
.port-sector-line,
.starboard-sector-line,
.dial-tick,
.crosshair,
.boat-outline {
  fill: none;
}
.fixed-dial {
  stroke: var(--wind-dial);
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
.port-sector-line,
.starboard-sector-line {
  stroke-width: 5;
  stroke-linecap: round;
}
.port-sector-line {
  stroke: var(--wind-port);
}
.starboard-sector-line {
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
.counter-box {
  fill: color-mix(in srgb, var(--surface-raised) 82%, transparent);
  stroke: var(--border);
  stroke-width: 3;
}
.counter-box--warning {
  fill: var(--warning-tint);
  stroke: var(--warning);
  stroke-width: 8;
}
.counter-box--alarm {
  fill: var(--alarm-tint);
  stroke: var(--alarm);
  stroke-width: 8;
}
.counter-label {
  fill: var(--text-muted);
  font-size: 35px;
  font-weight: 800;
}
.counter-value {
  fill: var(--text);
  font-size: 88px;
  font-weight: 900;
  letter-spacing: -3px;
}
.counter-unit {
  fill: var(--text-muted);
  font-size: 27px;
  font-weight: 750;
}
.counter-unit--inset {
  text-anchor: start;
}
.counter-angle-inline {
  fill: var(--text);
  font-size: 42px;
  font-weight: 800;
  letter-spacing: -2px;
  text-anchor: end;
}
.counter-angle-prefix {
  fill: var(--text-muted);
  font-size: 27px;
  letter-spacing: 0;
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
  inset-block-end: 0.8%;
  min-inline-size: 24%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1.5cqi 2cqi;
  border: 3px solid var(--border);
  border-radius: 2.2cqi;
  background: color-mix(in srgb, var(--surface-raised) 82%, transparent);
  text-align: center;
}
.corner--sog {
  inset-inline-start: 0.8%;
}
.corner--depth {
  inset-inline-end: 0.8%;
}
.corner .num {
  font-family: var(--font-mono);
  font-size: 8.8cqi;
  font-weight: 900;
  line-height: var(--leading-tight);
}
.corner .unit {
  margin-inline-start: 0;
  color: var(--text-muted);
  font-size: 2.7cqi;
  font-weight: 650;
}
.corner-label {
  color: var(--text-muted);
  font-size: 3.5cqi;
  font-weight: 800;
  line-height: var(--leading-tight);
}
.corner-state {
  color: var(--text-muted);
  font-size: 2.7cqi;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: var(--tracking-caps);
}
.corner--warning {
  border-width: 5px;
  border-color: var(--warning);
  background: var(--warning-tint);
  color: var(--warning);
}
.corner--alarm {
  border-width: 5px;
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
.tile--wind-rose.tile--expanded .corner .num {
  font-size: 8.8cqi;
}
.tile--wind-rose.tile--expanded .corner-label,
.tile--wind-rose.tile--expanded .corner-state,
.tile--wind-rose.tile--expanded .corner .unit {
  font-size: 3.5cqi;
}
</style>
