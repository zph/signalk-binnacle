import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  GeoJSONSourceSpecification,
  LineLayerSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import { type AisTargets, type AisVesselKind, aisVesselKind } from '$entities/ais';
import type { Assessment, Severity } from '$entities/collision';
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
  rgbaCss,
  type SymbolOverlay,
  setLayersVisibility,
  setMapImage,
  setSourceData,
} from '$shared/map';
import {
  AIS_ICON_IDS,
  AIS_ICON_IMAGE_IDS,
  AIS_ICON_KINDS,
  AIS_ICON_PIXEL_RATIO,
  AIS_ICON_SEVERITIES,
  aisIconId,
  aisVesselIconScale,
  loadAisIconArtwork,
} from './ais-icon';
import { buildAisPositionProjectionFeatures } from './ais-position-projection';
import { createAisRefreshGate } from './ais-refresh';

const SOURCE_ID = 'binnacle-ais';
const PROJECTION_SOURCE_ID = 'binnacle-ais-position-projection';
export const AIS_OVERLAY_ID = 'ais';
const LAYER_ID = 'binnacle-ais-symbol';
const PROJECTION_CONNECTOR_LAYER_ID = 'binnacle-ais-position-projection-connector';
const PROJECTION_GHOST_LAYER_ID = 'binnacle-ais-position-projection-ghost';
const SELECTED_LAYER_ID = 'binnacle-ais-selected';
const HIT_LAYER_ID = 'binnacle-ais-hit';
// The transient color shown for the single frame before the first recolor; taken from the day theme
// so there is one source for the day AIS color rather than a literal that could drift.
const DEFAULT_COLOR: Rgba = mapThemePaint('day').aisTarget;
const ICON_SCALE: ExpressionSpecification = ['coalesce', ['get', 'iconScale'], 1];
const SELECTED_RADIUS: ExpressionSpecification = ['*', 18, ICON_SCALE];
const HIT_RADIUS: ExpressionSpecification = ['max', 22, ['*', 16, ICON_SCALE]];
const PROJECTION_CONFIDENCE: ExpressionSpecification = ['coalesce', ['get', 'confidence'], 0];
const PROJECTION_REFRESH_MS = 1_000;
const PROJECTION_GHOST_OPACITY = 0.3;
const PROJECTION_CONNECTOR_OPACITY = 0.22;

// Stale-target expiry lives on an app-level timer (store.pruneAis with the entities/ais TTL), never
// in this render path, which pauses in a hidden tab while the collision math keeps consuming the
// store. The interaction layer resolves every clicked id against that current entity view.
export interface AisOverlayOptions {
  assessment?: () => Assessment;
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
  const now = options.now ?? Date.now;
  const gate = createAisRefreshGate(targets, now);
  let visible = true;
  let opacity = 1;
  let lastSelectedId = options.selectedId?.();
  let lastKindMode = options.kindMode?.() ?? 'type-specific';
  let lastProjectionKindMode = lastKindMode;
  let lastProjectionVersion = -1;
  let lastProjectionRefreshAt = Number.NEGATIVE_INFINITY;
  let lastContacts: Assessment['contacts'] | undefined;
  const severityById = new Map<string, Severity>();
  let paint = mapThemePaint('day');
  let artwork: Awaited<ReturnType<typeof loadAisIconArtwork>> | undefined;
  const interactionsAllowed = (): boolean =>
    overlayInteractive(visible, opacity, options.interactionsAllowed);

  function renderIcon(kind: AisVesselKind, color: Rgba): ImageData {
    if (!artwork) throw new Error('AIS icon artwork was not loaded');
    return artwork.aisIconImage(kind, color);
  }

  function severityColor(severity: Severity): Rgba {
    if (severity === 'danger') return paint.aisDanger;
    if (severity === 'warning') return paint.aisWarning;
    return paint.aisTarget;
  }

  function refreshSeverities(): boolean {
    const contacts = options.assessment?.().contacts ?? [];
    if (contacts === lastContacts) return false;
    lastContacts = contacts;
    if (
      severityById.size === contacts.length &&
      contacts.every((contact) => severityById.get(contact.id) === contact.severity)
    ) {
      return false;
    }
    severityById.clear();
    for (const contact of contacts) severityById.set(contact.id, contact.severity);
    return true;
  }

