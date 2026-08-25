import type { ExpressionSpecification, LineLayerSpecification } from 'maplibre-gl';

import type { AisTargets, AisTargetView } from '$entities/ais';
import type { Assessment, Severity } from '$entities/collision';
import { latLonToLonLat } from '$shared/geo';
import {
  antimeridianLineGeometry,
  ensureGeoJsonSource,
  featureCollection,
  type MapThemePaint,
  mapThemePaint,
  type OverlayContext,
  type OverlayModule,
  removeLayersAndSources,
  rgbaCss,
  setLayersVisibility,
  setSourceData,
  severityMatchExpression,
} from '$shared/map';
import { geodesicDestination } from '$shared/nav';
import { AisMotionEstimator, type AisMotionSelection } from './ais-motion-estimator';
import { createAisRefreshGate } from './ais-refresh';

const SOURCE_ID = 'binnacle-ais-vectors';
const LAYER_ID = 'binnacle-ais-vectors-line';
const REPORTED_LAYER_ID = 'binnacle-ais-vectors-reported-line';
const BAND = 'traffic';

// Project each target 10 minutes along its COG at its SOG.
const VECTOR_MINUTES = 10;
const VECTOR_SECONDS = VECTOR_MINUTES * 60;
// GPS scatter on a stationary vessel can produce a small apparent SOG. Targets below this
// threshold (about 0.5 kt) are treated as stationary and show no vector.
const MIN_SOG_MPS = 0.25;

const VECTOR_OPACITY = 0.8;
const VECTOR_WIDTH = 2;
const REPORTED_VECTOR_OPACITY = 0.5;
const REPORTED_VECTOR_WIDTH = 1.5;

function lineColor(paint: MapThemePaint): ExpressionSpecification {
  return severityMatchExpression(paint.danger, paint.warning, rgbaCss(paint.aisTarget));
}

export function buildFeatures(
  targets: AisTargetView[],
  severityById: Map<string, Severity>,
  motionById?: ReadonlyMap<string, AisMotionSelection>,
): GeoJSON.Feature[] {
  const features: GeoJSON.Feature[] = [];
  for (const target of targets) {
    const selection = motionById?.get(target.id);
    const primary =
      selection?.primary ??
      (target.cogRad !== undefined && target.sogMps !== undefined
        ? { cogRad: target.cogRad, sogMps: target.sogMps }
        : undefined);
    const severity = severityById.get(target.id) ?? 'clear';
    if (primary && primary.sogMps >= MIN_SOG_MPS) {
      features.push(
        vectorFeature(target, primary, severity, 'primary', selection?.basis ?? 'reported'),
      );
    }
    const reported = selection?.reportedComparison;
    if (reported && reported.sogMps >= MIN_SOG_MPS) {
      features.push(vectorFeature(target, reported, severity, 'reported-comparison', 'reported'));
    }
  }
  return features;
}

function vectorFeature(
  target: AisTargetView,
  motion: { cogRad: number; sogMps: number },
  severity: Severity,
  lineStyle: 'primary' | 'reported-comparison',
  motionBasis: 'reported' | 'observed',
): GeoJSON.Feature {
  const distanceMeters = motion.sogMps * VECTOR_SECONDS;
  const origin: [number, number] = latLonToLonLat(target.position);
  const tip = geodesicDestination(
    target.position.latitude,
    target.position.longitude,
    motion.cogRad,
    distanceMeters,
  );
  return {
    type: 'Feature',
    geometry: antimeridianLineGeometry([origin, tip]),
    properties: { severity, lineStyle, motionBasis },
  };
}

export interface AisVectorsOverlay extends OverlayModule {
  sync(ctx: OverlayContext): void;
}

export type AisMotionUpdate = (motionById: ReadonlyMap<string, AisMotionSelection>) => void;

// True when the contacts carry a different id-to-severity mapping than the map holds. Assessment
// recomputes mint a fresh contacts array on every AIS flush while any contact is active, so the
// repaint-now decision must compare the rendered content, not the array identity.
function severitiesDiffer(
  severityById: ReadonlyMap<string, Severity>,
  contacts: Assessment['contacts'],
): boolean {
  if (severityById.size !== contacts.length) return true;
  for (const contact of contacts) {
    if (severityById.get(contact.id) !== contact.severity) return true;
  }
  return false;
}

