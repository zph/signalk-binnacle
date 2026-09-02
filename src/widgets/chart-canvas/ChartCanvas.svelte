<script lang="ts">
import type { Map as MapLibreMap } from 'maplibre-gl';
import { onDestroy, onMount, untrack } from 'svelte';
import type { AisTargets } from '$entities/ais';
import type { AnchorWatch } from '$entities/anchor';
import type { CollisionAssessment } from '$entities/collision';
import type { CourseGuidance } from '$entities/course';
import type { MeasureStore } from '$entities/measure';
import type { MobStore } from '$entities/mob';
import type { PersonalNotesStore } from '$entities/poi';
import type { RouteStore } from '$entities/route';
import type { SymbolsStore } from '$entities/symbols';
import type { TidesStore } from '$entities/tides';
import type { SavedTracksSource, TrackRecorder } from '$entities/track';
import type { UnitsStore } from '$entities/units';
import type { UserCharts } from '$entities/user-charts';
import type { OwnVessel } from '$entities/vessel';
import type { WaypointsStore } from '$entities/waypoint';
import { boundsToBbox, type WeatherStore } from '$entities/weather';
import type { AisMotionUpdate, AisVesselKindMode } from '$features/ais-layer';
import { fetchCharts } from '$features/charts';
import { LayersView } from '$features/layers-panel';
import { COLLISION_OVERLAY_ID } from '$features/lookout';
import type { PpiLayer } from '$features/marine-radar';
import { MEASURE_OVERLAY_ID, type MeasureOverlay } from '$features/measure';
import { MOB_OVERLAY_ID } from '$features/mob';
import {
  createNotesOverlay,
  type NotePoint,
  type NoteSelection,
  type PoiViewState,
} from '$features/notes';
import type { RouteEditor } from '$features/route-edit';
import { createWorkingRouteOverlay, type WorkingRouteOverlay } from '$features/route-layer';
import type { TideStationSelectionEvent } from '$features/tides';
import type { TimeTravelController } from '$features/time-travel';
import { OWN_VESSEL_OVERLAY_ID } from '$features/vessel-layer';
import {
  CHART_FORECAST_LAYER_IDS,
  createChartWindController,
  type WeatherLoader,
} from '$features/weather';
import type { LatLon } from '$shared/geo';
import { createRetryableLazyUiLoader } from '$shared/lib';
import {
  activeLayerHitCursor,
  type ChartFeatureSelection,
  CONTEXT_MENU_KEYSHORTCUTS,
  chartSourceId,
  createChartOverlay,
  createMapTapRecognizer,
  createThemedMap,
  detectCompanion,
  type LayerSettings,
  type MapTapEvent,
  type ThemedMapHandle,
} from '$shared/map';
import { binnacleStorageKey } from '$shared/persistence';
import {
  DEFAULT_THRESHOLDS,
  type MapRenderingQuality,
  type MapView,
  mapRenderingPixelRatio,
  type PersistedValue,
  type Thresholds,
  type TrackSettings,
  type WeatherSourceId,
} from '$shared/settings';
import type { HistoryProviders, SignalKStore } from '$shared/signalk';
import type { Theme } from '$shared/ui';
import { buildMapCommands } from './build-commands';
import { buildDynamicOverlays } from './build-overlays';
import { buildReferenceOverlays } from './build-reference-overlays';
import type { MapCommands, UserChartRegistrar } from './commands';
import { CRITICAL_OVERLAY_IDS } from './critical-overlays';
import VesselOffScreenIndicator from './VesselOffScreenIndicator.svelte';

const loadRouteEditorModule = createRetryableLazyUiLoader(() => import('$features/route-edit'));
const loadChartFeatureInfo = createRetryableLazyUiLoader(
  () => import('$features/chart-feature-info'),
);

