import type { CircleLayerSpecification, ExpressionSpecification } from 'maplibre-gl';
import { type AisTargets, type AisVesselKind, aisVesselKind } from '$entities/ais';
import { latLonToLonLat } from '$shared/geo';
import { headingDegrees } from '$shared/lib';
import {
  createLayerHitHandlers,
  createSymbolOverlay,
  featureCollection,
  type LayerHitEvent,
  mapThemePaint,
  type OverlayContext,
  overlayInteractive,
  type Rgba,
  removeLayersAndSources,
  type SymbolOverlay,
  setLayersVisibility,
  setMapImage,
} from '$shared/map';
import {
  AIS_ICON_IDS,
  AIS_ICON_KINDS,
  AIS_ICON_PIXEL_RATIO,
  aisVesselIconScale,
  loadAisIconArtwork,
} from './ais-icon';
import { createAisRefreshGate } from './ais-refresh';

const SOURCE_ID = 'binnacle-ais';
export const AIS_OVERLAY_ID = 'ais';
const LAYER_ID = 'binnacle-ais-symbol';
const SELECTED_LAYER_ID = 'binnacle-ais-selected';
const HIT_LAYER_ID = 'binnacle-ais-hit';
// The transient color shown for the single frame before the first recolor; taken from the day theme
// so there is one source for the day AIS color rather than a literal that could drift.
const DEFAULT_COLOR: Rgba = mapThemePaint('day').aisTarget;
const ICON_SCALE: ExpressionSpecification = ['coalesce', ['get', 'iconScale'], 1];
const SELECTED_RADIUS: ExpressionSpecification = ['*', 18, ICON_SCALE];
const HIT_RADIUS: ExpressionSpecification = ['max', 22, ['*', 16, ICON_SCALE]];

// Stale-target expiry lives on an app-level timer (store.pruneAis with the entities/ais TTL), never
// in this render path, which pauses in a hidden tab while the collision math keeps consuming the
// store. The interaction layer resolves every clicked id against that current entity view.
export interface AisOverlayOptions {
  onSelect?: (id: string) => void;
  selectedId?: () => string | undefined;
  kindMode?: () => AisVesselKindMode;
  now?: () => number;
  interactionsAllowed?: () => boolean;
}

export type AisVesselKindMode = 'type-specific' | 'generic';