export function createAisVectorsOverlay(
  targets: AisTargets,
  assessment: () => Assessment,
  now: () => number = Date.now,
  onMotionUpdate?: AisMotionUpdate,
): AisVectorsOverlay {
  let paint = mapThemePaint('day');
  let visible = true;
  const gate = createAisRefreshGate(targets, now);
  const motionEstimator = new AisMotionEstimator();
  let lastContacts: Assessment['contacts'] | undefined;
  const severityById = new Map<string, Severity>();

  return {
    id: 'ais-vectors',
    title: 'AIS course vectors',
    description:
      'Solid line uses reported COG and SOG until repeated positions support differing observed motion. A dashed line retains the report.',
    band: BAND,
    supportsOpacity: true,
    layerIds: [REPORTED_LAYER_ID, LAYER_ID],
    add(ctx) {
      gate.reset();
      motionEstimator.reset();
      onMotionUpdate?.(new Map());
      lastContacts = undefined;
      severityById.clear();
      ensureGeoJsonSource(ctx.map, SOURCE_ID);
      if (!ctx.map.getLayer(REPORTED_LAYER_ID)) {
        const reportedLayer: LineLayerSpecification = {
          id: REPORTED_LAYER_ID,
          type: 'line',
          source: SOURCE_ID,
          filter: ['==', ['get', 'lineStyle'], 'reported-comparison'],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': lineColor(paint),
            'line-width': REPORTED_VECTOR_WIDTH,
            'line-opacity': REPORTED_VECTOR_OPACITY,
            'line-dasharray': [2, 2],
          },
        };
        ctx.map.addLayer(reportedLayer, ctx.beforeIdFor(BAND));
      }
      if (!ctx.map.getLayer(LAYER_ID)) {
        const layer: LineLayerSpecification = {
          id: LAYER_ID,
          type: 'line',
          source: SOURCE_ID,
          filter: ['==', ['get', 'lineStyle'], 'primary'],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': lineColor(paint),
            'line-width': VECTOR_WIDTH,
            'line-opacity': VECTOR_OPACITY,
          },
        };
        ctx.map.addLayer(layer, ctx.beforeIdFor(BAND));
      }
    },
    sync(ctx) {
      const contacts = assessment().contacts;
      let severitiesChanged = false;
      if (contacts !== lastContacts) {
        lastContacts = contacts;
        if (severitiesDiffer(severityById, contacts)) {
          severitiesChanged = true;
          severityById.clear();
          for (const contact of contacts) severityById.set(contact.id, contact.severity);
        }
      }
      if (!gate.shouldRefresh(severitiesChanged)) return;
      const targetList = targets.list();
      const motionById = motionEstimator.update(targetList, now());
      onMotionUpdate?.(motionById);
      // A hidden vector layer still maintains the estimator for the AIS detail panel, but avoids
      // rebuilding GeoJSON or touching MapLibre until it becomes visible again.
      if (!visible) return;
      setSourceData(
        ctx.map,
        SOURCE_ID,
        featureCollection(buildFeatures(targetList, severityById, motionById)),
      );
    },
    // Guarded on getLayer: a theme or opacity change can land before add() attaches the layer, and
    // setPaintProperty throws on a missing one. The LayerManager re-applies both once add() resolves.
    applyTheme(ctx, next) {
      paint = next;
      if (ctx.map.getLayer(LAYER_ID)) {
        ctx.map.setPaintProperty(LAYER_ID, 'line-color', lineColor(paint));
      }
      if (ctx.map.getLayer(REPORTED_LAYER_ID)) {
        ctx.map.setPaintProperty(REPORTED_LAYER_ID, 'line-color', lineColor(paint));
      }
    },
    setVisible(ctx, isVisible) {
      visible = isVisible;
      setLayersVisibility(ctx.map, [REPORTED_LAYER_ID, LAYER_ID], isVisible);
    },
    setOpacity(ctx, opacity) {
      if (ctx.map.getLayer(LAYER_ID)) {
        ctx.map.setPaintProperty(LAYER_ID, 'line-opacity', opacity * VECTOR_OPACITY);
      }
      if (ctx.map.getLayer(REPORTED_LAYER_ID)) {
        ctx.map.setPaintProperty(
          REPORTED_LAYER_ID,
          'line-opacity',
          opacity * REPORTED_VECTOR_OPACITY,
        );
      }
    },
    remove(ctx) {
      onMotionUpdate?.(new Map());
      removeLayersAndSources(ctx.map, [LAYER_ID, REPORTED_LAYER_ID], [SOURCE_ID]);
    },
  };
}
