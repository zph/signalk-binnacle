import {
  type CircleLayerSpecification,
  type ExpressionSpecification,
  type MapLayerMouseEvent,
  Popup,
  type SymbolLayerSpecification,
} from 'maplibre-gl';
import type { TidesStore } from '$entities/tides';
import type { UnitsStore } from '$entities/units';
import type { WeatherStore } from '$entities/weather';
import {
  createLayerHitHandlers,
  ensureGeoJsonSource,
  mapThemePaint,
  type OverlayContext,
  type OverlayModule,
  overlayInteractive,
  removeLayersAndSources,
  setLayersVisibility,
  setPaintProp,
  setSourceData,
} from '$shared/map';
import {
  type ConditionFeatureProperties,
  type ConditionsView,
  conditionFeatures,
} from './conditions-features';
import { WEATHER_LAYER_IDS } from './fills';
import { gridTimeGate } from './grid-time-gate';
import { becameVisible } from './overlay-visibility';

const SOURCE_ID = 'binnacle-weather-conditions';
const CIRCLE_LAYER_ID = 'binnacle-weather-conditions-circles';
const GLYPH_LAYER_ID = 'binnacle-weather-conditions-glyphs';
const HIT_LAYER_ID = 'binnacle-weather-conditions-hits';
const LAYER_IDS = [CIRCLE_LAYER_ID, GLYPH_LAYER_ID, HIT_LAYER_ID] as const;

interface ConditionsOverlay extends OverlayModule {
  sync(ctx: OverlayContext): void;
}

interface ConditionHit {
  coordinates: [number, number];
  properties: ConditionFeatureProperties;
}

function safeText(value: unknown, maximum = 300): string {
  return typeof value === 'string' ? value.slice(0, maximum) : '';
}

function conditionHit(event: { features?: GeoJSON.Feature[] }): ConditionHit | undefined {
  const feature = event.features?.[0];
  if (feature?.geometry.type !== 'Point') return undefined;
  const [longitude, latitude] = feature.geometry.coordinates;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return undefined;
  const raw = feature.properties;
  if (!raw || typeof raw !== 'object') return undefined;
  const severity = raw.severity;
  if (severity !== 'context' && severity !== 'caution' && severity !== 'hazard') return undefined;
  return {
    coordinates: [longitude, latitude],
    properties: {
      key: safeText(raw.key, 100),
      glyph: safeText(raw.glyph, 4),
      severity,
      title: safeText(raw.title, 100),
      summary: safeText(raw.summary),
      related: safeText(raw.related),
      scope: safeText(raw.scope, 160),
      valid: safeText(raw.valid, 100),
      wind: safeText(raw.wind, 120),
      gust: safeText(raw.gust, 120),
      waves: safeText(raw.waves, 160),
      current: safeText(raw.current, 180),
      tide: safeText(raw.tide, 180),
      source: safeText(raw.source, 160),
    },
  };
}

function appendText(parent: HTMLElement, className: string, text: string): void {
  if (!text) return;
  const element = document.createElement('p');
  element.className = className;
  element.textContent = text;
  parent.append(element);
}

function appendReading(parent: HTMLElement, label: string, value: string): void {
  if (!value) return;
  const row = document.createElement('div');
  row.className = 'conditions-popup__reading';
  const term = document.createElement('span');
  term.className = 'conditions-popup__label';
  term.textContent = label;
  const reading = document.createElement('span');
  reading.className = 'conditions-popup__value';
  reading.textContent = value;
  row.append(term, reading);
  parent.append(row);
}

function popupContent(properties: ConditionFeatureProperties): HTMLElement {
  const root = document.createElement('section');
  root.className = `conditions-popup conditions-popup--${properties.severity}`;
  root.setAttribute('aria-label', `${properties.title} marine condition`);
  const heading = document.createElement('h3');
  heading.className = 'conditions-popup__title';
  heading.textContent = properties.title;
  root.append(heading);
  appendText(root, 'conditions-popup__summary', properties.summary);
  if (properties.related) {
    appendText(root, 'conditions-popup__related', `Also indicated: ${properties.related}.`);
  }
  const readings = document.createElement('div');
  readings.className = 'conditions-popup__readings';
  appendReading(readings, 'Wind', properties.wind);
  appendReading(readings, 'Gust', properties.gust);
  appendReading(readings, 'Waves', properties.waves);
  appendReading(readings, 'Current', properties.current);
  appendReading(readings, 'Tide', properties.tide);
  root.append(readings);
  appendText(root, 'conditions-popup__meta', `${properties.scope} · ${properties.valid}`);
  appendText(root, 'conditions-popup__meta', properties.source);
  appendText(
    root,
    'conditions-popup__advisory',
    'Advisory model interpretation. Check local observations and official forecasts.',
  );
  return root;
}

