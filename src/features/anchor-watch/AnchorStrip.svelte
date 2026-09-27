<script lang="ts">
import { onDestroy } from 'svelte';
import type { AnchorWatch } from '$entities/anchor';
import type { UnitsStore } from '$entities/units';
import { formatLengthOr, lengthUnit } from '$shared/lib';
import { ConfirmArm } from '$shared/ui';

interface Props {
  anchor: AnchorWatch;
  units: UnitsStore;
  onRaise: () => void;
  onAcknowledge: () => void;
}

const { anchor, units, onRaise, onAcknowledge }: Props = $props();

// Raise ends the watch and silences the alarm in one motion, so it arms a confirm step instead
// of firing on a single tap; the arm times out back to plain Raise on its own.
const raiseArm = new ConfirmArm();
onDestroy(() => raiseArm.disarm());

function tapRaise(): void {
  if (raiseArm.tap()) onRaise();
}

const acked = $derived(anchor.acknowledged);
</script>

{#if anchor.dragging}
  <!-- No aria-live here: App owns the assertive anchor channel (a concise spoken summary in a
       persistent role=alert region), mirroring the collision strip's split. -->
  <aside class="bottom-strip bottom-strip--alarm" class:is-ack={acked} aria-label="Anchor alarm">
    <div class="head">
      <span class="title">Anchor dragging</span>
      {#if acked}
        <span class="note ack-tag">Acknowledged</span>
      {:else}
        <div class="actions actions--safety">
          <button type="button" class="ack" onclick={onAcknowledge}>Acknowledge</button>
          <button type="button" class="ack ack--warning" onclick={tapRaise}>
            {raiseArm.armed ? 'Confirm raise?' : 'Raise anchor'}
          </button>
        </div>
      {/if}
    </div>
    <div class="row">
      <span class="metric">
        Off anchor <b>{formatLengthOr(anchor.distanceMeters, units.mode, 0)}</b>
        {lengthUnit(units.mode)}
      </span>
      {#if anchor.zone?.type === 'polygon'}
        <span class="metric">Boundary <b>Polygon</b></span>
      {:else}
        <span class="metric">
          {anchor.zone?.type === 'sector' ? 'Sector' : 'Radius'}
          <b>{formatLengthOr(anchor.zone?.radius ?? anchor.radiusMeters, units.mode, 0)}</b>
          {lengthUnit(units.mode)}
        </span>
      {/if}
    </div>
  </aside>
{/if}
