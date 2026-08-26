<script lang="ts">
import { RAD_TO_DEG } from '$shared/lib';
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
const cardDeg = $derived(-((reading.siValue ?? 0) * RAD_TO_DEG));
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
      class="compass"
      viewBox="0 0 120 120"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle class="ring" cx="60" cy="60" r="50" />
      <g class="card" transform="rotate({cardDeg} 60 60)">
        <path
          class="ticks"
          d="M60 10 V19 M110 60 H101 M60 110 V101 M10 60 H19 M95 25 L89 31 M95 95 L89 89 M25 95 L31 89 M25 25 L31 31"
        />
        <text class="north" x="60" y="31">N</text>
        <text x="89" y="64">E</text>
        <text x="60" y="95">S</text>
        <text x="31" y="64">W</text>
      </g>
      <path class="lubber" d="M60 7 L54 19 H66 Z" />
      <circle class="hub" cx="60" cy="60" r="3" />
    </svg>
    <span class="value"><span class="num">{reading.value}</span></span>
    {#if staleAgeText}
      <span class="tile-secondary">{staleAgeText}</span>
    {/if}
  {/if}
  <span class="caps-label"><span class="abbr">HDG</span> {label}</span>
  <TileStateBadge state={reading.state} />
</button>

<style>
.compass {
  inline-size: min(100%, 8rem);
  block-size: 7rem;
}
.tile--expanded .compass {
  inline-size: min(70vmin, 42rem);
  block-size: min(70vmin, 42rem);
}
.ring,
.ticks {
  fill: none;
  stroke: var(--text-muted);
  vector-effect: non-scaling-stroke;
}
.ring {
  stroke-width: 1.5;
}
.ticks {
  stroke-width: 2;
}
.card text {
  fill: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  text-anchor: middle;
}
.card .north {
  fill: var(--accent);
}
.lubber {
  fill: var(--accent);
}
.hub {
  fill: var(--text);
}
.tile--stale .card .north,
.tile--stale .lubber {
  fill: var(--text-muted);
}
</style>