interface Props {
  store: SignalKStore;
  // The Signal K server origin, resolved once by the host and passed down rather than re-read from
  // window.location here, so the widget stays testable without a real location.
  origin: string;
  vessel: OwnVessel;
  aisTargets: AisTargets;
  selectedAisId?: string;
  onAisSelect?: (id: string) => void;
  aisKindMode?: () => AisVesselKindMode;
  onAisMotionUpdate?: AisMotionUpdate;
  // A waypoint marker tapped on the chart, by resource id.
  onWaypointSelect?: (id: string) => void;
  // The anchor watch, drawn as the swing circle, rode line, and draggable drop-point marker.
  anchor: AnchorWatch;
  // The man-overboard mark, pinned with the collision ring so nothing can hide it.
  mob: MobStore;
  // The measure tool; while armed, chart taps append measurement points.
  measure: MeasureStore;
  collision: CollisionAssessment;
  // Active-navigation guidance, drawn as the vessel-to-destination course line and destination
  // marker so a single-point "go to here" and an active route's current leg show on the chart.
  guidance: CourseGuidance;
  recorder: TrackRecorder;
  // The route store, drawn by the route overlay and edited on the chart via Terra Draw.
  routeStore: RouteStore;
  // The tides store, drawn as nearest-station markers and fed by the tides loader in App.
  tides: TidesStore;
  // The app-wide weather store and loader feed the optional wind field on this primary chart.
  weather: WeatherStore;
  weatherLoader: WeatherLoader;
  weatherSource: PersistedValue<WeatherSourceId>;
  // The display-unit preference, threaded into the overlays that label distances and heights.
  units: UnitsStore;
  // The configured shallow-water limit also serves as the ENC safety depth.
  thresholds: PersistedValue<Thresholds>;
  // Standard server waypoints, drawn as named markers in the routes band.
  waypoints: WaypointsStore;
  // Provided chart symbols (signalk-symbol-manager), empty on a stock server.
  symbols?: SymbolsStore;
  // The active theme, so the on-chart route editor restyles its draw layers per theme.
  theme: Theme;
  trackSettings: PersistedValue<TrackSettings>;
  tripLog: import('$features/tracks').TripLogController;
  // Saved tracks to draw, pulled each frame so show/hide and edits reflect without a remount.
  savedTracks?: SavedTracksSource;
  // The user's imported charts, so a server chart that is also a local user chart (a URL chart this
  // device synced to the server) is registered once, from the local descriptor, not twice.
  userCharts?: UserCharts;
  // The Chart Locker tile base, resolved by the app against real credentials and read as a getter
  // so the raster overlays route through the boat's shared cache. The mount-time probe below runs
  // before auth resolves, so its answer alone would strand a secured install on direct upstream
  // URLs for the whole session, which is the offline goal quietly lost.
  companionTiles?: () => string | null;
  chartsToken?: string;
  // The view to open at, restored from the last visit; defaults to a world view.
  initialView?: MapView;
  // Saved per-layer visibility and opacity, and a sink for changes to persist.
  savedLayers?: LayerSettings;
  mapRenderingQuality: PersistedValue<MapRenderingQuality>;
  onLayersChange?: (settings: LayerSettings) => void;
  // Saved bottom-to-top order of non-pinned layers, and a sink for reorder changes.
  savedOrder?: string[];
  onOrderChange?: (order: string[]) => void;
  onReady?: (view: LayersView) => void;
  onMapReady?: (recolor: (theme: Theme) => void) => void;
  onCommandsReady?: (commands: MapCommands) => void;
  onUserChartsReady?: (registrar: UserChartRegistrar) => void;
  onServerChartsReady?: (retry: () => void) => void;
  onServerChartsStatus?: (status: 'loading' | 'ready' | 'partial' | 'error') => void;
  onWindRetryReady?: (retry: (() => void) | undefined) => void;
  // Critical navigation overlays failed to mount. The host surfaces this instead of leaving a
  // navigator with an apparently healthy chart that is missing the vessel or a safety mark.
  onCriticalOverlayError?: (overlayIds: string[]) => void;
  onViewChange?: (view: MapView) => void;
  onNoteSelect?: (selection: NoteSelection | undefined) => void;
  // Confirmed personal-note writes merged over the provider snapshot until refresh catches up.
  personalNotes: PersonalNotesStore;
  onTideStationSelect?: (selection: TideStationSelectionEvent) => void;
  // The on-screen POI set, forwarded from the notes overlay to the POI search.
  onNotes?: (notes: NotePoint[]) => void;
  onPoiStatus?: (state: PoiViewState) => void;
  // Fired when the user pans the map by hand (a drag), so a follow lock can release.
  onUserPan?: () => void;
  // Set a single "go to here" destination at a chart point the user long-pressed or right-clicked.
  onGoToHere?: (position: LatLon) => void;
  // The radial supermenu replaces the rectangular context menu when the shell provides it.
  onQuickActions?: (position: {
    x: number;
    y: number;
    latitude: number;
    longitude: number;
  }) => void;
  // The lazily-imported route editor chunk failed to load, so the app can surface it.
  onRouteEditorError?: () => void;
  // Whether the server runs the tracks plugin, read per tick so trails light up when known.
  aisTrailsAvailable?: () => boolean;
  // Connectivity, so the notes overlay can serve expired cached POIs while offline instead of
  // blanking them at TTL expiry.
  isOnline?: () => boolean;
  // The known history providers, for the 24 h track history overlay; undefined gates its fetches.
  historyProviders?: () => HistoryProviders | undefined;
  // The time-travel controller drives its own synchronized track and marker. Dynamic overlays read
  // its active state to dim the live vessel and hide the separate 24-hour history layer transiently.
  timeTravel: TimeTravelController;
  // Commit a drag-to-adjust of the anchor marker (the app PUTs it server-side or moves it locally).
  onAnchorMoved?: (position: LatLon) => void;
  // The marine radar echo layer, built by its controller in the host and woven into the overlay stack.
  marineRadarLayer?: PpiLayer;
  // The raw MapLibre map instance, handed up once after load for features that need direct map access
  // (for example, a Terra Draw tool that is not part of the route editor).
  onMapInstance?: (map: MapLibreMap) => void;
  // Fired when the map handle is destroyed, so the host can clear any reference it holds (for
  // example, clearing mapInstance so the regions panel never mounts Terra Draw against a stale map).
  onMapDestroyed?: () => void;
}

