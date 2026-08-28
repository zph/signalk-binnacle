<script lang="ts">
import { onMount } from 'svelte';
import type { LatLon } from '$shared/geo';
import { createThemedMap, type ThemedMapHandle } from '$shared/map';
import type { Theme } from '$shared/ui';
import type { AisRadarRangeNm } from './ais-radar-model';
import {
  aisRadarSeascapeStyle,
  applyAisRadarSeascape,
  fitAisRadarSeascape,
} from './ais-radar-seascape';

interface Props {
  position: LatLon;
  rangeNm: AisRadarRangeNm;
  theme: Theme;
  companionBase?: string | null;
  getToken?: () => string | undefined;
}

const { position, rangeNm, theme, companionBase, getToken }: Props = $props();

let container = $state<HTMLElement>();
let mapHandle: ThemedMapHandle | undefined;
let map = $state<NonNullable<ThemedMapHandle['map']>>();
let ready = $state(false);

onMount(() => {
  if (!container) return;
  mapHandle = createThemedMap({
    container,
    style: aisRadarSeascapeStyle(companionBase, theme),
    companionBase,
    getToken,
    defaultCenter: [position.longitude, position.latitude],
    defaultZoom: 10,
    interactive: false,
    showMapControls: false,
    attributionControl: false,
    pixelRatio: 1,
    cannotStartNotice: '',
    onLoad: (api) => {
      map = api.map;
      applyAisRadarSeascape(api.map, theme);
      fitAisRadarSeascape(api.map, position, rangeNm);
      ready = true;
    },
  });
  return () => mapHandle?.destroy();
});

$effect(() => {
  if (!map) return;
  applyAisRadarSeascape(map, theme);
});

$effect(() => {
  if (!map) return;
  fitAisRadarSeascape(map, position, rangeNm);
});
</script>

<div class="seascape" class:ready bind:this={container} aria-hidden="true"></div>

<style>
.seascape {
  position: absolute;
  /* Match the 198/400 outer plot radius while keeping its stroke inside the square viewBox. */
  inset: 0.5%;
  overflow: hidden;
  border-radius: 50%;
  background: var(--surface);
  opacity: 0;
  pointer-events: none;
}
.seascape.ready {
  opacity: 1;
}
.seascape :global(.maplibregl-ctrl-attrib) {
  opacity: 0.55;
  transform: scale(0.72);
  transform-origin: bottom right;
}
.seascape :global(.chart-start-error) {
  display: none;
}
</style>
