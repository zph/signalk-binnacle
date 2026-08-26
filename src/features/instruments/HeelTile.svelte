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
const needleDeg = $derived(clamp((reading.rollRad ?? 0) * RAD_TO_DEG, -40, 40));
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
    <svg class="heel" viewBox="0 0 120 90" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path class="coarse" d="M21 67 A44 44 0 0 1 99 67" />
      <path class="fine" d="M49 32 A30 30 0 0 1 71 32" />
      <path
        class="ticks"
        d="M21 67 L29 64 M31 45 L38 49 M47 30 L50 39 M60 24 V36 M73 30 L70 39 M89 45 L82 49 M99 67 L91 64"
      />
      <g transform="rotate({needleDeg} 60 73)">
        <path class="needle" d="M60 73 L56 38 H64 Z" />
      </g>
      <path class="boat" d="M39 72 H81 M49 72 L54 66 H66 L71 72" />
      <text x="17" y="79">P</text>
      <text x="103" y="79">S</text>
    </svg>
    <span class="value"
      ><span class="num">{reading.value}</span><span class="unit">{reading.unit}</span></span
    >
    {#if staleAgeText}
      <span class="tile-secondary">{staleAgeText}</span>
    {:else if reading.secondary}
      <span class="tile-secondary">{reading.secondary}</span>
    {/if}
  {/if}
  <span class="caps-label">{label}</span>
  <TileStateBadge state={reading.state} {zone} />
</button>

<style>
.heel {
  inline-size: min(100%, 8rem);
  block-size: 5.5rem;
}
.tile--expanded .heel {
  inline-size: min(72vmin, 44rem);
  block-size: min(54vmin, 33rem);
}
.coarse,
.fine,
.ticks,
.boat {
  fill: none;
  stroke: var(--text-muted);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}
.fine {
  stroke: var(--accent);
  stroke-width: 2.5;
}
.needle {
  fill: var(--accent);
}
.heel text {
  fill: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  text-anchor: middle;
}
.tile--stale .fine {
  stroke: var(--text-muted);
}
.tile--stale .needle {
  fill: var(--text-muted);
}
</style>