const {
  store,
  origin,
  vessel,
  aisTargets,
  selectedAisId,
  onAisSelect,
  aisKindMode,
  onAisMotionUpdate,
  onWaypointSelect,
  anchor,
  mob,
  measure,
  units,
  thresholds,
  waypoints,
  symbols,
  collision,
  guidance,
  recorder,
  routeStore,
  tides,
  weather,
  weatherLoader,
  weatherSource,
  theme,
  trackSettings,
  tripLog,
  savedTracks,
  userCharts,
  companionTiles,
  chartsToken,
  initialView,
  savedLayers,
  mapRenderingQuality,
  onLayersChange,
  savedOrder,
  onOrderChange,
  onReady,
  onMapReady,
  onCommandsReady,
  onUserChartsReady,
  onServerChartsReady,
  onServerChartsStatus,
  onWindRetryReady,
  onCriticalOverlayError,
  onViewChange,
  onNoteSelect,
  onTideStationSelect,
  onNotes,
  onPoiStatus,
  onUserPan,
  onGoToHere,
  onQuickActions,
  onRouteEditorError,
  aisTrailsAvailable,
  isOnline,
  historyProviders,
  timeTravel,
  onAnchorMoved,
  marineRadarLayer,
  onMapInstance,
  onMapDestroyed,
  personalNotes,
}: Props = $props();

let container: HTMLDivElement;
let mapHandle: ThemedMapHandle | undefined;
// True from mount until the companion probe and map construction settle, so the surface says
// "Loading chart" instead of sitting blank through the bounded Chart Locker probe. The
// cannot-start notice (WebGL2, style failure) replaces it on the failure paths.
let chartBooting = $state(true);

// One emitter keeps all server-chart load paths consistent for the host status surface.
function emitChartsStatus(status: 'loading' | 'ready' | 'partial' | 'error'): void {
  onServerChartsStatus?.(status);
}
// onMount now awaits companion detection before building the map; this guards against the component
// unmounting during that await, which would otherwise build a map onDestroy never tears down.
let destroyed = false;
let routeEditor: RouteEditor | undefined;
// Stays true through MapLibre dispatch and the shared queued marker-hit routing for a radar placement
// tap. The general map listener runs before layer delegates, and the final or failed placement tap
// may stop editing immediately, so the live chartEditing flag alone cannot gate those later hits.
let radarPlacementDispatch = false;
// Measure, route editing, and radar placement each own chart taps. One shared live predicate gates
// marker, label, and cluster delegates so a single gesture cannot also select another chart feature.
const markerInteractionsAllowed = (): boolean =>
  !measure.active &&
  !routeStore.working &&
  !radarPlacementDispatch &&
  !marineRadarLayer?.chartEditing();
const selectChartFeature = (selection: ChartFeatureSelection): void => {
  if (!markerInteractionsAllowed()) return;
  if (
    selection.properties.BATHY_DEPTH_M !== undefined &&
    selection.properties.BATHY_VERTICAL_SIGMA_M !== undefined &&
    mapRef
  ) {
    const point = mapRef.project([selection.longitude, selection.latitude]);
    const nearby = mapRef.queryRenderedFeatures(
      [
        [point.x - 80, point.y - 80],
        [point.x + 80, point.y + 80],
      ],
      { layers: mapRef.getStyle().layers.map((layer) => layer.id) },
    );
    const depths = nearby
      .filter((feature) => feature.sourceLayer === 'SOUNDG')
      .filter((feature) => feature.properties?.BATHY_DEPTH_M === undefined)
      .map((feature) => {
        const value =
          feature.properties?.VALSOU ?? feature.properties?.DEPTH ?? feature.properties?.DRVAL1;
        const depth = typeof value === 'number' ? value : Number(value);
        return Number.isFinite(depth) ? depth : undefined;
      })
      .filter((depth): depth is number => depth !== undefined);
    if (depths.length > 0) {
      depths.sort((a, b) => a - b);
      const officialDepthM = depths[Math.floor(depths.length / 2)] ?? depths[0];
      // Compare the official sounding with the local robust estimate, not the intentionally
      // shallow-biased display value. The conservative value is shown separately and must not
      // manufacture an apparent chart disagreement.
      const localDepth = Number(
        selection.properties.BATHY_ROBUST_DEPTH_M ?? selection.properties.BATHY_DEPTH_M,
      );
      if (Number.isFinite(localDepth)) {
        selection = {
          ...selection,
          bathymetryComparison: {
            depthM: officialDepthM,
            deltaM: localDepth - officialDepthM,
            count: depths.length,
            source: 'visible chart',
          },
        };
      }
    }
  }
  chartFeature = selection;
};
// The registered Measure overlay also owns its generous vertex hit surface and deliberate drag
// lifecycle. The chart click dispatcher consults it before deciding that a tap adds a new point.
let measureOverlay: MeasureOverlay | undefined;
// The unmanaged overlay that draws the working route's dots, labels, and cross-highlight. Like the
// editor, ChartCanvas owns its lifecycle (add, tick, recolor, raise) rather than the layer manager.
let workingRouteOverlay: WorkingRouteOverlay | undefined;
// Bumped on every start and stop so a route edit canceled before the lazily-loaded editor resolves
// does not start on a route that is no longer current.
let editGeneration = 0;
// Captured from onLoad so the units effect below can reach
// map.setGlobalStateProperty once the map exists. $state so the effect re-runs once it is assigned.
let mapRef = $state<MapLibreMap | undefined>();
let forecastVisible = untrack(() =>
  CHART_FORECAST_LAYER_IDS.some((id) => savedLayers?.[id]?.visible ?? false),
);
const chartWind = createChartWindController({
  store: untrack(() => weather),
  loader: untrack(() => weatherLoader),
  getBounds: () => (mapRef ? boundsToBbox(mapRef.getBounds()) : undefined),
  getSource: () => weatherSource.value,
  isVisible: () => forecastVisible,
});

$effect(() => chartWind.sourceChanged(weatherSource.value));

