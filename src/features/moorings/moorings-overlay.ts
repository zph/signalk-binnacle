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
import { assessMoorings, OnboardAisHistory } from './mooring-occupancy';
import { fetchDestinationAis, fetchMoorings } from './moorings-client';
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
  MooringAisTarget,
  MooringPoint,
  MooringViewPhase,
  MooringViewState,
} from './moorings-types';

const AIS_POLL_MS = 5_000;

export interface MooringsOverlay extends OverlayModule, Syncable {}

export interface MooringsOverlayOptions {
  destinationAisAvailable: () => boolean;
  selectedId: () => string | undefined;
  interactionsAllowed?: () => boolean;
  onSelect?: (id: string) => void;
  onMoorings?: (moorings: MooringPoint[]) => void;
  onStatus?: (state: MooringViewState) => void;
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
  let rawMoorings: MooringPoint[] = [];
  let rendered: MooringPoint[] = [];
  let destinationTargets: MooringAisTarget[] = [];
  let destinationAis: DestinationAisState = options.destinationAisAvailable()
    ? 'checking'
    : 'unavailable';
  let lastStatus: MooringViewState | undefined;
  let loading = false;
  let aisLoading = false;
  let lastAisPollAt = 0;
  let lastRenderKey = '';
  let mooringVersion = 0;
  let themePaint = mapThemePaint('day');
  const onboardHistory = new OnboardAisHistory();
  const externalInteractionsAllowed = options.interactionsAllowed ?? (() => true);
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
    if (lastStatus?.phase === phase && lastStatus.destinationAis === destinationAis) return;
    lastStatus = { phase, destinationAis };
    options.onStatus?.(lastStatus);
  }

  function clear(ctx: OverlayContext): void {
    rawMoorings = [];
    rendered = [];
    mooringVersion += 1;
    lastRenderKey = '';
    setSourceData(ctx.map, MOORINGS_SOURCE_ID, emptyFeatureCollection());
    setSourceData(ctx.map, MOORINGS_SELECTED_SOURCE_ID, emptyFeatureCollection());
    options.onMoorings?.([]);
  }

  function updateRender(ctx: OverlayContext, now: number): void {
    const onboard = onboardHistory.observe(aisTargets.list(), now);
    const viewport = lngLatBoundsToBbox4(ctx.map.getBounds());
    const key = [
      mooringVersion,
      options.selectedId() ?? '',
      ...viewport.map((value) => value.toFixed(5)),
      Math.floor(now / 60_000),
      ...onboard.map((target) => `${target.id}:${target.lastReportAtMs}`),
      ...destinationTargets.map((target) => `${target.id}:${target.lastReportAtMs}`),
    ].join('|');
    if (key === lastRenderKey) return;
    lastRenderKey = key;
    rendered = assessMoorings(rawMoorings, onboard, destinationTargets, now);
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
    report('loading');
    const result = await fetchMoorings(origin, getToken(), bbox);
    if (!mounted || generation !== lifecycle) return;
    loading = false;
    if (!result) {
      report('error');
      return;
    }
    fetchBbox = bbox;
    rawMoorings = result;
    mooringVersion += 1;
    lastRenderKey = '';
    updateRender(ctx, Date.now());
    report('ready');
  }

  async function pollDestinationAis(
    ctx: OverlayContext,
    bbox: ReturnType<typeof lngLatBoundsToBbox4>,
    now: number,
  ): Promise<void> {
    if (!options.destinationAisAvailable()) {
      destinationAis = 'unavailable';
      destinationTargets = [];
      report(lastStatus?.phase ?? 'idle');
      return;
    }
    const boxes = splitAtAntimeridian(bbox);
    if (boxes.length !== 1) {
      destinationAis = 'error';
      destinationTargets = [];
      report(lastStatus?.phase ?? 'idle');
      return;
    }
    const generation = lifecycle;
    aisLoading = true;
    const snapshot = await fetchDestinationAis(origin, getToken(), boxes[0]);
    if (!mounted || generation !== lifecycle) return;
    aisLoading = false;
    destinationAis = snapshot.state;
    destinationTargets = snapshot.targets;
    lastRenderKey = '';
    updateRender(ctx, now);
    report(lastStatus?.phase ?? 'idle');
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
      rawMoorings = [];
      rendered = [];
      mooringVersion += 1;
      destinationTargets = [];
      lastRenderKey = '';
    },
    sync(ctx) {
      if (!visible) return;
      const zoom = ctx.map.getZoom();
      if (zoom < MOORINGS_MIN_ZOOM) {
        if (rendered.length > 0) clear(ctx);
        report('zoomed-out');
        return;
      }
      const viewport = lngLatBoundsToBbox4(ctx.map.getBounds());
      const now = Date.now();
      if (!loading && (!fetchBbox || !bboxContains(fetchBbox, viewport))) {
        void loadMoorings(ctx, padBbox(viewport));
      } else if (!loading) {
        updateRender(ctx, now);
        report('ready');
      }
      if (!aisLoading && now - lastAisPollAt >= AIS_POLL_MS) {
        lastAisPollAt = now;
        void pollDestinationAis(ctx, viewport, now);
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
