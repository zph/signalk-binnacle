import type {
  CircleLayerSpecification,
  LineLayerSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import { Popup } from 'maplibre-gl';
import type { TripPortion } from '$features/tracks';
import { type LatLon, latLonToLonLat } from '$shared/geo';
import { formatDuration } from '$shared/lib';
import {
  antimeridianLineGeometry,
  createLayerHitHandlers,
  ensureGeoJsonSource,
  featureCollection,
  mapThemePaint,
  type OverlayContext,
  type OverlayModule,
  overlayInteractive,
  removeLayersAndSources,
  setLayersVisibility,
  setSourceData,
} from '$shared/map';
import { type PersistedValue, type TrackSettings, tripLogEnabled } from '$shared/settings';
import {
  annotationCapacity,
  annotationFor,
  selectAnnotationPoints,
  windBarbGeometry,
} from './history-track-annotations';

const SOURCE_ID = 'binnacle-track-history';
const LAYER_ID = 'binnacle-track-history-line';
const DIRECTION_LAYER_ID = 'binnacle-track-history-direction';
const DURATION_LAYER_ID = 'binnacle-track-history-duration';
const STOP_LAYER_ID = 'binnacle-track-history-stops';
const STOP_LABEL_LAYER_ID = 'binnacle-track-history-stop-labels';
const WIND_BARB_LAYER_ID = 'binnacle-track-history-wind-barbs';
const ANNOTATION_LAYER_ID = 'binnacle-track-history-annotations';
const ANNOTATION_HIT_LAYER_ID = 'binnacle-track-history-annotation-hits';
const LAYER_IDS = [
  LAYER_ID,
  DIRECTION_LAYER_ID,
  DURATION_LAYER_ID,
  STOP_LAYER_ID,
  STOP_LABEL_LAYER_ID,
  WIND_BARB_LAYER_ID,
  ANNOTATION_LAYER_ID,
  ANNOTATION_HIT_LAYER_ID,
];
const BAND = 'track';
const LINE_OPACITY = 0.72;

export interface HistoryTrackOverlay extends OverlayModule {
  sync(ctx: OverlayContext): void;
}

export interface TripLogView {
  readonly day:
    | {
        portions: readonly TripPortion[];
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
  let opacity = 1;
  let renderedVisible: boolean | undefined;
  let renderedVersion = -1;
  let moveListener: (() => void) | undefined;
  let detailPopup: Popup | undefined;
  let attachedContext: OverlayContext | undefined;
  const canInteract = () =>
    overlayInteractive(visible && tripLogEnabled(settings.value), opacity, () => !reviewActive());

  function popupContent(detail: string): HTMLElement {
    const root = document.createElement('section');
    root.className = 'map-reading-popup';
    root.setAttribute('aria-label', 'Trip history sample');
    const heading = document.createElement('h3');
    heading.className = 'map-reading-popup__title';
    heading.textContent = 'Trip sample';
    const reading = document.createElement('p');
    reading.className = 'map-reading-popup__value map-reading-popup__summary';
    reading.textContent = detail;
    root.append(heading, reading);
    return root;
  }

  const hitHandlers = createLayerHitHandlers(
    ANNOTATION_HIT_LAYER_ID,
    (event) => {
      const feature = event.features?.[0];
      if (!attachedContext || feature?.geometry.type !== 'Point') return false;
      const detail = feature.properties?.detail;
      const coordinates = feature.geometry.coordinates;
      if (
        typeof detail !== 'string' ||
        !Number.isFinite(coordinates[0]) ||
        !Number.isFinite(coordinates[1])
      ) {
        return false;
      }
      detailPopup?.remove();
      detailPopup = new Popup({
        closeButton: true,
        closeOnClick: true,
        offset: 18,
        maxWidth: '22rem',
      })
        .setLngLat([coordinates[0], coordinates[1]])
        .setDOMContent(popupContent(detail.slice(0, 300)))
        .addTo(attachedContext.map);
      return true;
    },
    { band: BAND, interactionsAllowed: canInteract },
  );

  function applyVisibility(ctx: OverlayContext): void {
    const next = visible && tripLogEnabled(settings.value) && !reviewActive();
    if (next === renderedVisible) return;
    renderedVisible = next;
    setLayersVisibility(ctx.map, LAYER_IDS, next);
    if (!next) {
      detailPopup?.remove();
      detailPopup = undefined;
    }
    hitHandlers.refreshInteractionState();
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
    const width = ctx.map.getCanvas().getBoundingClientRect().width;
    const annotations = selectAnnotationPoints(day?.portions ?? [], annotationCapacity(width)).map(
      annotationFor,
    );
    for (const annotation of annotations) {
      const coordinates = latLonToLonLat(annotation.position);
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates },
        properties: {
          kind: 'annotation',
          label: `${annotation.timeLabel}\n${annotation.conditionsLabel}`,
          detail: annotation.detailLabel,
        },
      });
      const barb = windBarbGeometry(annotation, ctx.map.getZoom());
      if (barb) {
        features.push({
          type: 'Feature',
          geometry: barb,
          properties: { kind: 'wind-barb' },
        });
      }
    }
    setSourceData(ctx.map, SOURCE_ID, featureCollection(features));
  }

  return {
    id: 'track-history',
    title: 'Trip log',
    description: 'Daily travel with timestamps, wind, speed, direction, portions, and stops.',
    band: BAND,
    supportsOpacity: true,
    defaultVisible: true,
    available: () => tripLog.status !== 'unavailable',
    unavailableHint: 'Trip log needs a Signal K history provider plugin on the server.',
    layerIds: LAYER_IDS,
    add(ctx) {
      attachedContext = ctx;
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
      if (!ctx.map.getLayer(WIND_BARB_LAYER_ID)) {
        const layer: LineLayerSpecification = {
          id: WIND_BARB_LAYER_ID,
          type: 'line',
          source: SOURCE_ID,
          filter: ['==', ['get', 'kind'], 'wind-barb'],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': paint.label,
            'line-width': 1.5,
            'line-opacity': opacity,
          },
        };
        ctx.map.addLayer(layer, ctx.beforeIdFor(BAND));
      }
      if (!ctx.map.getLayer(ANNOTATION_LAYER_ID)) {
        const layer: SymbolLayerSpecification = {
          id: ANNOTATION_LAYER_ID,
          type: 'symbol',
          source: SOURCE_ID,
          filter: ['==', ['get', 'kind'], 'annotation'],
          layout: {
            'text-field': ['get', 'label'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 11,
            'text-offset': [0, 1.25],
            'text-anchor': 'top',
            'text-padding': 5,
            'text-optional': true,
          },
          paint: {
            'text-color': paint.label,
            'text-halo-color': paint.background,
            'text-halo-width': 2,
            'text-opacity': opacity,
          },
        };
        ctx.map.addLayer(layer, ctx.beforeIdFor(BAND));
      }
      if (!ctx.map.getLayer(ANNOTATION_HIT_LAYER_ID)) {
        const layer: CircleLayerSpecification = {
          id: ANNOTATION_HIT_LAYER_ID,
          type: 'circle',
          source: SOURCE_ID,
          filter: ['==', ['get', 'kind'], 'annotation'],
          paint: { 'circle-radius': 22, 'circle-color': 'rgba(0,0,0,0.01)' },
        };
        ctx.map.addLayer(layer, ctx.beforeIdFor(BAND));
      }
      hitHandlers.attach(ctx);
      moveListener = () => {
        if (!canInteract()) return;
        render(ctx);
      };
      ctx.map.on('zoomend', moveListener);
      ctx.map.on('resize', moveListener);
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
      if (!canInteract()) {
        detailPopup?.remove();
        detailPopup = undefined;
      }
      applyVisibility(ctx);
      hitHandlers.refreshInteractionState();
    },
    setOpacity(ctx, value) {
      opacity = value;
      if (ctx.map.getLayer(LAYER_ID))
        ctx.map.setPaintProperty(LAYER_ID, 'line-opacity', LINE_OPACITY * value);
      for (const id of [
        DIRECTION_LAYER_ID,
        DURATION_LAYER_ID,
        STOP_LABEL_LAYER_ID,
        ANNOTATION_LAYER_ID,
      ]) {
        if (ctx.map.getLayer(id)) ctx.map.setPaintProperty(id, 'text-opacity', value);
      }
      if (ctx.map.getLayer(STOP_LAYER_ID)) {
        ctx.map.setPaintProperty(STOP_LAYER_ID, 'circle-opacity', value);
        ctx.map.setPaintProperty(STOP_LAYER_ID, 'circle-stroke-opacity', value);
      }
      if (ctx.map.getLayer(WIND_BARB_LAYER_ID))
        ctx.map.setPaintProperty(WIND_BARB_LAYER_ID, 'line-opacity', value);
      hitHandlers.refreshInteractionState();
    },
    applyTheme(ctx, next) {
      paint = next;
      if (ctx.map.getLayer(LAYER_ID))
        ctx.map.setPaintProperty(LAYER_ID, 'line-color', paint.trackSolid);
      if (ctx.map.getLayer(DIRECTION_LAYER_ID))
        ctx.map.setPaintProperty(DIRECTION_LAYER_ID, 'text-color', paint.trackSolid);
      for (const id of [DURATION_LAYER_ID, STOP_LABEL_LAYER_ID, ANNOTATION_LAYER_ID]) {
        if (!ctx.map.getLayer(id)) continue;
        ctx.map.setPaintProperty(id, 'text-color', paint.label);
        ctx.map.setPaintProperty(id, 'text-halo-color', paint.background);
      }
      if (ctx.map.getLayer(WIND_BARB_LAYER_ID))
        ctx.map.setPaintProperty(WIND_BARB_LAYER_ID, 'line-color', paint.label);
      if (ctx.map.getLayer(STOP_LAYER_ID)) {
        ctx.map.setPaintProperty(STOP_LAYER_ID, 'circle-color', paint.background);
        ctx.map.setPaintProperty(STOP_LAYER_ID, 'circle-stroke-color', paint.trackSolid);
      }
    },
    remove(ctx) {
      detailPopup?.remove();
      detailPopup = undefined;
      hitHandlers.detach(ctx);
      if (moveListener) {
        ctx.map.off('zoomend', moveListener);
        ctx.map.off('resize', moveListener);
      }
      moveListener = undefined;
      attachedContext = undefined;
      removeLayersAndSources(ctx.map, [...LAYER_IDS].reverse(), [SOURCE_ID]);
    },
  };
}