$effect(() => {
  const map = mapRef;
  const quality = mapRenderingQuality.value;
  if (!map) return;
  const pixelRatio = mapRenderingPixelRatio(quality, window.devicePixelRatio);
  if (map.getPixelRatio() !== pixelRatio) map.setPixelRatio(pixelRatio);
});

function resizeAfterFullScreenChange(): void {
  requestAnimationFrame(() => mapRef?.resize());
}
// Available as soon as MapLibre creates its canvas. Chart tools can be armed before the base style
// loads, so their cursor must not depend on the later onLoad callback that initializes overlays.
let cursorMapRef = $state<MapLibreMap | undefined>();
// Captured from onLoad alongside mapRef, so the off-screen vessel indicator can reuse the exact
// same centerOnVessel behavior as the menu's Center action, rather than duplicating its fly-to math.
let commandsRef = $state<MapCommands | undefined>();
let chartFeature = $state<ChartFeatureSelection | undefined>();
const CONTEXT_HINT_KEY = binnacleStorageKey('chartActionsHint');
let showContextHint = $state(false);
// The touch hint below is shown to coarse pointers only, and a right click advertises itself to
// mouse users, so the keyboard path (installContextMenu's Shift+F10 and Context Menu key, which
// opens the menu at the center of the view) had nothing naming it. The canvas carries it as a
// declared shortcut for assistive technology and as a tooltip.
const CHART_ACTIONS_TITLE =
  'Press Shift+F10 or the Context Menu key for chart actions at the center of the view.';

function dismissContextHint(): void {
  showContextHint = false;
  try {
    localStorage.setItem(CONTEXT_HINT_KEY, 'seen');
  } catch {
    // The hint remains session-only when local storage is unavailable.
  }
}

// Restyle the on-chart route editor and the working-route overlay whenever the theme changes (the
// saved-route overlay recolors through the layer manager; these two unmanaged pieces are restyled
// here). theme is a prop, so this effect tracks it in component scope.
$effect(() => {
  routeEditor?.setTheme(theme);
  workingRouteOverlay?.setTheme(theme);
});

// Vector chart depth labels follow Signal K's depth category through MapLibre global state rather
// than rebuilding filters or paint. Units is backed by reactive state, so this effect tracks it.
// setGlobalStateProperty is the Map-level API (setGlobalState is an internal Style method, not
// exposed on Map).
$effect(() => {
  const map = mapRef;
  if (!map) return;
  map.setGlobalStateProperty('unit', units.depthUnit);
});

// A crosshair makes the chart's temporary tap mode visible. Deliberate move mode switches to a move
// cursor, and route exclusion is still checked defensively in case external state changes overlap.
$effect(() => {
  const map = cursorMapRef;
  if (!map) return;
  const radarEditing = marineRadarLayer?.chartEditing() === true;
  const routeEditing = routeStore.working !== undefined;
  if (!measure.active && !routeEditing && !radarEditing) return;
  const canvas = map.getCanvas();
  const prior = canvas.style.cursor;
  // Move only for an armed measure drag; every other tap mode is a crosshair, radar editing
  // included, which is why radar wins over an armed move rather than the other way around.
  const cursor = !radarEditing && measure.moveArmed ? 'move' : 'crosshair';
  canvas.style.cursor = cursor;
  return () => {
    if (canvas.style.cursor === cursor) {
      canvas.style.cursor = activeLayerHitCursor(canvas) ?? (prior === 'pointer' ? '' : prior);
    }
  };
});

