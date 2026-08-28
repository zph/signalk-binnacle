<script lang="ts">
import type { AisTargets } from '$entities/ais';
import type { CollisionAssessment } from '$entities/collision';
import type { OwnVessel } from '$entities/vessel';
import type { ZoneState } from '$shared/signalk';
import type { Theme } from '$shared/ui';
import AisRadarTile from './AisRadarTile.svelte';
import AttitudeTile from './AttitudeTile.svelte';
import type { AisRadarRangeNm } from './ais-radar-model';
import CompassTile from './CompassTile.svelte';
import HeelTile from './HeelTile.svelte';
import NumericTile from './NumericTile.svelte';
import TideTile from './TideTile.svelte';
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
  aisRadar?: {
    vessel: OwnVessel;
    targets: AisTargets;
    collision: CollisionAssessment;
    rangeNm: AisRadarRangeNm;
    onRangeChange: (rangeNm: AisRadarRangeNm) => void;
    theme: Theme;
    companionBase?: string | null;
    getToken?: () => string | undefined;
  };
  onActivate: () => void;
  onTideSettings?: () => void;
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
  aisRadar,
  onActivate,
  onTideSettings,
}: Props = $props();
const actionLabel = $derived(expanded ? 'Collapse instrument' : 'Expand instrument');
</script>

{#if def.kind === 'ais-radar' && aisRadar}
  <AisRadarTile
    {label}
    {reading}
    vessel={aisRadar.vessel}
    targets={aisRadar.targets}
    collision={aisRadar.collision}
    rangeNm={aisRadar.rangeNm}
    onRangeChange={aisRadar.onRangeChange}
    theme={aisRadar.theme}
    companionBase={aisRadar.companionBase}
    getToken={aisRadar.getToken}
    {expanded}
    {actionLabel}
    onOpen={onActivate}
  />
{:else if def.kind === 'tide'}
  <TideTile
    {label}
    {reading}
    sensorGloss={def.sensorGloss}
    {expanded}
    {actionLabel}
    onOpen={onActivate}
    onSettings={onTideSettings}
  />
{:else if def.kind === 'wind-rose'}
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
