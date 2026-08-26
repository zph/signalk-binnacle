<script lang="ts">
import type { TileValueState } from './tile-catalog';

interface Props {
  state: TileValueState;
  // The wind tile's separate angle freshness, folded into this one badge line so a tile never
  // stacks two whispered state fragments.
  angleState?: 'stale' | 'unavailable';
}

const { state, angleState }: Props = $props();

// Warning and alarm states are already carried by the face color and accessible name. Only data
// quality needs a visible word, since a stale or absent angle cannot be conveyed by color alone.
const label = $derived(
  state === 'stale'
    ? 'Stale'
    : angleState === 'stale'
      ? 'Angle stale'
      : angleState === 'unavailable'
        ? 'Angle unavailable'
        : '',
);
const caution = $derived(label !== 'Angle unavailable');
</script>

{#if label}
  <span class="tile-state caps-label" class:tile-state--caution={caution}>{label}</span>
{/if}
