<script lang="ts">
import Maximize2 from '@lucide/svelte/icons/maximize-2';
import Minimize2 from '@lucide/svelte/icons/minimize-2';
import Minus from '@lucide/svelte/icons/minus';
import Navigation from '@lucide/svelte/icons/navigation';
import Plus from '@lucide/svelte/icons/plus';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { onMount } from 'svelte';
import type { UnitsStore } from '$entities/units';
import { type UserCharts, userChartToSignalK } from '$entities/user-charts';
import type { OwnVessel } from '$entities/vessel';
import { fetchCharts } from '$features/charts';
import { createVesselOverlay, OWN_VESSEL_OVERLAY_ID } from '$features/vessel-layer';
import {
  createChartOverlay,
  createThemedMap,
  type LayerSettings,
  type ThemedMapHandle,
} from '$shared/map';
import {
  DEFAULT_THRESHOLDS,
  type MapRenderingQuality,
  type MapView,
  mapRenderingPixelRatio,
  type PersistedValue,
  type Thresholds,
} from '$shared/settings';
import type { Theme } from '$shared/ui';
import { buildReferenceOverlays } from './build-reference-overlays';

interface Props {
  origin: string;
  vessel: OwnVessel;
  units: UnitsStore;
  thresholds: PersistedValue<Thresholds>;
  userCharts: UserCharts;
  theme: Theme;
  companionBase: string | null;
  companionTiles: () => string | null;
  chartsToken?: string;
  initialView?: MapView;
  savedLayers: LayerSettings;
  savedOrder: string[];
  mapRenderingQuality: MapRenderingQuality;
  following: boolean;
  onFollowingChange: (following: boolean) => void;
  onViewChange: (view: MapView) => void;
  expanded?: boolean;
  actionLabel: string;
  onOpen: () => void;
}

const {
  origin,
  vessel,
  units,
  thresholds,
  userCharts,
  theme,
  companionBase,
  companionTiles,
  chartsToken,
  initialView,
  savedLayers,
  savedOrder,
  mapRenderingQuality,
  following,
  onFollowingChange,
  onViewChange,
  expanded = false,
  actionLabel,
  onOpen,
}: Props = $props();

let container = $state<HTMLDivElement>();
let mapHandle: ThemedMapHandle | undefined;
let map = $state<MapLibreMap>();
let recolor = $state<((theme: Theme) => void) | undefined>();
let ready = $state(false);
let chartWarning = $state(false);

const canStartFollowing = $derived(
  following || (vessel.position !== undefined && !vessel.positionStale),
);
const statusText = $derived(
  vessel.position
    ? vessel.positionStale
      ? 'GPS position is stale'
      : following
        ? 'Following boat'
        : 'Independent view'
    : 'Waiting for GPS position',
);

function changeZoom(delta: number): void {
  if (!map) return;
  map.easeTo({ zoom: map.getZoom() + delta, duration: 180 });
}

function toggleFollow(): void {
  if (!canStartFollowing) return;
  onFollowingChange(!following);
}

function reportView(): void {
  if (!map) return;
  const center = map.getCenter();
  onViewChange({ lat: center.lat, lon: center.lng, zoom: map.getZoom() });
}

onMount(() => {
  if (!container) return;
  let destroyed = false;
  const position = vessel.position;
  mapHandle = createThemedMap({
    container,
    companionBase,
    getToken: () => chartsToken,
    transparentBaseWater: true,
    view: initialView,
    defaultCenter: position ? [position.longitude, position.latitude] : undefined,
    defaultZoom: 12,
    showMapControls: false,
    pixelRatio: expanded ? mapRenderingPixelRatio(mapRenderingQuality, window.devicePixelRatio) : 1,
    managerOptions: {
      saved: savedLayers,
      savedOrder,
      pinned: [OWN_VESSEL_OVERLAY_ID],
    },
    onUserPan: () => onFollowingChange(false),
    cannotStartNotice: 'This map needs WebGL2 support.',
    onLoad: async (api) => {
      map = api.map;
      recolor = api.recolor;
      api.map.setGlobalStateProperty('unit', units.depthUnit);
      api.map.on('moveend', reportView);

      const vesselOverlay = createVesselOverlay(vessel);
      const [vesselResult] = await api.manager.registerBatch([vesselOverlay]);
      if (destroyed || api.isDestroyed()) return;
      if (vesselResult?.status === 'registered') api.runTick([vesselOverlay]);
      else if (vesselResult?.status === 'failed') {
        console.warn('Could not register the instrument map vessel overlay.', vesselResult.error);
      }

      const tileBase = companionTiles() ?? companionBase;
      const referenceResults = await api.manager.registerBatch(
        buildReferenceOverlays(api.map, tileBase),
      );
      if (destroyed || api.isDestroyed()) return;
      for (const result of referenceResults) {
        if (result.status === 'failed') {
          console.warn(`Could not register instrument map overlay "${result.id}".`, result.error);
        }
      }

      const localIds = new Set(userCharts.sources.map((source) => source.id));
      const serverCharts = await fetchCharts(origin, chartsToken);
      if (destroyed || api.isDestroyed()) return;
      if (serverCharts === undefined) chartWarning = true;
      const chartOverlays = [
        ...(serverCharts ?? [])
          .filter((chart) => !localIds.has(chart.identifier))
          .map((chart) =>
            createChartOverlay(chart, origin, 'basemap', () => chartsToken, {
              s57Style: {
                safetyDepth:
                  thresholds.value.shallowDepthMeters ?? DEFAULT_THRESHOLDS.shallowDepthMeters,
                depthUnit: units.depthUnit,
              },
            }),
          ),
        ...userCharts.sources.map((source) =>
          createChartOverlay(
            userChartToSignalK(source, source.origin.url),
            origin,
            'bathymetry',
            () => chartsToken,
            {
              source: 'user',
              s57Style: {
                safetyDepth:
                  thresholds.value.shallowDepthMeters ?? DEFAULT_THRESHOLDS.shallowDepthMeters,
                depthUnit: units.depthUnit,
              },
            },
          ),
        ),
      ];
      const chartResults = await api.manager.registerBatch(chartOverlays);
      if (destroyed || api.isDestroyed()) return;
      for (const result of chartResults) {
        if (result.status === 'failed') {
          chartWarning = true;
          console.warn(`Could not register instrument map chart "${result.id}".`, result.error);
        }
      }
      api.recolor(theme);
      ready = true;
    },
  });
  return () => {
    destroyed = true;
    mapHandle?.destroy();
  };
});

