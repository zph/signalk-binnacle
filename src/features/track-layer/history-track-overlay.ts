import type {
  CircleLayerSpecification,
  LineLayerSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import { asNumber, type LatLon, latLonToLonLat } from '$shared/geo';
import { formatDuration, knotsToMetersPerSecond, MINUTE_MS } from '$shared/lib';
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
import {
  type PersistedValue,
  preferTrackHistory,
  type TrackSettings,
  trackStopDurationMinutes,
  trackStopSpeedKnots,
} from '$shared/settings';
import {
  columnIndex,
  fetchHistoryValuesAcrossProviders,
  HISTORY_RESOLUTION_SECONDS,
  HISTORY_WINDOW_SECONDS,
  type HistoryProviders,
  type HistoryValues,
  positionFromHistoryRow,
  SK_PATHS,
} from '$shared/signalk';

const SOURCE_ID = 'binnacle-track-history';
const LAYER_ID = 'binnacle-track-history-line';
const STOP_LAYER_ID = 'binnacle-track-history-stops';
const STOP_LABEL_LAYER_ID = 'binnacle-track-history-stop-labels';
const BAND = 'track';
// Dashed and faded so the server-recorded past stays visually behind the live track line.
const LINE_WIDTH = 2;
const LINE_OPACITY = 0.6;
const DASH = [2, 2];
const REFRESH_MS = 15 * MINUTE_MS;
// A break longer than this between positions starts a new line segment, so a day at the dock
// followed by a sail does not draw a straight line across the gap.
const GAP_SECONDS = 15 * 60;
const STOP_SAMPLE_GAP_SECONDS = HISTORY_RESOLUTION_SECONDS * 2;

export interface TrackStop {
  position: LatLon;
  startedAt: number;
  endedAt: number;
  durationSeconds: number;
}

export function detectTrackStops(
  values: HistoryValues,
  speedKnots: number,
  durationMinutes: number,
): TrackStop[] {
  const positionIndex = columnIndex(values, SK_PATHS.position);
  const speedIndex = columnIndex(values, SK_PATHS.speedOverGround);
  if (positionIndex < 0 || speedIndex < 0) return [];
  const speedMps = knotsToMetersPerSecond(speedKnots);
  const minimumSeconds = durationMinutes * 60;
  const stops: TrackStop[] = [];
  let candidate: { position: LatLon; startedAt: number; endedAt: number } | undefined;

  const finish = (): void => {
    if (candidate && (candidate.endedAt - candidate.startedAt) / 1000 > minimumSeconds) {
      stops.push({
        ...candidate,
        durationSeconds: (candidate.endedAt - candidate.startedAt) / 1000,
      });
    }
    candidate = undefined;
  };

  for (const row of values.rows) {
    const position = positionFromHistoryRow(row, positionIndex);
    const speed = asNumber(row[speedIndex + 1]);
    const timestamp = Date.parse(row[0]);
    if (!position || speed === undefined || speed < 0 || !Number.isFinite(timestamp)) {
      finish();
      continue;
    }
    if (speed >= speedMps) {
      finish();
      continue;
    }
    if (candidate && (timestamp - candidate.endedAt) / 1000 > STOP_SAMPLE_GAP_SECONDS) {
      finish();
    }
    candidate ??= { position, startedAt: timestamp, endedAt: timestamp };
    candidate.endedAt = timestamp;
  }
  finish();
  return stops;
}

interface Deps {
  fetchValues: typeof fetchHistoryValuesAcrossProviders;
  now: () => number;
}

export interface HistoryTrackOverlay extends OverlayModule {
  sync(ctx: OverlayContext): void;
}

// The vessel's last 24 hours from the server's v2 History API, drawn as a dashed line under the
// live fallback track. Registration is unconditional; every fetch is gated on a provider being
// known, so a stock server pays one empty source and nothing else. History is the primary default;
// the persisted track settings can select local-only behavior.
export function createHistoryTrackOverlay(
  origin: string,
  getToken: () => string | undefined,
  providers: () => HistoryProviders | undefined,
  settings: PersistedValue<TrackSettings>,
  reviewActive: () => boolean = () => false,
  deps: Deps = { fetchValues: fetchHistoryValuesAcrossProviders, now: Date.now },
): HistoryTrackOverlay {
  let paint = mapThemePaint('day');
  let visible = true;
  let renderedVisible: boolean | undefined;
  let fetching = false;
  let nextFetchAt = 0;
  let acceptedValues: HistoryValues | undefined;
  let renderedStopConfig = '';

  function stopConfig(): string {
    return `${trackStopSpeedKnots(settings.value)}\u0000${trackStopDurationMinutes(settings.value)}`;
  }

  function applyVisibility(ctx: OverlayContext, reviewing = reviewActive()): void {
    const next = visible && preferTrackHistory(settings.value) && !reviewing;
    if (next === renderedVisible) return;
    renderedVisible = next;
    setLayersVisibility(ctx.map, [LAYER_ID, STOP_LAYER_ID, STOP_LABEL_LAYER_ID], next);
  }

  function toFeature(values: HistoryValues): GeoJSON.FeatureCollection {
    const iPos = columnIndex(values, SK_PATHS.position);
    const lines: Array<Array<[number, number]>> = [];
    let line: Array<[number, number]> = [];
    let lastSeconds: number | undefined;
    for (const row of values.rows) {
      const position = positionFromHistoryRow(row, iPos);
      if (!position) continue;
      const seconds = Date.parse(row[0]) / 1000;
      // A malformed timestamp yields NaN, which would poison every later gap comparison (NaN
      // compares false) and silently disable gap-splitting for the rest of the track.
      if (!Number.isFinite(seconds)) continue;
      if (lastSeconds !== undefined && seconds - lastSeconds > GAP_SECONDS) {
        if (line.length > 1) lines.push(line);
        line = [];
      }
      line.push(latLonToLonLat(position));
      lastSeconds = seconds;
    }
    if (line.length > 1) lines.push(line);
    const lineFeatures: GeoJSON.Feature[] = lines.map((coordinates) => ({
      type: 'Feature',
      geometry: antimeridianLineGeometry(coordinates),
      properties: { kind: 'track' },
    }));
    const stops: GeoJSON.Feature[] = detectTrackStops(
      values,
      trackStopSpeedKnots(settings.value),
      trackStopDurationMinutes(settings.value),
    ).map((stop) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: latLonToLonLat(stop.position) },
      properties: { kind: 'stop', label: formatDuration(stop.durationSeconds) },
    }));
    return featureCollection([...lineFeatures, ...stops]);
  }

  async function refresh(ctx: OverlayContext): Promise<void> {
    const known = providers();
    if (!preferTrackHistory(settings.value) || !known || known.ids.length === 0 || fetching) return;
    fetching = true;
    try {
      const got = await deps.fetchValues(origin, getToken(), known, {
        paths: [SK_PATHS.position, SK_PATHS.speedOverGround],
        durationSeconds: HISTORY_WINDOW_SECONDS,
        resolutionSeconds: HISTORY_RESOLUTION_SECONDS,
      });
      if (got) {
        acceptedValues = got.values;
        renderedStopConfig = stopConfig();
        setSourceData(ctx.map, SOURCE_ID, toFeature(got.values));
      }
      // A failed query retries on the same cadence; the drawn line stays until then.
      nextFetchAt = deps.now() + REFRESH_MS;
    } finally {
      fetching = false;
    }
  }

  return {
    id: 'track-history',
    title: 'Track history (24 h)',
    description: "Your boat's path over the last 24 hours.",
    band: BAND,
    supportsOpacity: true,
    defaultVisible: true,
    available: () => (providers()?.ids.length ?? 0) > 0,
    unavailableHint: 'Track history needs a Signal K history provider plugin on the server.',
    layerIds: [LAYER_ID, STOP_LAYER_ID, STOP_LABEL_LAYER_ID],
    add(ctx) {
      nextFetchAt = 0;
      renderedVisible = undefined;
      ensureGeoJsonSource(ctx.map, SOURCE_ID);
      if (!ctx.map.getLayer(LAYER_ID)) {
        const layer: LineLayerSpecification = {
          id: LAYER_ID,
          type: 'line',
          source: SOURCE_ID,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': paint.trackSolid,
            'line-width': LINE_WIDTH,
            'line-opacity': LINE_OPACITY,
            'line-dasharray': DASH,
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
            'circle-radius': 5,
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
            'text-field': ['get', 'label'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 11,
            'text-offset': [0, 1.2],
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
    },
    sync(ctx) {
      const reviewing = reviewActive();
      applyVisibility(ctx, reviewing);
      if (!visible || !preferTrackHistory(settings.value) || reviewing) return;
      const nextStopConfig = stopConfig();
      if (acceptedValues && nextStopConfig !== renderedStopConfig) {
        renderedStopConfig = nextStopConfig;
        setSourceData(ctx.map, SOURCE_ID, toFeature(acceptedValues));
      }
      const now = deps.now();
      if (now < nextFetchAt) return;
      nextFetchAt = now + REFRESH_MS;
      void refresh(ctx);
    },
    setVisible(ctx, next) {
      visible = next;
      applyVisibility(ctx);
      // First show fetches immediately rather than waiting out the refresh window.
      if (next) nextFetchAt = 0;
    },
    setOpacity(ctx, opacity) {
      if (ctx.map.getLayer(LAYER_ID)) {
        ctx.map.setPaintProperty(LAYER_ID, 'line-opacity', LINE_OPACITY * opacity);
      }
      if (ctx.map.getLayer(STOP_LAYER_ID)) {
        ctx.map.setPaintProperty(STOP_LAYER_ID, 'circle-opacity', opacity);
        ctx.map.setPaintProperty(STOP_LAYER_ID, 'circle-stroke-opacity', opacity);
      }
      if (ctx.map.getLayer(STOP_LABEL_LAYER_ID)) {
        ctx.map.setPaintProperty(STOP_LABEL_LAYER_ID, 'text-opacity', opacity);
      }
    },
    applyTheme(ctx, next) {
      paint = next;
      if (ctx.map.getLayer(LAYER_ID)) {
        ctx.map.setPaintProperty(LAYER_ID, 'line-color', paint.trackSolid);
      }
      if (ctx.map.getLayer(STOP_LAYER_ID)) {
        ctx.map.setPaintProperty(STOP_LAYER_ID, 'circle-color', paint.background);
        ctx.map.setPaintProperty(STOP_LAYER_ID, 'circle-stroke-color', paint.trackSolid);
      }
      if (ctx.map.getLayer(STOP_LABEL_LAYER_ID)) {
        ctx.map.setPaintProperty(STOP_LABEL_LAYER_ID, 'text-color', paint.label);
        ctx.map.setPaintProperty(STOP_LABEL_LAYER_ID, 'text-halo-color', paint.background);
      }
    },
    remove(ctx) {
      removeLayersAndSources(ctx.map, [STOP_LABEL_LAYER_ID, STOP_LAYER_ID, LAYER_ID], [SOURCE_ID]);
    },
  };
}
