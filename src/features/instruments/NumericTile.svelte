<script lang="ts">
import type { ZoneState } from '$shared/signalk';
import BatteryBar from './BatteryBar.svelte';
import PerformanceDial from './PerformanceDial.svelte';
import RotNeedle from './RotNeedle.svelte';
import Sparkline from './Sparkline.svelte';
import TileStateBadge from './TileStateBadge.svelte';
import { tileAccessibleLabel } from './tile-accessibility';
import type { TileDef, TileReading } from './tile-catalog';

interface Props {
  label: string;
  reading: TileReading;
  zone: ZoneState;
  sensorGloss: string;
  kind?: string;
  abbr?: string;
  viz?: TileDef['viz'];
  sparkPoints?: number[];
  // The retained stale value's age, shown in place of the secondary line while stale, so the
  // muted numeral carries the fact that makes retention honest.
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
  kind,
  abbr,
  viz,
  sparkPoints,
  staleAgeText,
  expanded = false,
  actionLabel = 'Expand instrument',
  onOpen,
}: Props = $props();

// One expression, so the formatter cannot split the label from its reference parenthetical.
const labelText = $derived(
  `${label}${reading.referenceLabel ? ` (${reading.referenceLabel})` : ''}`,
);
const accessibleLabel = $derived(
  tileAccessibleLabel(labelText, reading, zone, sensorGloss, actionLabel),
);
const valueScale = $derived.by(() => {
  const longestLine = Math.max(...reading.value.split('\n').map((line) => line.trim().length));
  if (longestLine <= 3) return 'short';
  if (longestLine <= 4) return 'medium';
  if (longestLine <= 6) return 'long';
  if (longestLine <= 9) return 'wide';
  return 'extra-wide';
});
</script>

<!-- The tile column, value size, unit, and zone tints come from the global .tile vocabulary in
     styles/instruments.css, shared with WindTile. -->
<button
  type="button"
  class="tile card-frame tile--numeric"
  class:tile--performance={viz === 'performance'}
  class:tile--warning={zone === 'warning'}
  class:tile--alarm={zone === 'alarm'}
  class:tile--stale={reading.state === 'stale'}
  class:tile--empty={reading.state === 'never'}
  class:tile--position={kind === 'position'}
  class:tile--expanded={expanded}
  aria-label={accessibleLabel}
  onclick={onOpen}
>
  <span class="tile-readout">
    {#if reading.state === 'never'}
      <span class="value"><span class="muted-note">{sensorGloss}</span></span>
    {:else}
      <span class="value value--{valueScale}"
        ><span class="num">{reading.value}{viz === 'performance' ? '%' : ''}</span></span
      >
      {#if viz === 'performance'}
        <PerformanceDial ratio={reading.siValue} />
      {:else if viz === 'battery'}
        <BatteryBar fraction={reading.siValue} state={zone} />
      {:else if viz === 'rot'}
        <RotNeedle radPerSec={reading.siValue} />
      {:else if sparkPoints}
        <Sparkline points={sparkPoints} />
      {/if}
    {/if}
  </span>
  <span class="tile-footer">
    {#if reading.state !== 'never'}
      {#if staleAgeText}
        <span class="tile-secondary">{staleAgeText}</span>
      {:else if reading.secondary}
        <span class="tile-secondary">{reading.secondary}</span>
      {/if}
    {/if}
    <!-- The abbreviation leads and carries the loud voice: a mariner scans for SOG or HDG, not for
         the long name, which stays as the quiet gloss beside it. -->
    <span class="caps-label"
      >{#if abbr}
        <span class="abbr">{abbr}</span>
      {/if}
      {labelText}
      {#if reading.unit}
        <span class="title-unit">({reading.unit})</span>
      {/if}</span
    >
    <TileStateBadge state={reading.state} />
  </span>
</button>

<style>
.tile--performance .num {
  font-size: clamp(var(--text-readout-lg), 22cqi, 5rem);
}
</style>
