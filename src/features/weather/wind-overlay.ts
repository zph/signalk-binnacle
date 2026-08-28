import type {
  CustomLayerInterface,
  LineLayerSpecification,
  Map as MapLibreMap,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import type { WeatherStore } from '$entities/weather';
import { prefersReducedMotion, type SpeedUnit } from '$shared/lib';
import {
  emptyFeatureCollection,
  ensureGeoJsonSource,
  matrixOf,
  type OverlayContext,
  type OverlayModule,
  removeLayersAndSources,
  setLayersVisibility,
  setSourceData,
} from '$shared/map';
import type { Theme } from '$shared/ui';
import { type CanvasFactory, createFieldOverlay } from './field-overlay';
import { WEATHER_LAYER_IDS } from './fills';
import { gridTimeGate } from './grid-time-gate';
import { becameVisible } from './overlay-visibility';
import { windVectorFeatures } from './wind-arrows';
import { windColorTexture } from './wind-color-texture';
import { windFieldTexture } from './wind-field-texture';
import type { GL } from './wind-gl/gl-resources';
import { supportsWindGl } from './wind-gl/wind-gl-support';
import { WindParticles } from './wind-gl/wind-particles';
import { windSpeedFieldRgba } from './wind-speed-field';

const SOURCE_ID = 'binnacle-weather-wind';
const MARKER_SOURCE_ID = 'binnacle-weather-wind-markers';
const CASING_LAYER_ID = 'binnacle-weather-wind-line-casing';
const LAYER_ID = 'binnacle-weather-wind-line';
const MARKER_LAYER_ID = 'binnacle-weather-wind-marker-label';
const GL_LAYER_ID = 'binnacle-weather-wind-particles';
const FIELD_SOURCE_ID = 'binnacle-weather-wind-field';
const FIELD_LAYER_ID = 'binnacle-weather-wind-field-layer';
// Cap both the particle simulation and its map composites at ~25 fps. A custom layer that calls
// triggerRepaint directly from render follows the display refresh rate even when its simulation is
// throttled, which still keeps the GPU and MapLibre worker hot on 60 Hz and 120 Hz displays.
const STEP_MS = 40;

interface WindOverlay extends OverlayModule {
  sync(ctx: OverlayContext): void;
}

function sameMatrix(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// The wind layer: an animated WebGL particle field advected through the forecast u/v, colored by
// speed with fading trails, in the weather band. Off by default. Falls back to a per-cell arrow line
// layer when WebGL is unavailable. Rebuilds the wind texture only when the grid or selected time
// changes; the animation runs in the custom layer's own render loop via triggerRepaint, throttled to
// ~25 fps and paused while the document is hidden, and recovers from a WebGL context loss.
export function createWindOverlay(
  store: WeatherStore,
  makeCanvas?: CanvasFactory,
  getSpeedUnit: () => SpeedUnit = () => 'kn',
): WindOverlay {
  const field = createFieldOverlay(
    store,
    {
      id: WEATHER_LAYER_IDS.wind,
      title: 'Wind',
      description: 'Wind speed and direction across the area.',
      sourceId: FIELD_SOURCE_ID,
      layerId: FIELD_LAYER_ID,
      fieldRgba: windSpeedFieldRgba,
    },
    makeCanvas,
  );
  let theme: Theme = 'day';
  let opacity = 1;
  let visible = false;
  let lastSpeedUnit: SpeedUnit | undefined;
  const gate = gridTimeGate(store);

  // Particle path.
  let particles: WindParticles | undefined;
  // Reused across composite frames so the per-frame dirty check never allocates; hasLastMatrix keeps
  // the first frame from being read as unchanged before the buffer is filled.
  const lastMatrix: number[] = new Array(16).fill(0);
  let hasLastMatrix = false;
  // The render-loop clock for the simulation throttle, and the cleanup for the context-loss listeners
  // (empty until the particle layer is added, run on its removal).
  let lastStep = 0;
  let removeContextListeners = () => {};
  let stopParticleLoop = () => {};
  let resumeParticleLoop = () => {};

  function addArrowLayer(ctx: OverlayContext): void {
    ensureGeoJsonSource(ctx.map, SOURCE_ID);
    ensureGeoJsonSource(ctx.map, MARKER_SOURCE_ID);
    if (!ctx.map.getLayer(CASING_LAYER_ID)) {
      const layer: LineLayerSpecification = {
        id: CASING_LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
          visibility: visible ? 'visible' : 'none',
        },
        paint: { 'line-color': '#263640', 'line-width': 5, 'line-opacity': opacity * 0.9 },
      };
      ctx.map.addLayer(layer, ctx.beforeIdFor('weather'));
    }
    if (!ctx.map.getLayer(LAYER_ID)) {
      const layer: LineLayerSpecification = {
        id: LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
          visibility: visible ? 'visible' : 'none',
        },
        paint: { 'line-color': '#ffffff', 'line-width': 2.5, 'line-opacity': opacity },
      };
      ctx.map.addLayer(layer, ctx.beforeIdFor('weather'));
    }
    if (!ctx.map.getLayer(MARKER_LAYER_ID)) {
      const layer: SymbolLayerSpecification = {
        id: MARKER_LAYER_ID,
        type: 'symbol',
        source: MARKER_SOURCE_ID,
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 12,
          'text-offset': [0, 1.25],
          'text-allow-overlap': true,
          'text-ignore-placement': true,
          visibility: visible ? 'visible' : 'none',
        },
        paint: {
          'text-color': '#263640',
          'text-halo-color': '#ffffff',
          'text-halo-width': 2.5,
          'text-opacity': opacity,
        },
      };
      ctx.map.addLayer(layer, ctx.beforeIdFor('weather'));
    }
  }

  function syncArrows(ctx: OverlayContext, speedUnit: SpeedUnit): void {
    const grid = store.grid;
    const vectors = grid ? windVectorFeatures(grid, store.bracket, speedUnit) : undefined;
    setSourceData(ctx.map, SOURCE_ID, vectors?.arrows ?? emptyFeatureCollection());
    setSourceData(ctx.map, MARKER_SOURCE_ID, vectors?.markers ?? emptyFeatureCollection());
  }

  function pushWind(): void {
    if (!particles) return;
    const grid = store.grid;
    const field = grid ? windFieldTexture(grid, store.bracket) : undefined;
    if (field) particles.setWind(field);
  }

  function addParticleLayer(ctx: OverlayContext): void {
    // The GL context can be lost (GPU reset, tab backgrounding, driver hiccup). preventDefault on the
    // lost event lets the browser restore it, and on restore the particle resources are rebuilt so the
    // field recovers instead of staying dead with stale handles.
    let contextLost = false;
    let repaintTimer: ReturnType<typeof setTimeout> | undefined;
    const canvas = ctx.map.getCanvas();
    const stopRepaintTimer = () => {
      if (repaintTimer === undefined) return;
      clearTimeout(repaintTimer);
      repaintTimer = undefined;
    };
    const scheduleRepaint = (delayMs = STEP_MS) => {
      if (repaintTimer !== undefined || document.hidden || !visible || !particles || contextLost) {
        return;
      }
      repaintTimer = setTimeout(
        () => {
          repaintTimer = undefined;
          if (!document.hidden && visible && particles && !contextLost) ctx.map.triggerRepaint();
        },
        Math.max(0, delayMs),
      );
    };
    stopParticleLoop = stopRepaintTimer;
    resumeParticleLoop = () => scheduleRepaint(0);
    const onLost = (event: Event) => {
      event.preventDefault();
      contextLost = true;
      stopRepaintTimer();
    };
    const onRestored = () => {
      contextLost = false;
      try {
        particles?.reinit();
      } catch (error) {
        // The restored context could not rebuild the particle resources: degrade to arrows.
        console.warn('[wind] particle reinit failed, using arrows', error);
        particles?.dispose();
        particles = undefined;
        addArrowLayer(ctx);
        if (visible) syncArrows(ctx, getSpeedUnit());
      }
      scheduleRepaint(0);
    };
    // render() stops requesting frames while the tab is hidden, and nothing else repaints the map on
    // return, so the particle loop would stay frozen until a pan, zoom, or toggle. Resume it here when
    // the tab becomes visible again.
    const onVisible = () => {
      if (document.hidden) stopRepaintTimer();
      else scheduleRepaint(0);
    };

    const layer: CustomLayerInterface = {
      id: GL_LAYER_ID,
      type: 'custom',
      onAdd(_map: MapLibreMap, gl: GL) {
        canvas.addEventListener('webglcontextlost', onLost as EventListener);
        canvas.addEventListener('webglcontextrestored', onRestored as EventListener);
        document.addEventListener('visibilitychange', onVisible);
        removeContextListeners = () => {
          canvas.removeEventListener('webglcontextlost', onLost as EventListener);
          canvas.removeEventListener('webglcontextrestored', onRestored as EventListener);
          document.removeEventListener('visibilitychange', onVisible);
          removeContextListeners = () => {};
        };
        try {
          particles = new WindParticles(gl);
          particles.setTheme(windColorTexture(theme));
          particles.setOpacity(opacity);
        } catch (error) {
          // A rare secondary failure after the probe passed: degrade to arrows. The empty custom
          // layer stays but renders nothing because `particles` is undefined.
          console.warn('[wind] particle init failed, using arrows', error);
          particles = undefined;
          addArrowLayer(ctx);
        }
      },
      render(gl: GL, args: unknown) {
        if (!particles || !visible || contextLost) return;
        const matrix = matrixOf(args);
        if (matrix.length !== 16) return; // matrixOf already warned about the unrecognized shape
        const moved = !hasLastMatrix || !sameMatrix(matrix, lastMatrix);
        // Copy, never alias: if MapLibre mutates the matrix in place, sameMatrix would compare an
        // array to itself and never see a move. Overwrite the reused buffer instead of allocating.
        for (let i = 0; i < 16; i += 1) lastMatrix[i] = matrix[i];
        hasLastMatrix = true;
        const w = gl.drawingBufferWidth;
        const h = gl.drawingBufferHeight;
        // A pan or zoom must redraw immediately so the trail clears in place; otherwise step the
        // simulation only at the capped rate and re-blit the last trail on the in-between frames.
        const now = performance.now();
        if (moved || now - lastStep >= STEP_MS) {
          lastStep = now;
          particles.render(matrix, w, h, moved);
        } else {
          particles.blit(w, h);
        }
        // A timer requests the next composite only when the next simulation step is due. Calling
        // triggerRepaint here would immediately schedule another display-rate frame and defeat the
        // 25 fps cap even though that frame only re-blits the existing trail.
        scheduleRepaint(Math.max(0, STEP_MS - (performance.now() - lastStep)));
      },
      onRemove() {
        stopRepaintTimer();
        removeContextListeners();
        particles?.dispose();
        particles = undefined;
        stopParticleLoop = () => {};
        resumeParticleLoop = () => {};
      },
    };
    ctx.map.addLayer(layer, ctx.beforeIdFor('weather'));
  }

  return {
    id: WEATHER_LAYER_IDS.wind,
    title: 'Wind',
    description: 'Wind speed and direction across the area.',
    band: 'weather',
    supportsOpacity: true,
    defaultVisible: false,
    // The color field is the base, particles animate over it when supported, and arrows keep
    // direction visible even when the custom WebGL renderer cannot initialize.
    layerIds: [FIELD_LAYER_ID, GL_LAYER_ID, CASING_LAYER_ID, LAYER_ID, MARKER_LAYER_ID],
    add(ctx) {
      void field.add(ctx);
      addArrowLayer(ctx);
    },
    reset() {
      // The manager calls this on a base-style swap; without it the arrow fallback stays blank when
      // the grid object is unchanged, the same hazard radar-overlay guards against.
      gate.reset();
      lastSpeedUnit = undefined;
      field.reset?.();
    },
    sync(ctx) {
      if (!visible) return;
      field.sync(ctx);
      const changed = gate.changed();
      const speedUnit = getSpeedUnit();
      if (!changed && speedUnit === lastSpeedUnit) return;
      if (changed) pushWind(); // a no-op without particles
      syncArrows(ctx, speedUnit);
      lastSpeedUnit = speedUnit;
    },
    remove(ctx) {
      visible = false;
      stopParticleLoop();
      removeLayersAndSources(
        ctx.map,
        [GL_LAYER_ID, MARKER_LAYER_ID, LAYER_ID, CASING_LAYER_ID],
        [MARKER_SOURCE_ID, SOURCE_ID],
      );
      field.remove(ctx);
    },
    setVisible(ctx, value) {
      const justBecameVisible = becameVisible(visible, value);
      visible = value;
      field.setVisible(ctx, value);
      if (value && !ctx.map.getLayer(GL_LAYER_ID)) {
        // The animated particle field is a continuous, self-driving render loop, so reduced motion
        // uses the color surface and static arrows. Evaluate this on first enable so a preference
        // change made while the layer was off is honored without a reload.
        if (supportsWindGl() && !prefersReducedMotion()) addParticleLayer(ctx);
      }
      setLayersVisibility(ctx.map, [CASING_LAYER_ID, LAYER_ID, MARKER_LAYER_ID], value);
      if (justBecameVisible) {
        gate.reset();
        this.sync(ctx);
      }
      // Restart the particle loop when turned on, and cancel its pending wake-up when turned off.
      if (value) resumeParticleLoop();
      else stopParticleLoop();
    },
    setOpacity(ctx, value) {
      opacity = value;
      field.setOpacity?.(ctx, value);
      particles?.setOpacity(value);
      if (ctx.map.getLayer(CASING_LAYER_ID)) {
        ctx.map.setPaintProperty(CASING_LAYER_ID, 'line-opacity', value * 0.9);
      }
      if (ctx.map.getLayer(LAYER_ID)) ctx.map.setPaintProperty(LAYER_ID, 'line-opacity', value);
      if (ctx.map.getLayer(MARKER_LAYER_ID)) {
        ctx.map.setPaintProperty(MARKER_LAYER_ID, 'text-opacity', value);
      }
    },
    applyTheme(ctx, paint) {
      theme = paint.theme;
      field.applyTheme?.(ctx, paint);
      particles?.setTheme(windColorTexture(theme));
      if (ctx.map.getLayer(CASING_LAYER_ID)) {
        ctx.map.setPaintProperty(CASING_LAYER_ID, 'line-color', paint.label);
      }
      if (ctx.map.getLayer(LAYER_ID)) {
        ctx.map.setPaintProperty(LAYER_ID, 'line-color', paint.markerGlyph);
      }
      if (ctx.map.getLayer(MARKER_LAYER_ID)) {
        ctx.map.setPaintProperty(MARKER_LAYER_ID, 'text-color', paint.label);
        ctx.map.setPaintProperty(MARKER_LAYER_ID, 'text-halo-color', paint.background);
      }
    },
  };
}