onMount(async () => {
  document.addEventListener('fullscreenchange', resizeAfterFullScreenChange);
  try {
    showContextHint =
      window.matchMedia('(pointer: coarse)').matches &&
      localStorage.getItem(CONTEXT_HINT_KEY) !== 'seen';
  } catch {
    showContextHint = window.matchMedia('(pointer: coarse)').matches;
  }
  // Detect Chart Locker before the map is built: the basemap style URL is read
  // synchronously at map construction, so detection must precede it. The same result routes the
  // raster overlays in onLoad below, so it is detected once here.
  const companionBase = await detectCompanion(origin, chartsToken);
  if (destroyed) return; // unmounted during the probe; do not build a map nothing will tear down
  // The probe settled: either the map constructs now (its canvas replaces the loading note within
  // this task) or the cannot-start notice explains why. Neither leaves a blank surface.
  chartBooting = false;
  // createThemedMap defaults to the world view ([0, 30], zoom 2) when no saved view is passed.
  mapHandle = createThemedMap({
    container,
    companionBase,
    getToken: () => chartsToken,
    transparentBaseWater: true,
    view: initialView,
    pixelRatio: mapRenderingPixelRatio(mapRenderingQuality.value, window.devicePixelRatio),
    managerOptions: {
      saved: savedLayers,
      exclusive: [[...CHART_FORECAST_LAYER_IDS]],
      onChange: (settings) => {
        onLayersChange?.(settings);
        const nextForecastVisible = CHART_FORECAST_LAYER_IDS.some(
          (id) => settings[id]?.visible ?? false,
        );
        if (nextForecastVisible === forecastVisible) return;
        forecastVisible = nextForecastVisible;
        chartWind.visibilityChanged(nextForecastVisible);
      },
      savedOrder,
      onOrderChange,
      // The own vessel, an active MOB mark, and active collision alarms stay pinned on top so a
      // chart or traffic can never hide them; bottom to top, collision, then the MOB mark, then
      // the vessel itself.
      pinned: [COLLISION_OVERLAY_ID, MOB_OVERLAY_ID, OWN_VESSEL_OVERLAY_ID],
    },
    onView: (view) => onViewChange?.(view),
    onUserPan: () => onUserPan?.(),
    onContextMenu: (point) => {
      // No context menu at all while drawing or editing a route, or while the measure tool is armed
      // (this suppresses every item, not just "Go to here"): Terra Draw and the measure tool own the
      // chart taps then.
      if (routeStore.working || measure.active || marineRadarLayer?.chartEditing()) {
        return;
      }
      dismissContextHint();
      onQuickActions?.({ x: point.x, y: point.y, latitude: point.lat, longitude: point.lng });
    },
    onLoad: async ({ map, ctx, manager: mgr, recolor, isDestroyed, runTick }) => {
      // Chart tools can be opened while optional overlays are still registering. Expose the loaded
      // map immediately so their cursor and keyboard feedback do not wait on unrelated providers.
      mapRef = map;
      map.on('moveend', () => chartWind.schedule());
      // Seed the unit global-state before registerAll below adds Seascape's vector layers, so their
      // global-state-driven filters and text-fields never evaluate against an unset value; the
      // units effect (mapRef-gated, further down) keeps it live after this initial seed.
      map.setGlobalStateProperty('unit', units.depthUnit);
      // A pan or zoom moves the chart out from under the menu's pixel anchor, so dismiss it on move.
      // Only on a move the user drove: MapLibre sets originalEvent for handler-driven moves (drag,
      // wheel, keyboard, the zoom control) and leaves it unset for a programmatic camera call, and
      // follow mode recenters on every fix, which would otherwise close the menu within one fix.
      map.on('movestart', (e) => {
        if (e.originalEvent) {
          chartFeature = undefined;
        }
      });
      // One mouse-or-touch tap handler gives the active chart tool one outcome per gesture. Measure
      // resolves a generous vertex hit before an empty-water add, and it suppresses the trailing
      // event that follows a completed drag.
      const handleChartTap = (e: MapTapEvent): void => {
        chartFeature = undefined;
        if (marineRadarLayer?.chartEditing()) {
          radarPlacementDispatch = true;
          queueMicrotask(() => {
            // Delegated handlers have already checked this gate during the MapLibre event. Release
            // it before Svelte restores the cursor after a final placement point.
            radarPlacementDispatch = false;
          });
          if (
            marineRadarLayer.handleChartPoint({
              latitude: e.lngLat.lat,
              longitude: e.lngLat.lng,
            })
          ) {
            return;
          }
        }
        if (measure.active && !routeStore.working) {
          if (measureOverlay?.consumeTrailingClick()) return;
          const vertexId = measureOverlay?.hitTestVertex(e.point);
          if (vertexId && measure.select(vertexId)) return;
          const position = {
            latitude: e.lngLat.lat,
            longitude: e.lngLat.lng,
          };
          if (measure.moveArmed) measure.commitMove(position);
          else measure.add(position);
          return;
        }
        // While a working route is up, a tap on a waypoint dot lights it and the legs it joins; a
        // tap on empty water clears the highlight. Terra Draw still owns the tap for selecting and
        // dragging the vertex underneath, so this only drives the cross-highlight. A generous box
        // makes a small dot tappable with a glove.
        if (routeStore.working) {
          const index = workingRouteOverlay?.hitTestWaypoint(e.point);
          if (index !== undefined) routeStore.setHighlight({ kind: 'waypoint', index });
          else routeStore.clearHighlight();
        }
      };
      const chartTap = createMapTapRecognizer((event) => {
        if (event.type === 'touchend') {
          // The Measure drag listener is registered after this map-wide listener. Let its touchend
          // finish first so a completed drag can suppress this tap instead of adding another point.
          queueMicrotask(() => {
            if (!isDestroyed()) handleChartTap(event);
          });
          return;
        }
        handleChartTap(event);
      });
      map.on('click', chartTap.click);
      map.on('touchstart', chartTap.touchstart);
      map.on('touchmove', chartTap.touchmove);
      map.on('touchend', chartTap.touchend);
      map.on('touchcancel', chartTap.cancel);
      // Build every overlay, then register the whole stack in one batch so the layer order is
      // applied once instead of restacking after each. The inter-band order comes from Z_ORDER (own
      // vessel and collision pinned on top, then the navigator's routes and track, then AIS and the
      // safety overlays, the ocean fields, and the charts at the base); the order below sets only the
      // order within a band.
      const notesOverlay = createNotesOverlay(
        origin,
        () => chartsToken,
        (selection) => {
          if (markerInteractionsAllowed()) onNoteSelect?.(selection);
        },
        symbols,
        {
          isOnline: isOnline ?? (() => true),
          interactionsAllowed: markerInteractionsAllowed,
          onNotes,
          onStatus: onPoiStatus,
          personalNotes,
        },
      );
      // One list feeds both registration and the per-frame tick, so the two cannot drift. The order
      // sets z within each band (tides under the safety overlays, the own vessel on top).
      const dynamicOverlays = buildDynamicOverlays({
        origin,
        getToken: () => chartsToken,
        store,
        vessel,
        aisTargets,
        selectedAisId: () => selectedAisId,
        aisKindMode,
        onAisMotionUpdate,
        onAisSelect: (id) => {
          if (markerInteractionsAllowed()) onAisSelect?.(id);
        },
        onWaypointSelect: (id) => {
          if (markerInteractionsAllowed()) onWaypointSelect?.(id);
        },
        anchor,
        mob,
        measure,
        collision,
        guidance,
        recorder,
        routeStore,
        tides,
        weather,
        onTideStationSelect: (selection) => {
          if (markerInteractionsAllowed()) onTideStationSelect?.(selection);
        },
        interactionsAllowed: markerInteractionsAllowed,
        units,
        waypoints,
        symbols,
        trackSettings,
        tripLog,
        savedTracks,
        notesOverlay,
        onAnchorMoved,
        aisTrailsAvailable: aisTrailsAvailable ?? (() => false),
        historyProviders: historyProviders ?? (() => undefined),
        timeTravel,
        marineRadarLayer,
      });
      measureOverlay = dynamicOverlays.find(
        (overlay): overlay is MeasureOverlay => overlay.id === MEASURE_OVERLAY_ID,
      );
      const criticalOverlays = dynamicOverlays.filter((overlay) =>
        CRITICAL_OVERLAY_IDS.includes(overlay.id),
      );
      let criticalFailureIds: string[] = [];
      const reportCriticalFailures = (): void => {
        onCriticalOverlayError?.([...criticalFailureIds]);
      };
      const onOverlaySyncStatus = (id: string | undefined, error: unknown | undefined): void => {
        if (!id || !CRITICAL_OVERLAY_IDS.includes(id)) return;
        if (error === undefined)
          criticalFailureIds = criticalFailureIds.filter((value) => value !== id);
        else if (!criticalFailureIds.includes(id)) criticalFailureIds.push(id);
        reportCriticalFailures();
      };
      const supportingOverlays = dynamicOverlays.filter(
        (overlay) => !CRITICAL_OVERLAY_IDS.includes(overlay.id),
      );
      const criticalResults = await mgr.registerBatch(criticalOverlays);
      if (isDestroyed()) return;
      const criticalFailures = criticalResults.filter((result) => result.status === 'failed');
      for (const failure of criticalFailures) {
        if (!criticalFailureIds.includes(failure.id)) criticalFailureIds.push(failure.id);
      }
      for (const result of criticalResults) {
        if (result.status === 'failed') {
          console.warn(`Could not register overlay "${result.id}".`, result.error);
        }
      }
      reportCriticalFailures();
      if (isDestroyed()) return;
      // Start live vessel, course, collision, MOB, anchor, and route synchronization immediately.
      // Optional overlays and remote providers can take longer to register and must not hold it up.
      const registeredDynamicIds = criticalResults
        .filter((result) => result.status === 'registered')
        .map((result) => result.id);
      runTick(
        criticalOverlays.filter((overlay) => registeredDynamicIds.includes(overlay.id)),
        onOverlaySyncStatus,
      );
      if (isDestroyed()) return;

      const supportingResults = await mgr.registerBatch(supportingOverlays);
      if (isDestroyed()) return;
      for (const result of supportingResults) {
        if (result.status === 'registered') registeredDynamicIds.push(result.id);
        else console.warn(`Could not register overlay "${result.id}".`, result.error);
      }
      // Expand the live set before any optional remote provider registration begins.
      runTick(
        dynamicOverlays.filter((overlay) => registeredDynamicIds.includes(overlay.id)),
        onOverlaySyncStatus,
      );
      if (isDestroyed()) return;

      // Route the remote raster overlays through the Chart Locker tile proxy when it is installed,
      // so the boat shares one cache and works offline. When it is absent, the sources keep their direct
      // upstream URLs (a standalone install is unchanged). The NASA GIBS ocean fields stay direct: they
      // are date-dynamic and not yet in the companion allowlist.
      // The bathymetry band (Seascape's DEM pair, the existing STREAMING_CHART_SOURCES rasters, and
      // Seascape's vector pair, in that registration order) is built by buildBathymetryOverlays; see
      // its own comment for why that relative order is load-bearing.
      // Read at registration time, not at mount: the mount probe below runs before credentials
      // exist, so on a secured server it is a 403 that reads as "no companion". The app re-probes
      // once auth resolves, and this is the latest answer available by the time tiles are routed.
      // It falls back to the mount probe so a standalone install is unchanged.
      const tileBase = companionTiles?.() ?? companionBase;
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local async accumulator
      const serverChartIds = new Set<string>();
      const providerResults = await mgr.registerBatch(buildReferenceOverlays(map, tileBase));
      if (isDestroyed()) return;
      for (const result of providerResults) {
        if (result.status === 'failed') {
          console.warn(`Could not register overlay "${result.id}".`, result.error);
        }
      }
      if (isDestroyed()) return;

      // The Terra Draw route editor draws into its own layers anchored in the routes band. It writes
      // edits back into the working route, which the panel reads for its live distance and count.
      // Loaded on first use, not at startup: Terra Draw and its adapter are a few hundred kB that
      // route editing alone needs, so deferring them cuts cold-load parse on Pi-class clients.
      const editorBeforeId = ctx.beforeIdFor('routes');
      let editorLoading: Promise<RouteEditor | undefined> | undefined;
      const loadRouteEditor = (): Promise<RouteEditor | undefined> => {
        editorLoading ??= loadRouteEditorModule()
          .then(({ createRouteEditor }) => {
            if (isDestroyed()) return undefined;
            routeEditor = createRouteEditor({
              map,
              beforeId: editorBeforeId,
              theme,
              onChange: (waypoints) => {
                const working = routeStore.working;
                if (working) routeStore.setWorking({ ...working, waypoints });
              },
            });
            return routeEditor;
          })
          .catch((error) => {
            // A chunk-load failure (offline, a cache miss over a flaky link) must not leave a
            // permanently rejected memoized promise that kills route editing for the session;
            // clear it so a later attempt re-imports, and surface the failure.
            console.error('Route editor failed to load', error);
            editorLoading = undefined;
            if (!isDestroyed()) onRouteEditorError?.();
            return undefined;
          });
        return editorLoading;
      };

      const view = new LayersView(mgr);
      view.refresh();
      onReady?.(view);
      forecastVisible = view.items.some(
        (item) => CHART_FORECAST_LAYER_IDS.some((id) => id === item.id) && item.visible,
      );
      if (forecastVisible) chartWind.schedule();
      onWindRetryReady?.(() => chartWind.load(true));
      if (isDestroyed()) return;

      let serverChartsGeneration = 0;
      let serverChartsQueue = Promise.resolve();

      async function loadServerCharts(generation: number): Promise<void> {
        const next = await fetchCharts(origin, chartsToken);
        if (isDestroyed() || generation !== serverChartsGeneration) return;
        if (next === undefined) {
          emitChartsStatus('error');
          return;
        }
        // A URL chart synced by this device can also be returned by the server. Keep the local,
        // manageable descriptor and omit its duplicate server entry.
        const localIds = new Set((userCharts?.sources ?? []).map((source) => source.id));
        const wanted = next.filter((chart) => !localIds.has(chart.identifier));
        for (const id of serverChartIds) {
          mgr.unregister(chartSourceId(id), { preserveProfileState: true });
        }
        serverChartIds.clear();
        const results = await mgr.registerBatch(
          wanted.map((chart) =>
            createChartOverlay(chart, origin, 'basemap', () => chartsToken, {
              onFeatureSelect: selectChartFeature,
              interactionsAllowed: markerInteractionsAllowed,
              s57Style: {
                safetyDepth:
                  thresholds.value.shallowDepthMeters ?? DEFAULT_THRESHOLDS.shallowDepthMeters,
                depthUnit: units.depthUnit,
              },
            }),
          ),
        );
        if (isDestroyed()) return;
        if (generation !== serverChartsGeneration) {
          // A newer refresh can be queued while this async batch installs. These ids were never
          // admitted to serverChartIds, so remove the completed batch directly before yielding to
          // the newer generation or it would leave stale overlays and duplicate registrations.
          for (const result of results) {
            if (result.status === 'registered') {
              mgr.unregister(result.id, { preserveProfileState: true });
            }
          }
          view.refresh();
          return;
        }
        for (const result of results) {
          const chart = wanted.find(
            (candidate) => chartSourceId(candidate.identifier) === result.id,
          );
          if (result.status === 'registered' && chart) serverChartIds.add(chart.identifier);
          if (result.status === 'failed') {
            console.warn(
              `Could not register server chart "${chart?.identifier ?? result.id}".`,
              result.error,
            );
          }
        }
        view.refresh();
        emitChartsStatus(
          results.some((result) => result.status === 'failed') ? 'partial' : 'ready',
        );
      }

      function retryServerCharts(): Promise<void> {
        if (isDestroyed()) return Promise.resolve();
        const generation = ++serverChartsGeneration;
        emitChartsStatus('loading');
        if (isDestroyed()) return Promise.resolve();
        serverChartsQueue = serverChartsQueue
          .catch(() => undefined)
          .then(() => loadServerCharts(generation))
          .catch((error) => {
            if (!isDestroyed() && generation === serverChartsGeneration) {
              console.warn('Could not refresh server charts.', error);
              emitChartsStatus('error');
            }
          });
        return serverChartsQueue;
      }

      onServerChartsReady?.(() => void retryServerCharts());
      if (isDestroyed()) return;
      // Safety and vessel overlays are already live before optional chart discovery starts. A slow
      // or unavailable charts endpoint therefore cannot postpone navigation rendering or map tools.
      void retryServerCharts();

      const userChartRegistrar: UserChartRegistrar = {
        register: async (chart) => {
          if (isDestroyed()) return;
          try {
            await mgr.register(
              createChartOverlay(chart, origin, 'bathymetry', () => chartsToken, {
                source: 'user',
                onFeatureSelect: selectChartFeature,
                interactionsAllowed: markerInteractionsAllowed,
                s57Style: {
                  safetyDepth:
                    thresholds.value.shallowDepthMeters ?? DEFAULT_THRESHOLDS.shallowDepthMeters,
                  depthUnit: units.depthUnit,
                },
              }),
            );
          } catch (error) {
            if (isDestroyed()) return;
            throw error;
          }
          if (isDestroyed()) return;
          view.refresh();
        },
        replace: async (chart) => {
          if (isDestroyed()) return;
          try {
            await mgr.replace(
              createChartOverlay(chart, origin, 'bathymetry', () => chartsToken, {
                source: 'user',
                onFeatureSelect: selectChartFeature,
                interactionsAllowed: markerInteractionsAllowed,
                s57Style: {
                  safetyDepth:
                    thresholds.value.shallowDepthMeters ?? DEFAULT_THRESHOLDS.shallowDepthMeters,
                  depthUnit: units.depthUnit,
                },
              }),
            );
          } catch (error) {
            if (isDestroyed()) return;
            throw error;
          }
          if (isDestroyed()) return;
          view.refresh();
        },
        unregister: (identifier) => {
          if (isDestroyed()) return;
          mgr.unregister(chartSourceId(identifier));
          view.refresh();
        },
      };
      onUserChartsReady?.(userChartRegistrar);
      if (isDestroyed()) return;

      onMapReady?.(recolor);
      if (isDestroyed()) return;

      const commands = buildMapCommands({
        map,
        ctx,
        view,
        manager: mgr,
        vessel,
        routeStore,
        notesOverlay,
        loadRouteEditor,
        getWorkingRouteOverlay: () => workingRouteOverlay,
        getRouteEditor: () => routeEditor,
        nextEditGeneration: () => ++editGeneration,
        cancelEditGeneration: () => {
          editGeneration += 1;
        },
        currentEditGeneration: () => editGeneration,
      });
      commandsRef = commands;
      onCommandsReady?.(commands);
      if (isDestroyed()) return;
      onMapInstance?.(map);
      if (isDestroyed()) return;

      // The working-route overlay rides the same tick but is not registered with the manager (it is
      // not a user-toggleable layer); its editVersion dirty-check gates its work. The initial theme
      // colors it up front so it does not flash the day palette before the theme effect runs.
      workingRouteOverlay = createWorkingRouteOverlay(routeStore, theme);
      workingRouteOverlay.add(ctx);
      runTick(
        [
          ...dynamicOverlays.filter((overlay) => registeredDynamicIds.includes(overlay.id)),
          workingRouteOverlay,
        ],
        onOverlaySyncStatus,
      );
    },
  });
  const map = mapHandle.map;
  cursorMapRef = map;
  if (map && onGoToHere) {
    // MapLibre's own aria-label names the canvas, so this only adds the shortcut: the label itself
    // is left alone because the chart host section already carries the "Chart" region name.
    const canvas = map.getCanvas();
    canvas.setAttribute('aria-keyshortcuts', CONTEXT_MENU_KEYSHORTCUTS);
    canvas.title = CHART_ACTIONS_TITLE;
  }
});