$effect(() => {
  recolor?.(theme);
});

$effect(() => {
  if (!map) return;
  map.setGlobalStateProperty('unit', units.depthUnit);
});

// Follow only changes the center. The independent zoom survives every GPS fix, which is what lets
// this viewport stay close-in while the primary chart remains an overview, or vice versa.
$effect(() => {
  if (!following || !map) return;
  const position = vessel.position;
  if (!position || vessel.positionStale) return;
  map.setCenter([position.longitude, position.latitude]);
});
</script>

<section class="tile instrument-map" class:expanded aria-label={`Map instrument, ${statusText}`}>
  <div class="map-surface" class:ready bind:this={container}></div>
  <div class="map-controls" role="group" aria-label="Map controls">
    <button
      type="button"
      class="icon-btn"
      aria-label="Zoom in"
      title="Zoom in"
      onclick={() => changeZoom(1)}
    >
      <Plus size={18} aria-hidden="true" />
    </button>
    <button
      type="button"
      class="icon-btn"
      aria-label="Zoom out"
      title="Zoom out"
      onclick={() => changeZoom(-1)}
    >
      <Minus size={18} aria-hidden="true" />
    </button>
    <button
      type="button"
      class="icon-btn"
      class:is-on={following}
      aria-label="Follow boat"
      aria-pressed={following}
      title={canStartFollowing ? 'Follow boat' : 'Follow needs a fresh GPS position'}
      disabled={!canStartFollowing}
      onclick={toggleFollow}
    >
      <Navigation size={18} aria-hidden="true" />
    </button>
    <button
      type="button"
      class="icon-btn"
      aria-label={actionLabel}
      title={actionLabel}
      onclick={onOpen}
    >
      {#if expanded}
        <Minimize2 size={18} aria-hidden="true" />
      {:else}
        <Maximize2 size={18} aria-hidden="true" />
      {/if}
    </button>
  </div>
  <div class="map-status" role="status">
    <span>{statusText}</span>
    {#if chartWarning}
      <span>Some charts unavailable</span>
    {/if}
  </div>
  {#if !ready}
    <div class="loading-note">Loading map…</div>
  {/if}
</section>

<style>
.instrument-map {
  position: relative;
  min-block-size: 12rem;
  overflow: hidden;
  padding: 0;
  background: var(--surface);
  color: var(--text);
}
.map-surface {
  position: absolute;
  inset: 0;
  opacity: 0;
  transition: opacity 120ms ease;
}
.map-surface.ready {
  opacity: 1;
}
.map-controls {
  position: absolute;
  inset-block-start: var(--space-2);
  inset-inline-end: var(--space-2);
  z-index: 2;
  display: flex;
  gap: var(--space-1);
}
.map-controls .icon-btn {
  min-inline-size: 2.75rem;
  min-block-size: 2.75rem;
  border: 1px solid color-mix(in srgb, var(--line) 78%, transparent);
  background: color-mix(in srgb, var(--surface-raised) 90%, transparent);
  box-shadow: var(--shadow-overlay);
  backdrop-filter: blur(6px);
}
.map-controls .icon-btn.is-on {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--surface);
}
.map-status {
  position: absolute;
  inset-inline-start: var(--space-2);
  inset-block-end: var(--space-2);
  z-index: 2;
  display: flex;
  gap: var(--space-2);
  max-inline-size: calc(100% - var(--space-4));
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--surface-raised) 88%, transparent);
  color: var(--text-muted);
  font: var(--font-label);
  box-shadow: var(--shadow-overlay);
  backdrop-filter: blur(6px);
}
.loading-note {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--text-muted);
}
.instrument-map :global(.maplibregl-ctrl-attrib) {
  opacity: 0.7;
  transform: scale(0.8);
  transform-origin: bottom right;
}
.instrument-map :global(.chart-start-error) {
  margin: var(--space-4);
}
.instrument-map.expanded {
  min-block-size: 100%;
}
@media (max-width: 600px) {
  .map-controls {
    flex-direction: column;
  }
}
</style>
