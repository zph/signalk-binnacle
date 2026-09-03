import type { CircleLayerSpecification, SymbolLayerSpecification } from 'maplibre-gl';
import { type Bbox4, bboxContains, lngLatBoundsToBbox4, padBbox } from '$shared/geo';
import { isRecord, readBoundedJson, withTimeout } from '$shared/lib';
import {
  ensureGeoJsonSource,
  featureCollection,
  mapThemePaint,
  type OverlayContext,
  removeLayersAndSources,
  rgbaCss,
  setLayersVisibility,
  setSourceData,
} from '$shared/map';
import { authInit } from '$shared/signalk';

const SOURCE_ID = 'binnacle-viewport-ais-source';
const TARGET_LAYER_ID = 'binnacle-viewport-ais-targets';
const LABEL_LAYER_ID = 'binnacle-viewport-ais-labels';
const LAYERS = [TARGET_LAYER_ID, LABEL_LAYER_ID] as const;
const SETTLE_MS = 1_500;
const LIVE_POLL_MS = 5_000;
const CONNECTING_POLL_MS = 2_000;
const MAX_TARGETS = 1_000;
const MAX_BBOX_SPAN = 5;

interface ViewportAisTarget {
  id: string;
  mmsi: string;
  name?: string;
  position: { latitude: number; longitude: number };
  lastReportAtMs: number;
}

interface DestinationSnapshot {
  state: 'connecting' | 'live' | 'disconnected' | 'error' | 'unavailable';
  targets: ViewportAisTarget[];
}

export interface ViewportAisOverlayOptions {
  origin: string;
  getToken: () => string | undefined;
  available: () => boolean;
  now?: () => number;
}

function finite(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
  );
}

function target(value: unknown): ViewportAisTarget | undefined {
  if (!isRecord(value) || !isRecord(value.position)) return undefined;
  const { id, mmsi, name, lastReportAtMs } = value;
  const { latitude, longitude } = value.position;
  if (
    typeof id !== 'string' ||
    typeof mmsi !== 'string' ||
    !finite(latitude, -90, 90) ||
    !finite(longitude, -180, 180) ||
    !finite(lastReportAtMs, 0, Number.MAX_SAFE_INTEGER)
  ) {
    return undefined;
  }
  return {
    id,
    mmsi,
    name: typeof name === 'string' && name.trim() ? name.trim() : undefined,
    position: { latitude, longitude },
    lastReportAtMs,
  };
}

async function fetchTargets(
  origin: string,
  token: string | undefined,
  bbox: Bbox4,
): Promise<DestinationSnapshot> {
  const query = new URLSearchParams({ bbox: JSON.stringify(bbox) });
  try {
    const response = await fetch(
      `${origin}/plugins/signalk-aisstream/api/destination?${query}`,
      withTimeout(authInit(token, { cache: 'no-store' }), 5_000),
    );
    if (response.status === 404 || response.status === 503) {
      return { state: 'unavailable', targets: [] };
    }
    if (!response.ok) return { state: 'error', targets: [] };
    const body = await readBoundedJson<unknown>(response);
    if (!isRecord(body) || !Array.isArray(body.targets)) {
      return { state: 'error', targets: [] };
    }
    const state =
      body.state === 'live' ||
      body.state === 'connecting' ||
      body.state === 'disconnected' ||
      body.state === 'error'
        ? body.state
        : 'error';
    return {
      state,
      targets: body.targets
        .slice(0, MAX_TARGETS)
        .map(target)
        .filter((item): item is ViewportAisTarget => item !== undefined),
    };
  } catch {
    return { state: 'error', targets: [] };
  }
}

function sameBbox(left: Bbox4 | undefined, right: Bbox4): boolean {
  return left?.every((coordinate, index) => coordinate === right[index]) ?? false;
}

function requestBbox(viewport: Bbox4): Bbox4 | undefined {
  const [west, south, east, north] = viewport;
  if (west >= east || east - west > MAX_BBOX_SPAN || north - south > MAX_BBOX_SPAN)
    return undefined;
  const padded = padBbox(viewport);
  return padded[2] - padded[0] <= MAX_BBOX_SPAN && padded[3] - padded[1] <= MAX_BBOX_SPAN
    ? padded
    : viewport;
}

function features(targets: readonly ViewportAisTarget[]): GeoJSON.FeatureCollection {
  return featureCollection(
    targets.map((item) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [item.position.longitude, item.position.latitude],
      },
      properties: {
        id: item.id,
        label: item.name ?? item.mmsi,
      },
    })),
  );
}

