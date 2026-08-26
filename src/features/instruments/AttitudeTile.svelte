<script lang="ts">
import { clamp, RAD_TO_DEG } from '$shared/lib';
import type { ZoneState } from '$shared/signalk';
import TileStateBadge from './TileStateBadge.svelte';
import { tileAccessibleLabel } from './tile-accessibility';
import type { TileReading } from './tile-catalog';

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
const accessibleLabel = $derived(
  tileAccessibleLabel(label, reading, zone, sensorGloss, actionLabel),
);
const rollDeg = $derived(-clamp((reading.rollRad ?? 0) * RAD_TO_DEG, -60, 60));
const pitchOffset = $derived(clamp((reading.pitchRad ?? 0) * RAD_TO_DEG, -30, 30) * 0.8);
</script>

<button
  type="button"
  class="tile card-frame tile--visual"
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
    <svg
      class="attitude"
      viewBox="0 0 120 100"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <clipPath id="attitude-face"><circle cx="60" cy="49" r="42" /></clipPath>
      </defs>
      <g
        clip-path="url(#attitude-face)"
        transform="rotate({rollDeg} 60 49) translate(0 {pitchOffset})"
      >
        <rect class="above" x="8" y="-15" width="104" height="64" />
        <rect class="below" x="8" y="49" width="104" height="64" />
        <path class="horizon" d="M8 49 H112" />
        <path class="pitch-lines" d="M43 37 H77 M49 25 H71 M43 61 H77 M49 73 H71" />
      </g>
      <circle class="ring" cx="60" cy="49" r="42" />
      <path class="wings" d="M31 49 H51 L60 56 L69 49 H89 M60 56 V64" />
    </svg>
    <span class="attitude-values num"
      >P
      {reading.pitchRad === undefined ? '---' : Math.abs(reading.pitchRad * RAD_TO_DEG).toFixed(1)}°
      · R
      {reading.rollRad === undefined ? '---' : Math.abs(reading.rollRad * RAD_TO_DEG).toFixed(1)}°</span
    >
    {#if staleAgeText}
      <span class="tile-secondary">{staleAgeText}</span>
    {/if}
  {/if}
  <span class="caps-label"><span class="abbr">ATT</span> {label}</span>
  <TileStateBadge state={reading.state} {zone} />
</button>

<style>
.attitude {
  inline-size: min(100%, 8rem);
  block-size: 6rem;
}
.tile--expanded .attitude {
  inline-size: min(70vmin, 42rem);
  block-size: min(58vmin, 35rem);
}
.above {
  fill: var(--accent-tint);
}
.below {
  fill: var(--surface-raised);
}
.horizon,
.pitch-lines,
.ring,
.wings {
  fill: none;
  stroke: var(--text-muted);
  vector-effect: non-scaling-stroke;
}
.horizon {
  stroke: var(--accent);
  stroke-width: 2;
}
.pitch-lines,
.ring {
  stroke-width: 1.5;
}
.wings {
  stroke: var(--text);
  stroke-width: 2.5;
}
.attitude-values {
  font-size: var(--text-sm);
}
.tile--expanded .attitude-values {
  font-size: clamp(var(--text-xl), 4vmin, 2.5rem);
}
.tile--stale .horizon {
  stroke: var(--text-muted);
}
</style>
