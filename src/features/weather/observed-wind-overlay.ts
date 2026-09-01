import type { SymbolLayerSpecification } from 'maplibre-gl';
import { formatSpeedOr, speedUnitLabel, type SpeedUnit } from '$shared/lib';
import {
  type OverlayContext,
  type OverlayModule,
  removeLayersAndSources,
  setLayersVisibility,
  setSourceData,
} from '$shared/map';
import { fetchObservedWindStations, type ObservedWindResponse } from './observed-wind-client';
import { WEATHER_LAYER_IDS } from './fills';

const SOURCE = 'binnacle-observed-wind';
const CLUSTERS = 'binnacle-observed-wind-clusters';
const CLUSTER_COUNT = 'binnacle-observed-wind-cluster-count';
const ARROWS = 'binnacle-observed-wind-arrows';
const SPEED = 'binnacle-observed-wind-speed';
const NAMES = 'binnacle-observed-wind-names';
const STALE_MS = 2 * 60 * 60 * 1000;

export function observedWindAge(observedAt: string, now = Date.now()): 'live' | 'stale' {
  return now - Date.parse(observedAt) > STALE_MS ? 'stale' : 'live';
}

export function createObservedWindOverlay(
  origin: string,
  getToken: () => string | undefined,
  getSpeedUnit: () => SpeedUnit,
): OverlayModule & { sync(ctx: OverlayContext): void } {
  let visible = false;
  let response: ObservedWindResponse | undefined;
  let loading: Promise<void> | undefined;
  let lastUnit: SpeedUnit | undefined;
  const load = () => {
    if (loading) return;
    loading = fetchObservedWindStations(origin, getToken).then((value) => { response = value; }).finally(() => { loading = undefined; });
  };
  const update = (ctx: OverlayContext) => {
    const unit = getSpeedUnit();
    if (!response || unit === lastUnit) return;
    lastUnit = unit;
    setSourceData(ctx.map, SOURCE, {
      type: 'FeatureCollection',
      features: response.stations.map((station) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [station.longitude, station.latitude] },
        properties: {
          ...station,
          source: response?.provider,
          stale: observedWindAge(station.observedAt),
          // Meteorological direction is where wind comes from; symbols point where it goes.
          rotation: (station.directionDeg + 180) % 360,
          speedLabel: `${formatSpeedOr(station.speedMps, unit, 0)} ${speedUnitLabel(unit)}`,
        },
      })),
    });
  };
  return {
    id: WEATHER_LAYER_IDS.observedWind,
    title: 'Observed wind stations',
    description: 'Measured NOAA NDBC wind at buoys and coastal stations.',
    band: 'weather', supportsOpacity: true, defaultVisible: false,
    available: () => response !== undefined,
    unavailableHint: 'Observed stations need the enabled Signal K Observed Wind Stations plugin.',
    layerIds: [CLUSTERS, CLUSTER_COUNT, ARROWS, SPEED, NAMES],
    add(ctx) {
      if (!ctx.map.getSource(SOURCE)) {
        ctx.map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, cluster: true, clusterRadius: 42 });
      }
      const symbol = (id: string, text: unknown, minzoom = 0): SymbolLayerSpecification => ({
        id, type: 'symbol', source: SOURCE, minzoom,
        filter: id === CLUSTERS || id === CLUSTER_COUNT ? ['has', 'point_count'] : ['!', ['has', 'point_count']],
        layout: { 'text-field': text as never, 'text-font': ['Noto Sans Regular'], 'text-size': id === ARROWS ? 22 : 11, 'text-rotate': id === ARROWS ? ['get', 'rotation'] : 0, 'text-offset': id === SPEED ? [0, 1.35] : id === NAMES ? [0, 2.55] : [0, 0], 'text-allow-overlap': id === ARROWS },
        paint: { 'text-color': id === CLUSTERS ? '#16334a' : ['case', ['==', ['get', 'stale'], 'stale'], '#a35b18', '#ffffff'] as never, 'text-halo-color': '#18242c', 'text-halo-width': 1.5 },
      });
      ctx.map.addLayer(symbol(CLUSTERS, '●'), ctx.beforeIdFor('weather'));
      ctx.map.addLayer(symbol(CLUSTER_COUNT, ['get', 'point_count_abbreviated']), ctx.beforeIdFor('weather'));
      ctx.map.addLayer(symbol(ARROWS, '➤'), ctx.beforeIdFor('weather'));
      ctx.map.addLayer(symbol(SPEED, ['get', 'speedLabel']), ctx.beforeIdFor('weather'));
      ctx.map.addLayer(symbol(NAMES, ['get', 'name'], 8), ctx.beforeIdFor('weather'));
      load();
    },
    sync(ctx) { if (visible) { load(); update(ctx); } },
    reset() { lastUnit = undefined; },
    remove(ctx) { removeLayersAndSources(ctx.map, [NAMES, SPEED, ARROWS, CLUSTER_COUNT, CLUSTERS], [SOURCE]); },
    setVisible(ctx, value) { visible = value; setLayersVisibility(ctx.map, [CLUSTERS, CLUSTER_COUNT, ARROWS, SPEED, NAMES], value); if (value) { lastUnit = undefined; load(); this.sync(ctx); } },
    setOpacity(ctx, value) { for (const id of [CLUSTERS, CLUSTER_COUNT, ARROWS, SPEED, NAMES]) if (ctx.map.getLayer(id)) ctx.map.setPaintProperty(id, 'text-opacity', value); },
  };
}
