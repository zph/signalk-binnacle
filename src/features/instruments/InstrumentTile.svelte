<script lang="ts">
import type { ZoneState } from '$shared/signalk';
import AttitudeTile from './AttitudeTile.svelte';
import CompassTile from './CompassTile.svelte';
import HeelTile from './HeelTile.svelte';
import NumericTile from './NumericTile.svelte';
import type { TileDef, TileReading } from './tile-catalog';
import WindRoseTile from './WindRoseTile.svelte';
import WindTile from './WindTile.svelte';

interface Props {
  def: TileDef;
  label: string;
  reading: TileReading;
  zone: ZoneState;
  depthZone?: ZoneState;
  staleAgeText?: string;
  sparkPoints?: number[];
  expanded?: boolean;
  onActivate: () => void;
}

const {
  def,
  label,
  reading,
  zone,
  depthZone = 'normal',
  staleAgeText,
  sparkPoints,
  expanded = false,
  onActivate,
}: Props = $props();
const actionLabel = $derived(expanded ? 'Collapse instrument' : 'Expand instrument');
</script>

{#if def.kind === 'wind-rose'}
  <WindRoseTile
    {label}
    {reading}
    {zone}
    {depthZone}
    sensorGloss={def.sensorGloss}
    {staleAgeText}
    {expanded}
    {actionLabel}
    onOpen={onActivate}
  />
{:else if def.kind === 'wind'}
  <WindTile
    {label}
    {reading}
    {zone}
    sensorGloss={def.sensorGloss}
    kind={def.kind}
    abbr={def.abbr}
    {staleAgeText}
    {expanded}
    {actionLabel}
    onOpen={onActivate}
  />
{:else if def.kind === 'compass'}
  <CompassTile
    {label}
    {reading}
    {zone}
    sensorGloss={def.sensorGloss}
    {staleAgeText}
    {expanded}
    {actionLabel}
    onOpen={onActivate}
  />
{:else if def.kind === 'heel'}
  <HeelTile
    {label}
    {reading}
    {zone}
    sensorGloss={def.sensorGloss}
    {staleAgeText}
    {expanded}
    {actionLabel}
    onOpen={onActivate}
  />
{:else if def.kind === 'attitude'}
  <AttitudeTile
    {label}
    {reading}
    {zone}
    sensorGloss={def.sensorGloss}
    {staleAgeText}
    {expanded}
    {actionLabel}
    onOpen={onActivate}
  />
{:else}
  <NumericTile
    {label}
    {reading}
    {zone}
    sensorGloss={def.sensorGloss}
    kind={def.kind}
    abbr={def.abbr}
    viz={def.viz}
    {sparkPoints}
    {staleAgeText}
    {expanded}
    {actionLabel}
    onOpen={onActivate}
  />
{/if}
