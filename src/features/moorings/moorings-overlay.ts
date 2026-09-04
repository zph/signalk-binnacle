import type { AisTargets } from '$entities/ais';
import {
  bboxContains,
  bboxContainsPoint,
  lngLatBoundsToBbox4,
  padBbox,
  splitAtAntimeridian,
} from '$shared/geo';
import {
  createLayerHitHandlers,
  emptyFeatureCollection,
  featureCollection,
  mapThemePaint,
  type OverlayContext,
  type OverlayModule,
  overlayInteractive,
  type Syncable,
  setLayersVisibility,
  setSourceData,
} from '$shared/map';
import type { ExpiringStore } from '$shared/storage';
import { assessMoorings, OnboardAisHistory } from './mooring-occupancy';
import { createMooringsCache } from './moorings-cache';
import { fetchMoorings } from './moorings-client';
import {
  addMooringLayers,
  applyMooringTheme,
  MOORINGS_LABEL_LAYER_ID,
  MOORINGS_LAYER_ID,
  MOORINGS_LAYERS,
  MOORINGS_MIN_ZOOM,
  MOORINGS_SELECTED_SOURCE_ID,
  MOORINGS_SOURCE_ID,
  removeMooringLayers,
} from './moorings-layers';
import type {
  DestinationAisState,
  MooringPoint,
  MooringViewPhase,
  MooringViewState,
} from './moorings-types';
import { mooringFromGeoJson } from './moorings-types';

const MOORINGS_RETRY_INITIAL_MS = 10_000;
const MOORINGS_RETRY_MAX_MS = 10 * 60_000;
const LOCAL_MOORINGS_SCAN_MS = 1_000;
const CHART_SOURCE_PREFIX = 'chart-';
const LOCAL_MOORINGS_SOURCE_LAYER = 'MORFAC';

export interface MooringsOverlay extends OverlayModule, Syncable {}

export interface MooringsOverlayOptions {
  destinationAisAvailable: () => boolean;
  selectedId: () => string | undefined;
  interactionsAllowed?: () => boolean;
  onSelect?: (id: string) => void;
  onMoorings?: (moorings: MooringPoint[]) => void;
  onStatus?: (state: MooringViewState) => void;
  isOnline?: () => boolean;
  persist?: ExpiringStore<unknown>;
}

function renderFeatures(moorings: readonly MooringPoint[]): GeoJSON.FeatureCollection {
  return featureCollection(
    moorings.map(
      (mooring): GeoJSON.Feature => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [mooring.position.longitude, mooring.position.latitude],
        },
        properties: {
          id: mooring.id,
          name: mooring.name,
          occupancy: mooring.assessment.status,
          score: mooring.assessment.score,
        },
      }),
    ),
  );
}

function localMoorings(ctx: OverlayContext, bbox: ReturnType<typeof padBbox>): MooringPoint[] {
  const sources = ctx.map.getStyle().sources ?? {};
  const boxes = splitAtAntimeridian(bbox);
  const byId = new Map<string, MooringPoint>();
  for (const [sourceId, source] of Object.entries(sources)) {
    if (
      !sourceId.startsWith(CHART_SOURCE_PREFIX) ||
      !source ||
      typeof source !== 'object' ||
      source.type !== 'vector'
    ) {
      continue;
    }
    try {
      for (const feature of ctx.map.querySourceFeatures(sourceId, {
        sourceLayer: LOCAL_MOORINGS_SOURCE_LAYER,
      })) {
        const mooring = mooringFromGeoJson(feature, 'general');
        if (
          !mooring ||
          !boxes.some((box) => bboxContainsPoint(box, mooring.position)) ||
          byId.has(mooring.id)
        ) {
          continue;
        }
        byId.set(mooring.id, mooring);
      }
    } catch {
      // A chart source can exist before its TileJSON or first vector tile is ready.
    }
  }
  return [...byId.values()];
}

