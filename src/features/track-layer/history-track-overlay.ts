import type {
  CircleLayerSpecification,
  LineLayerSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import { type LatLon, latLonToLonLat } from '$shared/geo';
import { formatDuration } from '$shared/lib';
import {
  antimeridianLineGeometry,
  ensureGeoJsonSource,
  featureCollection,
  mapThemePaint,
  type OverlayContext,
  type OverlayModule,
  removeLayersAndSources,
  setLayersVisibility,
  setSourceData,
} from '$shared/map';
import { type PersistedValue, type TrackSettings, tripLogEnabled } from '$shared/settings';

const SOURCE_ID = 'binnacle-track-history';
const LAYER_ID = 'binnacle-track-history-line';
const DIRECTION_LAYER_ID = 'binnacle-track-history-direction';
const DURATION_LAYER_ID = 'binnacle-track-history-duration';
const STOP_LAYER_ID = 'binnacle-track-history-stops';
const STOP_LABEL_LAYER_ID = 'binnacle-track-history-stop-labels';
const LAYER_IDS = [
  LAYER_ID,
  DIRECTION_LAYER_ID,
  DURATION_LAYER_ID,
  STOP_LAYER_ID,
  STOP_LABEL_LAYER_ID,
];
const BAND = 'track';
const LINE_OPACITY = 0.72;

export interface HistoryTrackOverlay extends OverlayModule {
  sync(ctx: OverlayContext): void;
}

export interface TripLogView {
  readonly day:
    | {
        portions: readonly {
          points: readonly { position: LatLon }[];
          labelPosition: LatLon;
          durationSeconds: number;
        }[];
        stops: readonly { position: LatLon; durationSeconds: number }[];
      }
    | undefined;
  readonly status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';
  readonly version: number;
}

export function createHistoryTrackOverlay(
  settings: PersistedValue<TrackSettings>,
  tripLog: TripLogView,
  reviewActive: () => boolean = () => false,
): HistoryTrackOverlay {
  let paint = mapThemePaint('day');
  let visible = true;
  let renderedVisible: boolean | undefined;
  let renderedVersion = -1;

  function applyVisibility(ctx: OverlayContext): void {
    const next = visible && tripLogEnabled(settings.value) && !reviewActive();
    if (next === renderedVisible) return;
    renderedVisible = next;
    setLayersVisibility(ctx.map, LAYER_IDS, next);
  }

  function render(ctx: OverlayContext): void {
    const day = tripLog.day;
    const features: GeoJSON.Feature[] = [];
    for (const portion of day?.portions ?? []) {
      features.push({
        type: 'Feature',
        geometry: antimeridianLineGeometry(
          portion.points.map((point) => latLonToLonLat(point.position)),
        ),
        properties: { kind: 'portion' },
      });
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: latLonToLonLat(portion.labelPosition) },
        properties: { kind: 'duration', label: formatDuration(portion.durationSeconds) },
      });
    }
    for (const stop of day?.stops ?? []) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: latLonToLonLat(stop.position) },
        properties: { kind: 'stop', label: formatDuration(stop.durationSeconds) },
      });
    }
    setSourceData(ctx.map, SOURCE_ID, featureCollection(features));
  }

  return {
    id: 'track-history',
    title: 'Trip log',
    description: 'Daily travel from Signal K history, with direction, portions, and stops.',
    band: BAND,
    supportsOpacity: true,
    defaultVisible: true,
    available: () => tripLog.status !== 'unavailable',
    unavailableHint: 'Trip log needs a Signal K history provider plugin on the server.',
    layerIds: LAYER_IDS,
    add(ctx) {
      renderedVisible = undefined;
      ensureGeoJsonSource(ctx.map, SOURCE_ID);
      if (!ctx.map.getLayer(LAYER_ID)) {
        const layer: LineLayerSpecification = {
          id: LAYER_ID,
          type: 'line',
          source: SOURCE_ID,
          filter: ['==', ['get', 'kind'], 'portion'],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': paint.trackSolid,
            'line-width': 3,
            'line-opacity': LINE_OPACITY,
          },
        };
        ctx.map.addLayer(layer, ctx.beforeIdFor(BAND));
      }
      if (!ctx.map.getLayer(DIRECTION_LAYER_ID)) {
        const layer: SymbolLayerSpecification = {
          id: DIRECTION_LAYER_ID,
          type: 'symbol',
          source: SOURCE_ID,
          filter: ['==', ['get', 'kind'], 'portion'],
          layout: {
            'symbol-placement': 'line',
            'symbol-spacing': 72,
            'text-field': '›',
            'text-font': ['Noto Sans Regular'],
            'text-size': 18,
            'text-rotation-alignment': 'map',
            'text-keep-upright': false,
            'text-allow-overlap': true,
          },
          paint: { 'text-color': paint.trackSolid, 'text-opacity': 0.9 },
        };
        ctx.map.addLayer(layer, ctx.beforeIdFor(BAND));
      }
      if (!ctx.map.getLayer(DURATION_LAYER_ID)) {
        const layer: SymbolLayerSpecification = {
          id: DURATION_LAYER_ID,
          type: 'symbol',
          source: SOURCE_ID,
          filter: ['==', ['get', 'kind'], 'duration'],
          layout: {
            'text-field': ['get', 'label'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 10,
            'text-padding': 3,
          },
          paint: {
            'text-color': paint.label,
            'text-halo-color': paint.background,
            'text-halo-width': 2,
          },
        };
        ctx.map.addLayer(layer, ctx.beforeIdFor(BAND));
      }
      if (!ctx.map.getLayer(STOP_LAYER_ID)) {
        const layer: CircleLayerSpecification = {
          id: STOP_LAYER_ID,
          type: 'circle',
          source: SOURCE_ID,
          filter: ['==', ['get', 'kind'], 'stop'],
          paint: {
            'circle-color': paint.background,
            'circle-stroke-color': paint.trackSolid,
            'circle-stroke-width': 2,
            'circle-radius': 6,
          },
        };
        ctx.map.addLayer(layer, ctx.beforeIdFor(BAND));
      }
      if (!ctx.map.getLayer(STOP_LABEL_LAYER_ID)) {
        const layer: SymbolLayerSpecification = {
          id: STOP_LABEL_LAYER_ID,
          type: 'symbol',
          source: SOURCE_ID,
          filter: ['==', ['get', 'kind'], 'stop'],
          layout: {
            'text-field': ['concat', '■  ', ['get', 'label']],
            'text-font': ['Noto Sans Regular'],
            'text-size': 11,
            'text-offset': [0, 1.3],
            'text-anchor': 'top',
            'text-optional': true,
          },
          paint: {
            'text-color': paint.label,
            'text-halo-color': paint.background,
            'text-halo-width': 1.5,
          },
        };
        ctx.map.addLayer(layer, ctx.beforeIdFor(BAND));
      }
      render(ctx);
      applyVisibility(ctx);
    },
    sync(ctx) {
      applyVisibility(ctx);
      if (renderedVersion === tripLog.version) return;
      renderedVersion = tripLog.version;
      render(ctx);
    },
    setVisible(ctx, next) {
      visible = next;
      applyVisibility(ctx);
    },
    setOpacity(ctx, opacity) {
      if (ctx.map.getLayer(LAYER_ID))
        ctx.map.setPaintProperty(LAYER_ID, 'line-opacity', LINE_OPACITY * opacity);
      for (const id of [DIRECTION_LAYER_ID, DURATION_LAYER_ID, STOP_LABEL_LAYER_ID]) {
        if (ctx.map.getLayer(id)) ctx.map.setPaintProperty(id, 'text-opacity', opacity);
      }
      if (ctx.map.getLayer(STOP_LAYER_ID)) {
        ctx.map.setPaintProperty(STOP_LAYER_ID, 'circle-opacity', opacity);
        ctx.map.setPaintProperty(STOP_LAYER_ID, 'circle-stroke-opacity', opacity);
      }
    },
    applyTheme(ctx, next) {
      paint = next;
      if (ctx.map.getLayer(LAYER_ID))
        ctx.map.setPaintProperty(LAYER_ID, 'line-color', paint.trackSolid);
      if (ctx.map.getLayer(DIRECTION_LAYER_ID))
        ctx.map.setPaintProperty(DIRECTION_LAYER_ID, 'text-color', paint.trackSolid);
      for (const id of [DURATION_LAYER_ID, STOP_LABEL_LAYER_ID]) {
        if (!ctx.map.getLayer(id)) continue;
        ctx.map.setPaintProperty(id, 'text-color', paint.label);
        ctx.map.setPaintProperty(id, 'text-halo-color', paint.background);
      }
      if (ctx.map.getLayer(STOP_LAYER_ID)) {
        ctx.map.setPaintProperty(STOP_LAYER_ID, 'circle-color', paint.background);
        ctx.map.setPaintProperty(STOP_LAYER_ID, 'circle-stroke-color', paint.trackSolid);
      }
    },
    remove(ctx) {
      removeLayersAndSources(ctx.map, [...LAYER_IDS].reverse(), [SOURCE_ID]);
    },
  };
}
