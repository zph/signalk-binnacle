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
  attitudeZones?: { pitch: ZoneState; roll: ZoneState };
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
  attitudeZones = { pitch: 'normal', roll: 'normal' },
  sensorGloss,
  staleAgeText,
  expanded = false,
  actionLabel = 'Expand instrument',
  onOpen,
}: Props = $props();
const accessibleLabel = $derived(
  tileAccessibleLabel(label, reading, zone, sensorGloss, actionLabel),
);
const pitchReadout = $derived(
  reading.pitchRad === undefined
    ? '---'
    : String(Math.round(Math.abs(reading.pitchRad * RAD_TO_DEG))),
);
const rollReadout = $derived(
  reading.rollRad === undefined
    ? '---'
    : String(Math.round(Math.abs(reading.rollRad * RAD_TO_DEG))),
);
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
    <span class="attitude-readout">
      <span class="attitude-values num">
        <span
          class="attitude-reading"
          class:attitude-reading--normal={attitudeZones.pitch === 'normal'}
          class:attitude-reading--warning={attitudeZones.pitch === 'warning'}
          class:attitude-reading--alarm={attitudeZones.pitch === 'alarm'}
          ><span class="attitude-axis">P:</span
          ><span class="attitude-number">{pitchReadout}°</span></span
        >
        <span
          class="attitude-reading"
          class:attitude-reading--normal={attitudeZones.roll === 'normal'}
          class:attitude-reading--warning={attitudeZones.roll === 'warning'}
          class:attitude-reading--alarm={attitudeZones.roll === 'alarm'}
          ><span class="attitude-axis">R:</span
          ><span class="attitude-number">{rollReadout}°</span></span
        >
      </span>
      {#if staleAgeText}
        <span class="tile-secondary">{staleAgeText}</span>
      {/if}
    </span>
  {/if}
  <span class="caps-label"><span class="abbr">ATT</span> {label}</span>
  <TileStateBadge state={reading.state} />
</button>

<style>
.attitude-readout {
  container-type: size;
  display: grid;
  flex: 1 1 auto;
  min-block-size: 0;
  min-inline-size: 0;
  overflow: hidden;
  place-content: center;
}
.attitude-values {
  display: grid;
  gap: var(--space-1);
  justify-items: center;
}
.attitude-reading {
  align-items: baseline;
  column-gap: var(--space-1);
  display: flex;
  justify-content: center;
  line-height: 0.9;
}
.attitude-axis {
  font-size: clamp(var(--text-sm), min(8cqi, 9cqb), var(--text-readout-lg));
  font-weight: 700;
}
.attitude-number {
  font-size: clamp(var(--text-readout-lg), min(33cqi, 38cqb), 18rem);
  font-weight: 800;
  letter-spacing: -0.035em;
  text-align: end;
}
.attitude-reading--normal {
  color: var(--ok);
}
.attitude-reading--warning {
  color: var(--warning);
}
.attitude-reading--alarm {
  color: var(--alarm);
}
.tile--expanded .attitude-values {
  gap: clamp(var(--space-2), 1.5cqb, var(--space-5));
}
.tile--stale .attitude-reading {
  color: var(--text-muted);
}
</style>