export function createMooringsOverlay(
  origin: string,
  getToken: () => string | undefined,
  aisTargets: AisTargets,
  options: MooringsOverlayOptions,
): MooringsOverlay {
  let visible = true;
  let opacity = 1;
  let mounted = false;
  let lifecycle = 0;
  let fetchBbox: ReturnType<typeof lngLatBoundsToBbox4> | undefined;
  let lastFetchAttemptBbox: ReturnType<typeof lngLatBoundsToBbox4> | undefined;
  let rawMoorings: MooringPoint[] = [];
  let rendered: MooringPoint[] = [];
  let destinationAis: DestinationAisState = options.destinationAisAvailable()
    ? 'checking'
    : 'unavailable';
  let lastStatus: MooringViewState | undefined;
  let cachedAtMs: number | undefined;
  let loading = false;
  let consecutiveFetchFailures = 0;
  let nextFetchAt = 0;
  let lastLocalScanAt = Number.NEGATIVE_INFINITY;
  let lastRenderKey = '';
  let mooringVersion = 0;
  let themePaint = mapThemePaint('day');
  const onboardHistory = new OnboardAisHistory();
  const externalInteractionsAllowed = options.interactionsAllowed ?? (() => true);
  const isOnline = options.isOnline ?? (() => true);
  const cache = createMooringsCache(options.persist);
  const hit = createLayerHitHandlers(
    [MOORINGS_LABEL_LAYER_ID, MOORINGS_LAYER_ID],
    (event) => {
      const id = event.features?.[0]?.properties?.id;
      if (typeof id !== 'string') return false;
      options.onSelect?.(id);
      return true;
    },
    {
      band: 'routes',
      withinBandOrder: 2,
      interactionsAllowed: () => overlayInteractive(visible, opacity, externalInteractionsAllowed),
    },
  );

  function report(phase: MooringViewPhase): void {
    if (
      lastStatus?.phase === phase &&
      lastStatus.destinationAis === destinationAis &&
      lastStatus.cachedAtMs === cachedAtMs
    ) {
      return;
    }
    lastStatus = { phase, destinationAis, cachedAtMs };
    options.onStatus?.(lastStatus);
  }

  function clearRendered(ctx: OverlayContext): void {
    rendered = [];
    lastRenderKey = '';
    setSourceData(ctx.map, MOORINGS_SOURCE_ID, emptyFeatureCollection());
    setSourceData(ctx.map, MOORINGS_SELECTED_SOURCE_ID, emptyFeatureCollection());
    options.onMoorings?.([]);
  }

  function updateRender(ctx: OverlayContext, now: number): void {
    const observedTargets = onboardHistory.observe(aisTargets.list(), now);
    destinationAis = options.destinationAisAvailable() ? 'live' : 'unavailable';
    const viewport = lngLatBoundsToBbox4(ctx.map.getBounds());
    const key = [
      mooringVersion,
      options.selectedId() ?? '',
      ...viewport.map((value) => value.toFixed(5)),
      Math.floor(now / 60_000),
      ...observedTargets.map((target) => `${target.id}:${target.lastReportAtMs}`),
    ].join('|');
    if (key === lastRenderKey) return;
    lastRenderKey = key;
    rendered = assessMoorings(rawMoorings, observedTargets, [], now);
    setSourceData(ctx.map, MOORINGS_SOURCE_ID, renderFeatures(rendered));
    const selected = rendered.find((mooring) => mooring.id === options.selectedId());
    setSourceData(
      ctx.map,
      MOORINGS_SELECTED_SOURCE_ID,
      selected
        ? featureCollection([
            {
              type: 'Feature',
              geometry: {
                type: 'Point',
                coordinates: [selected.position.longitude, selected.position.latitude],
              },
              properties: {},
            },
          ])
        : emptyFeatureCollection(),
    );
    options.onMoorings?.(
      rendered.filter((mooring) =>
        splitAtAntimeridian(viewport).some((box) => bboxContainsPoint(box, mooring.position)),
      ),
    );
  }

  async function loadMoorings(
    ctx: OverlayContext,
    bbox: ReturnType<typeof padBbox>,
  ): Promise<void> {
    const generation = lifecycle;
    loading = true;
    lastFetchAttemptBbox = bbox;
    report('loading');
    const now = Date.now();
    const viewport = lngLatBoundsToBbox4(ctx.map.getBounds());
    const cached = await cache.find(viewport, now);
    if (!mounted || generation !== lifecycle) return;
    if (cached) {
      fetchBbox = cached.bbox;
      rawMoorings = cached.moorings;
      cachedAtMs = cached.savedAtMs;
      mooringVersion += 1;
      lastRenderKey = '';
      updateRender(ctx, now);
      report('loading');
      if (!isOnline()) {
        loading = false;
        report('ready');
        return;
      }
    }
    if (!isOnline()) {
      loading = false;
      report('error');
      return;
    }
    const result = await fetchMoorings(origin, getToken(), bbox);
    if (!mounted || generation !== lifecycle) return;
    loading = false;
    if (!result) {
      consecutiveFetchFailures += 1;
      nextFetchAt =
        Date.now() +
        Math.min(
          MOORINGS_RETRY_INITIAL_MS * 2 ** (consecutiveFetchFailures - 1),
          MOORINGS_RETRY_MAX_MS,
        );
      report('error');
      return;
    }
    consecutiveFetchFailures = 0;
    nextFetchAt = 0;
    const currentViewport = lngLatBoundsToBbox4(ctx.map.getBounds());
    if (!bboxContains(bbox, currentViewport)) return;
    fetchBbox = bbox;
    rawMoorings = result.moorings;
    cachedAtMs = result.cachedAtMs;
    void cache.put(bbox, rawMoorings, result.cachedAtMs ?? Date.now());
    mooringVersion += 1;
    lastRenderKey = '';
    updateRender(ctx, Date.now());
    report('ready');
  }

  return {
    id: 'moorings',
    title: 'Moorings',
    description:
      'NOAA charted mooring facilities with advisory occupancy clues from onboard and destination AIS.',
    band: 'routes',
    category: 'Reference',
    region: 'US',
    supportsOpacity: true,
    defaultVisible: false,
    layerIds: MOORINGS_LAYERS,
    add(ctx) {
      mounted = true;
      lifecycle += 1;
      addMooringLayers(ctx.map, themePaint, ctx.beforeIdFor('routes'));
      hit.attach(ctx);
    },
    remove(ctx) {
      mounted = false;
      lifecycle += 1;
      hit.detach(ctx);
      removeMooringLayers(ctx.map);
    },
    reset() {
      lifecycle += 1;
      fetchBbox = undefined;
      lastFetchAttemptBbox = undefined;
      rawMoorings = [];
      rendered = [];
      cachedAtMs = undefined;
      mooringVersion += 1;
      loading = false;
      consecutiveFetchFailures = 0;
      nextFetchAt = 0;
      lastLocalScanAt = Number.NEGATIVE_INFINITY;
      lastRenderKey = '';
    },
    sync(ctx) {
      if (!visible) return;
      const zoom = ctx.map.getZoom();
      if (zoom < MOORINGS_MIN_ZOOM) {
        if (rendered.length > 0) clearRendered(ctx);
        report('zoomed-out');
        return;
      }
      const viewport = lngLatBoundsToBbox4(ctx.map.getBounds());
      const now = Date.now();
      const requestBbox = padBbox(viewport);
      const needsMoorings = !fetchBbox || !bboxContains(fetchBbox, viewport);
      if (needsMoorings && now - lastLocalScanAt >= LOCAL_MOORINGS_SCAN_MS) {
        lastLocalScanAt = now;
        const local = localMoorings(ctx, requestBbox);
        if (local.length > 0) {
          fetchBbox = requestBbox;
          rawMoorings = local;
          cachedAtMs = undefined;
          void cache.put(requestBbox, local, now);
          mooringVersion += 1;
          lastRenderKey = '';
          consecutiveFetchFailures = 0;
          nextFetchAt = 0;
          updateRender(ctx, now);
          report('ready');
          return;
        }
      }
      const viewportChangedSinceFailure =
        lastFetchAttemptBbox !== undefined && !bboxContains(lastFetchAttemptBbox, viewport);
      if (!loading && needsMoorings && (now >= nextFetchAt || viewportChangedSinceFailure)) {
        void loadMoorings(ctx, requestBbox);
      } else if (!loading) {
        updateRender(ctx, now);
        if (fetchBbox && bboxContains(fetchBbox, viewport)) report('ready');
      }
    },
    setVisible(ctx, next) {
      visible = next;
      setLayersVisibility(ctx.map, MOORINGS_LAYERS, next);
      if (!next) report('hidden');
      else {
        lastRenderKey = '';
        hit.refreshInteractionState();
      }
    },
    setOpacity(ctx, next) {
      opacity = next;
      if (ctx.map.getLayer(MOORINGS_LAYER_ID)) {
        ctx.map.setPaintProperty(MOORINGS_LAYER_ID, 'circle-opacity', next * 0.9);
      }
      if (ctx.map.getLayer(MOORINGS_LABEL_LAYER_ID)) {
        ctx.map.setPaintProperty(MOORINGS_LABEL_LAYER_ID, 'text-opacity', next);
      }
      hit.refreshInteractionState();
    },
    applyTheme(ctx, paint) {
      themePaint = paint;
      applyMooringTheme(ctx.map, paint);
    },
  };
}