onDestroy(() => {
  // Stop the route editor before the map is removed so Terra Draw deregisters its adapter and
  // layers in the right order (start -> stop, before map.remove()); the guard makes it a no-op when
  // editing never started. Then tear the map down.
  destroyed = true;
  document.removeEventListener('fullscreenchange', resizeAfterFullScreenChange);
  measureOverlay?.cancelInteraction();
  measureOverlay = undefined;
  routeEditor?.stop();
  chartWind.destroy();
  onWindRetryReady?.(undefined);
  mapHandle?.destroy();
  onMapDestroyed?.();
});
</script>

<div class="chart-canvas" bind:this={container}>
  {#if chartBooting}
    <!-- The rest of the shell stays interactive; only the chart surface itself explains that it
         is starting rather than sitting blank through the companion probe. -->
    <div class="chart-booting" role="status">Loading chart…</div>
  {/if}
  {#if showContextHint}
    <div class="context-hint popover-card action-note" role="status">
      <span>Press and hold the chart for actions.</span>
      <button type="button" class="btn btn-ghost" onclick={dismissContextHint}>Got it</button>
    </div>
  {/if}
  {#if mapRef}
    <VesselOffScreenIndicator
      map={mapRef}
      position={vessel.position}
      positionStale={vessel.positionStale}
      onCenter={() => commandsRef?.centerOnVessel()}
    />
  {/if}
  {#if chartFeature}
    {#await loadChartFeatureInfo()}
      <div class="chart-feature-loading popover-card" role="status">Loading cell details…</div>
    {:then module}
      <module.ChartFeaturePopup
        selection={chartFeature}
        {units}
        {origin}
        token={chartsToken}
        onClose={() => {
          chartFeature = undefined;
        }}
      />
    {:catch}
      <button
        type="button"
        class="chart-feature-error popover-card"
        onclick={() => {
          chartFeature = undefined;
        }}
      >
        Cell details could not load. Tap to close.
      </button>
    {/await}
  {/if}
</div>

<style>
.chart-canvas {
  position: relative;
  inline-size: 100%;
  block-size: 100%;
}

.chart-canvas:fullscreen {
  inline-size: 100vw;
  block-size: 100vh;
  background: var(--surface);
}

/* Centered on the empty surface while the companion probe and map construction settle. */
.chart-booting {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--text-muted);
  font-size: var(--text-md);
}

.context-hint {
  position: absolute;
  inset-block-start: var(--space-2);
  inset-inline-start: 50%;
  z-index: var(--z-menu);
  inline-size: max-content;
  max-inline-size: calc(100% - 2 * var(--space-4));
  padding: var(--space-1) var(--space-2);
  transform: translateX(-50%);
  font-size: var(--text-sm);
}

.chart-feature-error,
.chart-feature-loading {
  position: absolute;
  inset-block-start: var(--space-2);
  inset-inline-start: 50%;
  z-index: var(--z-menu);
  min-block-size: var(--control-size);
  padding: var(--space-2) var(--space-3);
  transform: translateX(-50%);
}

.chart-feature-error {
  color: var(--alarm);
}

.chart-feature-loading {
  color: var(--text-muted);
  font-size: var(--text-sm);
}
</style>
