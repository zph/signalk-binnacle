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
const headingValue = $derived(rose?.heading.value ?? '---');
const headingHasDegree = $derived(headingValue.endsWith('°'));
const headingDigits = $derived(headingHasDegree ? headingValue.slice(0, -1) : headingValue);
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
    <div class="rose-readouts rose-readouts--top" aria-hidden="true">
      <div
        class="rose-readout rose-readout--aws"
        class:rose-readout--warning={zone === 'warning'}
        class:rose-readout--alarm={zone === 'alarm'}
      >
        <span class="readout-title"
          ><span>AWS</span>
          {#if rose?.apparent.unit}
            <span class="readout-unit">({rose.apparent.unit})</span>
          {/if}</span
        >
        <span class="num">{rose?.apparent.value ?? '---'}</span>
      </div>
      <div
        class="rose-readout rose-readout--tws"
        class:rose-readout--warning={zone === 'warning'}
        class:rose-readout--alarm={zone === 'alarm'}
      >
        <span class="readout-title"
          ><span>TWS</span>
          {#if rose?.trueWind.unit}
            <span class="readout-unit">({rose.trueWind.unit})</span>
          {/if}</span
        >
        <span class="num">{rose?.trueWind.value ?? '---'}</span>
      </div>
    </div>

    <div class="rose-face">
      <svg
        class="rose"
        viewBox="0 0 1000 1000"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
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
            <path
              class="apparent-pointer"
              d="M447 67 L500 24 L553 67 L512 294 Q500 326 488 294 Z"
            />
            <text class="pointer-label" x="500" y="113">A</text>
          </g>
        {/if}
        {#if rose?.trueWind.angleRad !== undefined}
          <g class="wind-pointer wind-pointer--true" transform="rotate({trueDeg} 500 500)">
            <path class="true-pointer" d="M462 75 L500 42 L538 75 L508 260 Q500 284 492 260 Z" />
            <text class="pointer-label" x="500" y="113">T</text>
          </g>
        {/if}
      </svg>

      <!-- The degree mark is positioned independently so the middle digit stays on the axis. -->
      <div class="heading-pill" aria-hidden="true">
        <span class="heading-digits">{headingDigits}</span>
        {#if headingHasDegree}
          <span class="heading-degree">°</span>
        {/if}
      </div>
    </div>

    <div class="rose-readouts rose-readouts--bottom" aria-hidden="true">
      <div class="rose-readout rose-readout--sog">
        <span class="readout-title"
          ><span>SOG</span>
          {#if rose?.speedOverGround.unit}
            <span class="readout-unit">({rose.speedOverGround.unit})</span>
          {/if}</span
        >
        <span class="num">{rose?.speedOverGround.value ?? '---'}</span>
      </div>
      <div
        class="rose-readout rose-readout--depth"
        class:rose-readout--warning={depthZone === 'warning'}
        class:rose-readout--alarm={depthZone === 'alarm'}
      >
        <span class="readout-title"
          ><span>DEPTH</span>
          {#if rose?.depth.unit}
            <span class="readout-unit">({rose.depth.unit})</span>
          {/if}</span
        >
        <span class="num">{rose?.depth.value ?? '---'}</span>
      </div>
    </div>
  </div>

  {#if staleAgeText}
    <span class="tile-secondary">{staleAgeText}</span>
  {/if}
  <TileStateBadge state={reading.state} />
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
  position: relative;
  container-type: inline-size;
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
  inline-size: min(100%, 26rem);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: clamp(var(--space-2), 3cqi, var(--space-4));
  container-type: inline-size;
}
.tile--expanded .rose-layout {
  /* Bound the compass by viewport block size while the readouts use the full tile as their
     side-rail positioning context. */
  inline-size: min(82vw, calc(64 * var(--dvh)), 54rem);
}
.rose-face {
  position: relative;
  inline-size: 90%;
  aspect-ratio: 1;
  container-type: inline-size;
  flex: 0 0 auto;
}
.rose {
  display: block;
  inline-size: 100%;
  block-size: 100%;
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
.heading-pill {
  position: absolute;
  inset-block-start: 50%;
  inset-inline-start: 50%;
  inline-size: 34cqi;
  block-size: 18cqi;
  box-sizing: border-box;
  display: grid;
  place-items: center;
  border: 0.3cqi solid color-mix(in srgb, var(--border) 80%, transparent);
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--surface-raised) 58%, transparent);
  box-shadow: 0 0 3cqi color-mix(in srgb, var(--surface-overlay) 68%, transparent);
  -webkit-backdrop-filter: blur(1.5cqi);
  backdrop-filter: blur(1.5cqi);
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.heading-digits,
.heading-degree {
  color: var(--text);
  font-family: var(--font-mono);
}
.heading-digits {
  font-size: 10cqi;
  font-weight: 900;
  line-height: 1;
}
.heading-degree {
  position: absolute;
  inset-block-start: 3cqi;
  inset-inline-start: calc(50% + 9.5cqi);
  font-size: 5cqi;
  font-weight: 800;
  line-height: 1;
}
.tile--stale .apparent-pointer,
.tile--stale .true-pointer {
  fill: var(--text-muted);
}
.tile--stale .heading-digits,
.tile--stale .heading-degree {
  color: var(--text-muted);
}
.rose-readouts {
  position: absolute;
  inset-inline: var(--space-1);
  z-index: var(--z-overlay);
  inline-size: auto;
  display: grid;
  gap: clamp(var(--space-2), 2.5cqi, var(--space-4));
  pointer-events: none;
}
.rose-readouts--top {
  inset-block-start: 25%;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  transform: translateY(-50%);
}
.rose-readouts--bottom {
  inset-block-start: 75%;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  transform: translateY(-50%);
}
.rose-readout {
  min-inline-size: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.4cqi;
  padding: 1.6cqi 2cqi;
  border: 0;
  border-radius: 2.4cqi;
  background: color-mix(in srgb, var(--surface-raised) 58%, transparent);
  text-align: center;
}
.rose-readout .num {
  font-family: var(--font-mono);
  font-size: 8.8cqi;
  font-weight: 900;
  line-height: var(--leading-tight);
}
.readout-title {
  display: inline-flex;
  align-items: baseline;
  justify-content: center;
  gap: 0.4em;
  color: var(--text-muted);
  font-size: 3.5cqi;
  font-weight: 800;
  line-height: var(--leading-tight);
  white-space: nowrap;
}
.readout-unit {
  color: var(--text-muted);
  font-size: 0.78em;
  font-weight: 650;
}
.rose-readout--warning {
  background: var(--warning-tint);
  color: var(--warning);
}
.rose-readout--alarm {
  background: var(--alarm-tint);
  color: var(--alarm);
}
.rose-readout--depth {
  background: transparent;
}
.rose-readout--warning .readout-title,
.rose-readout--warning .readout-unit {
  color: var(--warning);
}
.rose-readout--alarm .readout-title,
.rose-readout--alarm .readout-unit {
  color: var(--alarm);
}
.tile--wind-rose.tile--expanded .rose-readout .num {
  font-size: 8.8cqi;
}
.tile--wind-rose.tile--expanded .readout-title {
  font-size: 3.5cqi;
}

/* A spacious face has enough inline room to keep the readouts outside the compass. Query the tile
   itself so this works in both a wide dock and the full-screen face without observing layout in
   JavaScript. */
@container (min-width: 40rem) {
  .rose-layout {
    flex: 1;
    align-self: stretch;
    inline-size: 100%;
    block-size: 100%;
    min-block-size: 0;
    /* The corner readouts scale from this face in both axes. A half-width or short dock can then
       contract its numerals without using the full browser viewport as a false size signal. */
    container-type: size;
  }
  .tile--expanded .rose-layout {
    inline-size: 100%;
  }
  .rose-face {
    position: absolute;
    inset-block-start: 50%;
    inset-inline-start: 50%;
    inline-size: auto;
    block-size: min(100%, 100vi);
    max-inline-size: 100%;
    transform: translate(-50%, -50%);
  }
  .rose-readouts {
    inset-inline: var(--space-1);
  }
  .rose-readouts--top {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .rose-readouts--bottom {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .rose-readout {
    inline-size: fit-content;
    min-inline-size: min(18cqi, 15rem);
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-lg);
  }
  .rose-readout:not(.rose-readout--warning):not(.rose-readout--alarm) {
    background: transparent;
  }
  .rose-readout--aws,
  .rose-readout--sog {
    align-items: flex-start;
    justify-self: start;
    padding-inline-start: 0;
    text-align: start;
  }
  .rose-readout--tws,
  .rose-readout--depth {
    align-items: flex-end;
    justify-self: end;
    padding-inline-end: 0;
    text-align: end;
  }
  .rose-readout .num {
    font-size: clamp(var(--text-readout-lg), min(7cqi, 16cqb), 9rem);
  }
  .readout-title {
    font-size: clamp(var(--text-sm), min(1.8cqi, 5cqb), var(--text-readout-lg));
  }
}

/* On compact and medium faces, the values belong to the instrument edges, not the center of each
   grid column. The small row inset keeps the digits from feeling cramped against the tile edge. */
@container (max-width: 64rem) {
  .rose-readout {
    inline-size: fit-content;
  }
  .rose-readout--aws,
  .rose-readout--sog {
    align-items: flex-start;
    justify-self: start;
    padding-inline-start: 0;
    text-align: start;
  }
  .rose-readout--tws,
  .rose-readout--depth {
    align-items: flex-end;
    justify-self: end;
    padding-inline-end: 0;
    text-align: end;
  }
}
</style>