  function buildFeatures(): GeoJSON.FeatureCollection {
    refreshSeverities();
    const selectedId = options.selectedId?.();
    const kindMode = options.kindMode?.() ?? 'type-specific';
    return featureCollection(
      targets.list().map((target) => {
        const kind = kindMode === 'generic' ? 'ship' : aisVesselKind(target.shipTypeId);
        const severity = severityById.get(target.id) ?? 'clear';
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
            iconImage: aisIconId(kind, severity),
            iconScale: aisVesselIconScale(target.lengthMeters),
            severity,
            selected: target.id === selectedId,
          },
        } satisfies GeoJSON.Feature<GeoJSON.Point>;
      }),
    );
  }

  function projectionFeatures(ctx: OverlayContext): GeoJSON.FeatureCollection {
    return featureCollection(
      buildAisPositionProjectionFeatures(targets.list(), {
        kindMode: options.kindMode?.() ?? 'type-specific',
        now: now(),
        positionEpochMs: (id) => targets.positionEpochMs(id),
        project: (coordinate) => ctx.map.project(coordinate),
      }),
    );
  }

  function projectionOpacity(maximum: number): ExpressionSpecification {
    return ['*', opacity, maximum, PROJECTION_CONFIDENCE];
  }

  function recordProjectionRefresh(): void {
    lastProjectionVersion = targets.version;
    lastProjectionKindMode = options.kindMode?.() ?? 'type-specific';
    lastProjectionRefreshAt = now();
  }

  function refreshProjection(ctx: OverlayContext): void {
    setSourceData(ctx.map, PROJECTION_SOURCE_ID, projectionFeatures(ctx));
    recordProjectionRefresh();
  }

  function projectionRefreshDue(): boolean {
    const kindMode = options.kindMode?.() ?? 'type-specific';
    return (
      targets.version !== lastProjectionVersion ||
      kindMode !== lastProjectionKindMode ||
      now() - lastProjectionRefreshAt >= PROJECTION_REFRESH_MS
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
    description:
      'Other vessels broadcasting over AIS. Cobalt is clear, amber is warning, and red is danger at the configured CPA and TCPA thresholds. A faint ghost estimates position between fixes.',
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
      const severitiesChanged = refreshSeverities();
      lastSelectedId = selectedId;
      lastKindMode = kindMode;
      // A selection change rebuilds the same source as an AIS update. Force the shared gate to
      // record that painted target list, or its stale count can throttle the next real count change.
      return gate.shouldRefresh(selectionChanged || kindModeChanged || severitiesChanged);
    },
  });

  const syncVisibility = (ctx: OverlayContext): void => {
    setLayersVisibility(
      ctx.map,
      [PROJECTION_CONNECTOR_LAYER_ID, PROJECTION_GHOST_LAYER_ID, SELECTED_LAYER_ID],
      visible,
    );
    setLayersVisibility(ctx.map, [HIT_LAYER_ID], visible && opacity > 0);
    hit.refreshInteractionState();
  };

  return {
    ...base,
    manageable: true,
    layerIds: [
      PROJECTION_CONNECTOR_LAYER_ID,
      PROJECTION_GHOST_LAYER_ID,
      SELECTED_LAYER_ID,
      LAYER_ID,
      HIT_LAYER_ID,
    ],
    async add(ctx) {
      artwork = await loadAisIconArtwork();
      await base.add(ctx);
      for (const kind of AIS_ICON_KINDS) {
        for (const severity of AIS_ICON_SEVERITIES) {
          if (kind === 'ship' && severity === 'clear') continue;
          setMapImage(
            ctx.map,
            aisIconId(kind, severity),
            renderIcon(kind, severityColor(severity)),
            AIS_ICON_PIXEL_RATIO,
          );
        }
      }
      if (!ctx.map.getSource(PROJECTION_SOURCE_ID)) {
        const source: GeoJSONSourceSpecification = {
          type: 'geojson',
          data: projectionFeatures(ctx),
        };
        ctx.map.addSource(PROJECTION_SOURCE_ID, source);
        recordProjectionRefresh();
      }
      if (ctx.map.getLayer(LAYER_ID)) {
        ctx.map.setLayoutProperty(LAYER_ID, 'icon-image', ['get', 'iconImage']);
        ctx.map.setLayoutProperty(LAYER_ID, 'icon-size', ICON_SCALE);
      }
      if (!ctx.map.getLayer(PROJECTION_CONNECTOR_LAYER_ID)) {
        const connectorLayer: LineLayerSpecification = {
          id: PROJECTION_CONNECTOR_LAYER_ID,
          type: 'line',
          source: PROJECTION_SOURCE_ID,
          filter: ['==', ['get', 'projectionPart'], 'connector'],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': rgbaCss(paint.aisTarget),
            'line-width': 1.25,
            'line-opacity': projectionOpacity(PROJECTION_CONNECTOR_OPACITY),
            'line-dasharray': [1, 2],
          },
        };
        ctx.map.addLayer(connectorLayer, LAYER_ID);
      }
      if (!ctx.map.getLayer(PROJECTION_GHOST_LAYER_ID)) {
        const ghostLayer: SymbolLayerSpecification = {
          id: PROJECTION_GHOST_LAYER_ID,
          type: 'symbol',
          source: PROJECTION_SOURCE_ID,
          filter: ['==', ['get', 'projectionPart'], 'ghost'],
          layout: {
            'icon-image': ['get', 'iconImage'],
            'icon-size': ICON_SCALE,
            'icon-rotate': ['get', 'heading'],
            'icon-rotation-alignment': 'map',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          },
          paint: {
            'icon-opacity': projectionOpacity(PROJECTION_GHOST_OPACITY),
          },
        };
        ctx.map.addLayer(ghostLayer, LAYER_ID);
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
    sync(ctx) {
      base.sync(ctx);
      if (visible && projectionRefreshDue()) refreshProjection(ctx);
    },
    applyTheme(ctx, nextPaint) {
      paint = nextPaint;
      base.applyTheme?.(ctx, nextPaint);
      for (const kind of AIS_ICON_KINDS) {
        for (const severity of AIS_ICON_SEVERITIES) {
          if (kind === 'ship' && severity === 'clear') continue;
          setMapImage(
            ctx.map,
            aisIconId(kind, severity),
            renderIcon(kind, severityColor(severity)),
            AIS_ICON_PIXEL_RATIO,
          );
        }
      }
      if (ctx.map.getLayer(PROJECTION_CONNECTOR_LAYER_ID)) {
        ctx.map.setPaintProperty(
          PROJECTION_CONNECTOR_LAYER_ID,
          'line-color',
          rgbaCss(nextPaint.aisTarget),
        );
      }
      if (ctx.map.getLayer(SELECTED_LAYER_ID)) {
        ctx.map.setPaintProperty(SELECTED_LAYER_ID, 'circle-stroke-color', nextPaint.select);
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
      if (ctx.map.getLayer(PROJECTION_CONNECTOR_LAYER_ID)) {
        ctx.map.setPaintProperty(
          PROJECTION_CONNECTOR_LAYER_ID,
          'line-opacity',
          projectionOpacity(PROJECTION_CONNECTOR_OPACITY),
        );
      }
      if (ctx.map.getLayer(PROJECTION_GHOST_LAYER_ID)) {
        ctx.map.setPaintProperty(
          PROJECTION_GHOST_LAYER_ID,
          'icon-opacity',
          projectionOpacity(PROJECTION_GHOST_OPACITY),
        );
      }
      if (ctx.map.getLayer(SELECTED_LAYER_ID)) {
        ctx.map.setPaintProperty(SELECTED_LAYER_ID, 'circle-stroke-opacity', nextOpacity);
      }
      syncVisibility(ctx);
    },
    remove(ctx) {
      hit.detach(ctx);
      removeLayersAndSources(
        ctx.map,
        [HIT_LAYER_ID, SELECTED_LAYER_ID, PROJECTION_GHOST_LAYER_ID, PROJECTION_CONNECTOR_LAYER_ID],
        [PROJECTION_SOURCE_ID],
      );
      for (const imageId of AIS_ICON_IMAGE_IDS) {
        if (imageId !== AIS_ICON_IDS.ship && ctx.map.hasImage(imageId)) {
          ctx.map.removeImage(imageId);
        }
      }
      base.remove(ctx);
    },
  };
}