export function createViewportAisOverlay(options: ViewportAisOverlayOptions) {
  const now = options.now ?? Date.now;
  let visible = true;
  let opacity = 1;
  let mounted = false;
  let loading = false;
  let fetchedBbox: Bbox4 | undefined;
  let pendingViewport: Bbox4 | undefined;
  let pendingSince = 0;
  let nextFetchAt = 0;
  let generation = 0;
  let currentTargets: ViewportAisTarget[] = [];
  let paint = mapThemePaint('day');

  function clear(ctx: OverlayContext): void {
    currentTargets = [];
    fetchedBbox = undefined;
    setSourceData(ctx.map, SOURCE_ID, features([]));
  }

  async function load(ctx: OverlayContext, bbox: Bbox4): Promise<void> {
    const requestGeneration = ++generation;
    loading = true;
    const snapshot = await fetchTargets(options.origin, options.getToken(), bbox);
    if (!mounted || requestGeneration !== generation) return;
    loading = false;
    fetchedBbox = bbox;
    currentTargets = snapshot.targets;
    setSourceData(ctx.map, SOURCE_ID, features(currentTargets));
    nextFetchAt = now() + (snapshot.state === 'live' ? LIVE_POLL_MS : CONNECTING_POLL_MS);
  }

  return {
    id: 'viewport-ais',
    title: 'Viewport AIS',
    description: 'AISStream targets in the stabilized chart viewport.',
    band: 'traffic' as const,
    listed: false,
    supportsOpacity: true,
    layerIds: LAYERS,
    add(ctx: OverlayContext) {
      mounted = true;
      ensureGeoJsonSource(ctx.map, SOURCE_ID);
      const before = ctx.beforeIdFor('traffic');
      if (!ctx.map.getLayer(TARGET_LAYER_ID)) {
        const layer: CircleLayerSpecification = {
          id: TARGET_LAYER_ID,
          type: 'circle',
          source: SOURCE_ID,
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 3, 15, 7],
            'circle-color': rgbaCss(paint.aisTarget),
            'circle-stroke-color': paint.markerGlyph,
            'circle-stroke-width': 2,
            'circle-opacity': opacity * 0.95,
          },
        };
        ctx.map.addLayer(layer, before);
      }
      if (!ctx.map.getLayer(LABEL_LAYER_ID)) {
        const labels: SymbolLayerSpecification = {
          id: LABEL_LAYER_ID,
          type: 'symbol',
          source: SOURCE_ID,
          minzoom: 11,
          layout: {
            'text-field': ['get', 'label'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 11,
            'text-offset': [0, 1.25],
            'text-anchor': 'top',
            'text-optional': true,
          },
          paint: {
            'text-color': rgbaCss(paint.aisTarget),
            'text-halo-color': paint.background,
            'text-halo-width': 1.2,
            'text-opacity': opacity,
          },
        };
        ctx.map.addLayer(labels, before);
      }
      setLayersVisibility(ctx.map, LAYERS, visible);
    },
    sync(ctx: OverlayContext) {
      if (!options.available()) {
        if (currentTargets.length > 0) clear(ctx);
        return;
      }
      const viewport = lngLatBoundsToBbox4(ctx.map.getBounds());
      if (fetchedBbox && bboxContains(fetchedBbox, viewport) && now() < nextFetchAt) return;
      if (!pendingViewport || !sameBbox(pendingViewport, viewport)) {
        pendingViewport = viewport;
        pendingSince = now();
        return;
      }
      if (loading || now() - pendingSince < SETTLE_MS) return;
      const bbox = requestBbox(viewport);
      if (!bbox) {
        if (currentTargets.length > 0) clear(ctx);
        return;
      }
      void load(ctx, bbox);
    },
    setVisible(ctx: OverlayContext, nextVisible: boolean) {
      visible = nextVisible;
      setLayersVisibility(ctx.map, LAYERS, nextVisible);
    },
    setOpacity(ctx: OverlayContext, nextOpacity: number) {
      opacity = nextOpacity;
      if (ctx.map.getLayer(TARGET_LAYER_ID)) {
        ctx.map.setPaintProperty(TARGET_LAYER_ID, 'circle-opacity', opacity * 0.95);
      }
      if (ctx.map.getLayer(LABEL_LAYER_ID)) {
        ctx.map.setPaintProperty(LABEL_LAYER_ID, 'text-opacity', opacity);
      }
    },
    applyTheme(ctx: OverlayContext, nextPaint: typeof paint) {
      paint = nextPaint;
      if (ctx.map.getLayer(TARGET_LAYER_ID)) {
        ctx.map.setPaintProperty(TARGET_LAYER_ID, 'circle-color', rgbaCss(paint.aisTarget));
        ctx.map.setPaintProperty(TARGET_LAYER_ID, 'circle-stroke-color', paint.markerGlyph);
      }
      if (ctx.map.getLayer(LABEL_LAYER_ID)) {
        ctx.map.setPaintProperty(LABEL_LAYER_ID, 'text-color', rgbaCss(paint.aisTarget));
        ctx.map.setPaintProperty(LABEL_LAYER_ID, 'text-halo-color', paint.background);
      }
    },
    remove(ctx: OverlayContext) {
      mounted = false;
      generation += 1;
      removeLayersAndSources(ctx.map, LAYERS, [SOURCE_ID]);
    },
  };
}