export function createAisOverlay(
  targets: AisTargets,
  options: AisOverlayOptions = {},
): SymbolOverlay {
  const gate = createAisRefreshGate(targets, options.now ?? Date.now);
  let visible = true;
  let opacity = 1;
  let lastSelectedId = options.selectedId?.();
  let lastKindMode = options.kindMode?.() ?? 'type-specific';
  let artwork: Awaited<ReturnType<typeof loadAisIconArtwork>> | undefined;
  const interactionsAllowed = (): boolean =>
    overlayInteractive(visible, opacity, options.interactionsAllowed);

  function renderIcon(kind: AisVesselKind, color: Rgba): ImageData {
    if (!artwork) throw new Error('AIS icon artwork was not loaded');
    return artwork.aisIconImage(kind, color);
  }

  function buildFeatures(): GeoJSON.FeatureCollection {
    const selectedId = options.selectedId?.();
    const kindMode = options.kindMode?.() ?? 'type-specific';
    return featureCollection(
      targets.list().map((target) => {
        const kind = kindMode === 'generic' ? 'ship' : aisVesselKind(target.shipTypeId);
        return {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: latLonToLonLat(target.position),
          },
          properties: {
            id: target.id,
            name: target.name ?? '',
            heading: headingDegrees(target.headingRad, target.cogRad),
            iconImage: AIS_ICON_IDS[kind],
            iconScale: aisVesselIconScale(target.lengthMeters),
            selected: target.id === selectedId,
          },
        } satisfies GeoJSON.Feature<GeoJSON.Point>;
      }),
    );
  }

  const hit = createLayerHitHandlers(
    HIT_LAYER_ID,
    (event: LayerHitEvent) => {
      for (const feature of event.features ?? []) {
        if (feature.geometry.type !== 'Point') continue;
        const id = feature.properties?.id;
        if (typeof id !== 'string' || !targets.find(id)) continue;
        options.onSelect?.(id);
        return true;
      }
      return false;
    },
    {
      band: 'traffic',
      interactionsAllowed,
    },
  );
  const base = createSymbolOverlay({
    id: AIS_OVERLAY_ID,
    title: 'AIS targets',
    description: 'Other vessels broadcasting their position over AIS.',
    band: 'traffic',
    sourceId: SOURCE_ID,
    layerId: LAYER_ID,
    iconId: AIS_ICON_IDS.ship,
    iconImage: (color) => renderIcon('ship', color),
    pixelRatio: AIS_ICON_PIXEL_RATIO,
    defaultColor: DEFAULT_COLOR,
    paintColor: (paint) => paint.aisTarget,
    features: buildFeatures,
    shouldRefresh: () => {
      const selectedId = options.selectedId?.();
      const selectionChanged = selectedId !== lastSelectedId;
      const kindMode = options.kindMode?.() ?? 'type-specific';
      const kindModeChanged = kindMode !== lastKindMode;
      lastSelectedId = selectedId;
      lastKindMode = kindMode;
      // A selection change rebuilds the same source as an AIS update. Force the shared gate to
      // record that painted target list, or its stale count can throttle the next real count change.
      return gate.shouldRefresh(selectionChanged || kindModeChanged);
    },
  });

  const syncVisibility = (ctx: OverlayContext): void => {
    setLayersVisibility(ctx.map, [SELECTED_LAYER_ID], visible);
    setLayersVisibility(ctx.map, [HIT_LAYER_ID], visible && opacity > 0);
    hit.refreshInteractionState();
  };

  return {
    ...base,
    manageable: true,
    layerIds: [SELECTED_LAYER_ID, LAYER_ID, HIT_LAYER_ID],
    async add(ctx) {
      artwork = await loadAisIconArtwork();
      await base.add(ctx);
      for (const kind of AIS_ICON_KINDS) {
        if (kind === 'ship') continue;
        setMapImage(
          ctx.map,
          AIS_ICON_IDS[kind],
          renderIcon(kind, DEFAULT_COLOR),
          AIS_ICON_PIXEL_RATIO,
        );
      }
      if (ctx.map.getLayer(LAYER_ID)) {
        ctx.map.setLayoutProperty(LAYER_ID, 'icon-image', ['get', 'iconImage']);
        ctx.map.setLayoutProperty(LAYER_ID, 'icon-size', ICON_SCALE);
      }
      const before = ctx.beforeIdFor('traffic');
      if (!ctx.map.getLayer(SELECTED_LAYER_ID)) {
        const selectedLayer: CircleLayerSpecification = {
          id: SELECTED_LAYER_ID,
          type: 'circle',
          source: SOURCE_ID,
          filter: ['==', ['get', 'selected'], true],
          paint: {
            'circle-radius': SELECTED_RADIUS,
            'circle-color': 'rgba(0,0,0,0)',
            'circle-stroke-color': mapThemePaint('day').select,
            'circle-stroke-width': 3,
          },
        };
        ctx.map.addLayer(selectedLayer, LAYER_ID);
      }
      if (!ctx.map.getLayer(HIT_LAYER_ID)) {
        const hitLayer: CircleLayerSpecification = {
          id: HIT_LAYER_ID,
          type: 'circle',
          source: SOURCE_ID,
          paint: {
            'circle-radius': HIT_RADIUS,
            'circle-color': 'rgba(0,0,0,0)',
          },
        };
        ctx.map.addLayer(hitLayer, before);
      }
      hit.attach(ctx);
      syncVisibility(ctx);
    },
    applyTheme(ctx, paint) {
      base.applyTheme?.(ctx, paint);
      for (const kind of AIS_ICON_KINDS) {
        if (kind === 'ship') continue;
        setMapImage(
          ctx.map,
          AIS_ICON_IDS[kind],
          renderIcon(kind, paint.aisTarget),
          AIS_ICON_PIXEL_RATIO,
        );
      }
      if (ctx.map.getLayer(SELECTED_LAYER_ID)) {
        ctx.map.setPaintProperty(SELECTED_LAYER_ID, 'circle-stroke-color', paint.select);
      }
    },
    setVisible(ctx, nextVisible) {
      visible = nextVisible;
      base.setVisible?.(ctx, nextVisible);
      syncVisibility(ctx);
    },
    setOpacity(ctx, nextOpacity) {
      opacity = nextOpacity;
      base.setOpacity?.(ctx, nextOpacity);
      if (ctx.map.getLayer(SELECTED_LAYER_ID)) {
        ctx.map.setPaintProperty(SELECTED_LAYER_ID, 'circle-stroke-opacity', nextOpacity);
      }
      syncVisibility(ctx);
    },
    remove(ctx) {
      hit.detach(ctx);
      removeLayersAndSources(ctx.map, [HIT_LAYER_ID, SELECTED_LAYER_ID], []);
      for (const kind of AIS_ICON_KINDS) {
        if (kind !== 'ship' && ctx.map.hasImage(AIS_ICON_IDS[kind])) {
          ctx.map.removeImage(AIS_ICON_IDS[kind]);
        }
      }
      base.remove(ctx);
    },
  };
}
