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
const BARB_SOURCE = 'binnacle-observed-wind-barbs';
const CLUSTERS = 'binnacle-observed-wind-clusters';
const CLUSTER_COUNT = 'binnacle-observed-wind-cluster-count';
const BARB_CASING = 'binnacle-observed-wind-barb-casing';
const BARBS = 'binnacle-observed-wind-barbs';
const SPEED = 'binnacle-observed-wind-speed';
const NAMES = 'binnacle-observed-wind-names';
const STALE_MS = 2 * 60 * 60 * 1000;

export function observedWindAge(observedAt: string, now = Date.now()): 'live' | 'stale' {
  return now - Date.parse(observedAt) > STALE_MS ? 'stale' : 'live';
}

function barbCoordinates(station: ObservedWindResponse['stations'][number]): GeoJSON.Position[][] {
  const length = 0.004;
  const radians = (station.directionDeg * Math.PI) / 180;
  const east = Math.sin(radians);
  const north = Math.cos(radians);
  const start: GeoJSON.Position = [
    station.longitude - east * length * 0.5,
    station.latitude - north * length * 0.5,
  ];
  const end: GeoJSON.Position = [
    station.longitude + east * length * 0.5,
    station.latitude + north * length * 0.5,
  ];
  const feathers = Math.max(0, Math.min(6, Math.round((station.speedMps * 1.94384) / 5)));
  const lines: GeoJSON.Position[][] = [[start, end]];
  for (let feather = 0; feather < feathers; feather += 1) {
    const along = Math.min(0.88, 0.2 + feather * 0.13);
    const shaft: GeoJSON.Position = [
      end[0] - east * length * along,
      end[1] - north * length * along,
    ];
    lines.push([shaft, [shaft[0] - north * length * 0.3, shaft[1] + east * length * 0.3]]);
  }
  return lines;
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
    loading = fetchObservedWindStations(origin, getToken)
      .then((value) => {
        response = value;
      })
      .finally(() => {
        loading = undefined;
      });
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
          stale: observedWindAge(station.observedAt),
          // Meteorological direction is where wind comes from; symbols point where it goes.
          rotation: (station.directionDeg + 180) % 360,
          speedLabel: `${formatSpeedOr(station.speedMps, unit, 0)} ${speedUnitLabel(unit)}`,
        },
      })),
    });
    setSourceData(ctx.map, BARB_SOURCE, {
      type: 'FeatureCollection',
      features: response.stations.map((station) => ({
        type: 'Feature' as const,
        geometry: { type: 'MultiLineString' as const, coordinates: barbCoordinates(station) },
        properties: { stale: observedWindAge(station.observedAt) },
      })),
    });
  };
  return {
    id: WEATHER_LAYER_IDS.observedWind,
    title: 'Observed wind stations',
    description: 'Measured NOAA buoy, coastal, and METAR-station wind.',
    band: 'weather',
    supportsOpacity: true,
    defaultVisible: false,
    layerIds: [CLUSTERS, CLUSTER_COUNT, BARB_CASING, BARBS, SPEED, NAMES],
    add(ctx) {
      if (!ctx.map.getSource(SOURCE)) {
        ctx.map.addSource(SOURCE, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
          cluster: true,
          clusterRadius: 42,
        });
      }
      if (!ctx.map.getSource(BARB_SOURCE)) {
        ctx.map.addSource(BARB_SOURCE, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
      }
      const symbol = (id: string, text: unknown, minzoom = 0): SymbolLayerSpecification => ({
        id,
        type: 'symbol',
        source: SOURCE,
        minzoom,
        filter:
          id === CLUSTERS || id === CLUSTER_COUNT
            ? ['has', 'point_count']
            : ['!', ['has', 'point_count']],
        layout: {
          'text-field': text as never,
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-rotate': 0,
          'text-offset': id === SPEED ? [0, 1.35] : id === NAMES ? [0, 2.55] : [0, 0],
          'text-allow-overlap': false,
        },
        paint: {
          'text-color':
            id === CLUSTERS
              ? '#16334a'
              : (['case', ['==', ['get', 'stale'], 'stale'], '#a35b18', '#ffffff'] as never),
          'text-halo-color': '#18242c',
          'text-halo-width': 1.5,
        },
      });
      ctx.map.addLayer(symbol(CLUSTERS, '●'), ctx.beforeIdFor('weather'));
      ctx.map.addLayer(
        symbol(CLUSTER_COUNT, ['get', 'point_count_abbreviated']),
        ctx.beforeIdFor('weather'),
      );
      ctx.map.addLayer(
        {
          id: BARB_CASING,
          type: 'line',
          source: BARB_SOURCE,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#18242c', 'line-width': 3.5 },
        },
        ctx.beforeIdFor('weather'),
      );
      ctx.map.addLayer(
        {
          id: BARBS,
          type: 'line',
          source: BARB_SOURCE,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': ['case', ['==', ['get', 'stale'], 'stale'], '#a35b18', '#ffffff'],
            'line-width': 1.5,
          },
        },
        ctx.beforeIdFor('weather'),
      );
      ctx.map.addLayer(symbol(SPEED, ['get', 'speedLabel']), ctx.beforeIdFor('weather'));
      ctx.map.addLayer(symbol(NAMES, ['get', 'name'], 8), ctx.beforeIdFor('weather'));
      load();
    },
    sync(ctx) {
      if (visible) {
        load();
        update(ctx);
      }
    },
    reset() {
      lastUnit = undefined;
    },
    remove(ctx) {
      removeLayersAndSources(
        ctx.map,
        [NAMES, SPEED, BARBS, BARB_CASING, CLUSTER_COUNT, CLUSTERS],
        [BARB_SOURCE, SOURCE],
      );
    },
    setVisible(ctx, value) {
      visible = value;
      setLayersVisibility(
        ctx.map,
        [CLUSTERS, CLUSTER_COUNT, BARB_CASING, BARBS, SPEED, NAMES],
        value,
      );
      if (value) {
        lastUnit = undefined;
        load();
        this.sync(ctx);
      }
    },
    setOpacity(ctx, value) {
      for (const id of [CLUSTERS, CLUSTER_COUNT, SPEED, NAMES])
        if (ctx.map.getLayer(id)) ctx.map.setPaintProperty(id, 'text-opacity', value);
      for (const id of [BARB_CASING, BARBS])
        if (ctx.map.getLayer(id)) ctx.map.setPaintProperty(id, 'line-opacity', value);
    },
  };
}