function viewFor(ctx: OverlayContext): ConditionsView {
  const bounds = ctx.map.getBounds();
  const rect = ctx.map.getCanvas().getBoundingClientRect();
  return {
    west: bounds.getWest(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    north: bounds.getNorth(),
    width: rect.width,
    height: rect.height,
  };
}

function viewKey(view: ConditionsView): string {
  return `${view.west.toFixed(4)},${view.south.toFixed(4)},${view.east.toFixed(4)},${view.north.toFixed(4)},${view.width ?? 0},${view.height ?? 0}`;
}

export function createConditionsOverlay(
  store: WeatherStore,
  tides: TidesStore,
  units: UnitsStore,
  interactionsAllowed?: () => boolean,
): ConditionsOverlay {
  let visible = false;
  let opacity = 1;
  let lastViewKey: string | undefined;
  let lastTide: unknown;
  let lastCurrent: unknown;
  let lastSpeedUnit: unknown;
  let lastUnitsMode: unknown;
  let hoverKey = '';
  let hoverPopup: Popup | undefined;
  let tapPopup: Popup | undefined;
  let zoomListener: (() => void) | undefined;
  const gate = gridTimeGate(store);
  const canInteract = () => overlayInteractive(visible, opacity, interactionsAllowed);

  const showHover = (ctx: OverlayContext, hit: ConditionHit): void => {
    if (hoverKey === hit.properties.key) return;
    hoverKey = hit.properties.key;
    hoverPopup?.remove();
    hoverPopup = new Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 18,
      maxWidth: '22rem',
    })
      .setLngLat(hit.coordinates)
      .setDOMContent(popupContent(hit.properties))
      .addTo(ctx.map);
  };
  const clearHover = (): void => {
    hoverKey = '';
    hoverPopup?.remove();
    hoverPopup = undefined;
  };
  const showTap = (ctx: OverlayContext, hit: ConditionHit): void => {
    clearHover();
    tapPopup?.remove();
    tapPopup = new Popup({ closeButton: true, closeOnClick: true, offset: 18, maxWidth: '22rem' })
      .setLngLat(hit.coordinates)
      .setDOMContent(popupContent(hit.properties))
      .addTo(ctx.map);
  };

  const hitHandlers = createLayerHitHandlers(
    HIT_LAYER_ID,
    (event) => {
      const hit = conditionHit(event as unknown as { features?: GeoJSON.Feature[] });
      if (!hit || !attachedContext) return false;
      showTap(attachedContext, hit);
      return true;
    },
    { band: 'weather', interactionsAllowed: canInteract },
  );
  let attachedContext: OverlayContext | undefined;
  const onHover = (event: MapLayerMouseEvent): void => {
    if (!attachedContext || !canInteract()) return;
    const hit = conditionHit(event as unknown as { features?: GeoJSON.Feature[] });
    if (hit) showHover(attachedContext, hit);
  };
  const onLeave = (): void => clearHover();

  function severityColors(): ExpressionSpecification {
    const paint = mapThemePaint('day');
    return [
      'match',
      ['get', 'severity'],
      'hazard',
      paint.danger,
      'caution',
      paint.warning,
      paint.tide,
    ];
  }

  function syncFeatures(ctx: OverlayContext, view: ConditionsView): void {
    setSourceData(
      ctx.map,
      SOURCE_ID,
      conditionFeatures(
        store.grid,
        store.bracket,
        view,
        tides,
        store.selectedTime,
        units.speedUnit,
        units.mode,
      ),
    );
  }

  return {
    id: WEATHER_LAYER_IDS.conditions,
    title: 'Conditions',
    description:
      'Advisory icons combine waves, currents, wind, gusts, and station tide timing at the selected forecast time.',
    band: 'weather',
    supportsOpacity: true,
    defaultVisible: false,
    layerIds: LAYER_IDS,
    add(ctx) {
      attachedContext = ctx;
      ensureGeoJsonSource(ctx.map, SOURCE_ID);
      const before = ctx.beforeIdFor('weather');
      const colors = severityColors();
      const circle: CircleLayerSpecification = {
        id: CIRCLE_LAYER_ID,
        type: 'circle',
        source: SOURCE_ID,
        paint: {
          'circle-radius': 14,
          'circle-color': colors,
          'circle-stroke-color': mapThemePaint('day').background,
          'circle-stroke-width': 2,
        },
      };
      if (!ctx.map.getLayer(CIRCLE_LAYER_ID)) ctx.map.addLayer(circle, before);
      const glyph: SymbolLayerSpecification = {
        id: GLYPH_LAYER_ID,
        type: 'symbol',
        source: SOURCE_ID,
        layout: {
          'text-field': ['get', 'glyph'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 15,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: { 'text-color': mapThemePaint('day').markerGlyph },
      };
      if (!ctx.map.getLayer(GLYPH_LAYER_ID)) ctx.map.addLayer(glyph, before);
      const hitLayer: CircleLayerSpecification = {
        id: HIT_LAYER_ID,
        type: 'circle',
        source: SOURCE_ID,
        paint: { 'circle-radius': 22, 'circle-color': 'rgba(0,0,0,0.01)' },
      };
      if (!ctx.map.getLayer(HIT_LAYER_ID)) ctx.map.addLayer(hitLayer, before);
      hitHandlers.attach(ctx);
      ctx.map.on('mousemove', HIT_LAYER_ID, onHover);
      ctx.map.on('mouseleave', HIT_LAYER_ID, onLeave);
      zoomListener = () => {
        if (!visible) return;
        const view = viewFor(ctx);
        syncFeatures(ctx, view);
        lastViewKey = viewKey(view);
      };
      ctx.map.on('zoomend', zoomListener);
      setLayersVisibility(ctx.map, LAYER_IDS, visible);
    },
    reset() {
      gate.reset();
      lastViewKey = undefined;
      lastTide = undefined;
      lastCurrent = undefined;
      lastSpeedUnit = undefined;
      lastUnitsMode = undefined;
    },
    sync(ctx) {
      if (!visible) return;
      const view = viewFor(ctx);
      const nextViewKey = viewKey(view);
      if (
        !gate.changed() &&
        lastTide === tides.tide &&
        lastCurrent === tides.current &&
        lastSpeedUnit === units.speedUnit &&
        lastUnitsMode === units.mode &&
        lastViewKey === nextViewKey
      ) {
        return;
      }
      syncFeatures(ctx, view);
      lastTide = tides.tide;
      lastCurrent = tides.current;
      lastSpeedUnit = units.speedUnit;
      lastUnitsMode = units.mode;
      lastViewKey = nextViewKey;
      clearHover();
    },
    remove(ctx) {
      visible = false;
      clearHover();
      tapPopup?.remove();
      tapPopup = undefined;
      hitHandlers.detach(ctx);
      ctx.map.off('mousemove', HIT_LAYER_ID, onHover);
      ctx.map.off('mouseleave', HIT_LAYER_ID, onLeave);
      if (zoomListener) ctx.map.off('zoomend', zoomListener);
      zoomListener = undefined;
      attachedContext = undefined;
      removeLayersAndSources(ctx.map, LAYER_IDS, [SOURCE_ID]);
    },
    setVisible(ctx, value) {
      const justBecameVisible = becameVisible(visible, value);
      visible = value;
      setLayersVisibility(ctx.map, LAYER_IDS, value);
      hitHandlers.refreshInteractionState();
      if (!value) {
        clearHover();
        tapPopup?.remove();
        tapPopup = undefined;
      }
      if (justBecameVisible) {
        gate.reset();
        lastViewKey = undefined;
        this.sync(ctx);
      }
    },
    setOpacity(ctx, value) {
      opacity = value;
      setPaintProp(ctx.map, CIRCLE_LAYER_ID, 'circle-opacity', value);
      setPaintProp(ctx.map, CIRCLE_LAYER_ID, 'circle-stroke-opacity', value);
      setPaintProp(ctx.map, GLYPH_LAYER_ID, 'text-opacity', value);
      setLayersVisibility(ctx.map, [HIT_LAYER_ID], visible && value > 0);
      hitHandlers.refreshInteractionState();
      if (value <= 0) clearHover();
    },
    applyTheme(ctx, paint) {
      const colors: ExpressionSpecification = [
        'match',
        ['get', 'severity'],
        'hazard',
        paint.danger,
        'caution',
        paint.warning,
        paint.tide,
      ];
      setPaintProp(ctx.map, CIRCLE_LAYER_ID, 'circle-color', colors);
      setPaintProp(ctx.map, CIRCLE_LAYER_ID, 'circle-stroke-color', paint.background);
      setPaintProp(ctx.map, GLYPH_LAYER_ID, 'text-color', paint.markerGlyph);
    },
  };
}
