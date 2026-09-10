<script lang="ts">
import Anchor from '@lucide/svelte/icons/anchor';
import ArrowLeft from '@lucide/svelte/icons/arrow-left';
import Bell from '@lucide/svelte/icons/bell';
import ChartLine from '@lucide/svelte/icons/chart-line';
import CircleHelp from '@lucide/svelte/icons/circle-help';
import ClipboardList from '@lucide/svelte/icons/clipboard-list';
import CloudSun from '@lucide/svelte/icons/cloud-sun';
import Compass from '@lucide/svelte/icons/compass';
import DownloadCloud from '@lucide/svelte/icons/download-cloud';
import Expand from '@lucide/svelte/icons/expand';
import Gauge from '@lucide/svelte/icons/gauge';
import History from '@lucide/svelte/icons/history';
import House from '@lucide/svelte/icons/house';
import Layers from '@lucide/svelte/icons/layers';
import LifeBuoy from '@lucide/svelte/icons/life-buoy';
import LocateFixed from '@lucide/svelte/icons/locate-fixed';
import Lock from '@lucide/svelte/icons/lock';
import LockOpen from '@lucide/svelte/icons/lock-open';
import MapPin from '@lucide/svelte/icons/map-pin';
import Maximize2 from '@lucide/svelte/icons/maximize-2';
import MenuIcon from '@lucide/svelte/icons/menu';
import Minimize2 from '@lucide/svelte/icons/minimize-2';
import Moon from '@lucide/svelte/icons/moon';
import Navigation from '@lucide/svelte/icons/navigation';
import Pencil from '@lucide/svelte/icons/pencil';
import Radar from '@lucide/svelte/icons/radar';
import Route from '@lucide/svelte/icons/route';
import Ruler from '@lucide/svelte/icons/ruler';
import Search from '@lucide/svelte/icons/search';
import Settings from '@lucide/svelte/icons/settings';
import Ship from '@lucide/svelte/icons/ship';
import Spline from '@lucide/svelte/icons/spline';
import Sun from '@lucide/svelte/icons/sun';
import UserCog from '@lucide/svelte/icons/user-cog';
import Waves from '@lucide/svelte/icons/waves';
import Wind from '@lucide/svelte/icons/wind';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { onDestroy, onMount, untrack } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';
import { AisNameCache, AisTargets } from '$entities/ais';
import { AnchorWatch } from '$entities/anchor';
import { CollisionAssessment } from '$entities/collision';
import { CourseGuidance } from '$entities/course';
import { type HandoffSnapshot, isHandoffSnapshot } from '$entities/handoff';
import { DEFAULT_TREND_INSTRUMENT_IDS } from '$entities/instrument-trend';
import { MeasureStore } from '$entities/measure';
import { MobStore } from '$entities/mob';
import { NotificationsStore } from '$entities/notifications';
import { PersonalNotesStore } from '$entities/poi';
import {
  MAX_PROFILES,
  type ProfileSettings,
  ProfileStore,
  SignalKProfileAdapter,
} from '$entities/profile';
import {
  routeDistanceToGoMeters as calculateRouteDistanceToGoMeters,
  RouteStore,
} from '$entities/route';
import { SymbolsStore } from '$entities/symbols';
import { TidesStore } from '$entities/tides';
import { type TrackPoint, TrackRecorder } from '$entities/track';
import { UnitsStore } from '$entities/units';
import { cleanUserChartSource, type UserChartSource, UserCharts } from '$entities/user-charts';
import { OwnVessel } from '$entities/vessel';
import { WaypointsStore } from '$entities/waypoint';
import { WeatherStore } from '$entities/weather';
import { AIS_OVERLAY_ID, type AisNameMode, type AisVesselKindMode } from '$features/ais-layer';
import { loadAisListPanel } from '$features/ais-list';
import { ANCHOR_TONE, createAnchorController } from '$features/anchor-watch';
import { createUserChartsController } from '$features/charts';
import {
  CommandPalette,
  type CommandPaletteCommand,
  type PlaceSearchItem,
  searchPlaces,
} from '$features/command-palette';
import {
  NOAA_ENC_SOURCE_ID,
  SEASCAPE_DEM_SOURCES,
  shouldOfferNoaaEnc,
} from '$features/depth-charts';
import { createHandoffClient, createHandoffController } from '$features/handoff';
import {
  type AisRadarRangeNm,
  BINNACLE_INSTRUMENT_PLUGIN,
  createInstrumentRegistry,
  createInstrumentsController,
  createShallowAheadMonitor,
  DEFAULT_AIS_RADAR_RANGE_NM,
  DEFAULT_INSTRUMENT_DOCK_WIDTH_PX,
  DEFAULT_TILES,
  type FloatingInstrumentBox,
  floatingInstrumentBoxesCodec,
  type InstrumentTileLayouts,
  instrumentTileLayoutsCodec,
  isAisRadarRangeNm,
  loadInstrumentScreenLayer,
  loadInstrumentsPanel,
  MAX_INSTRUMENT_DOCK_WIDTH_PX,
  MIN_INSTRUMENT_DOCK_WIDTH_PX,
  type WebviewInstrument,
  webviewInstrumentsCodec,
} from '$features/instruments';
import { createInterfaceLockController, InterfaceLockLayer } from '$features/interface-lock';
import type { LayersView } from '$features/layers-panel';
import {
  AlarmButton,
  alarmButtonGrade,
  CollisionMute,
  createAlarmLocationSettingsSync,
  createAlarmSilenceController,
  createCollisionSettingsSync,
  createShallowController,
  GenericAlarm,
  isRaisedNotification,
  LookoutAlarm,
  worstRaisedNotification,
} from '$features/lookout';
import {
  createMarineRadarController,
  MARINE_RADAR_OVERLAY_ID,
  type RadarStatus,
  radarChartEditBlockedReason,
  radarHelmHealth,
} from '$features/marine-radar';
import { MEASURE_OVERLAY_ID } from '$features/measure';
import {
  ActionDial,
  AppMenu,
  blockedReason,
  DEFAULT_PINNED,
  itemBlocked,
  type MenuItem,
  togglePinned,
} from '$features/menu';
import { createMobController, MOB_TONE, MobButton } from '$features/mob';
import type { MooringPoint, MooringViewState } from '$features/moorings';
import { ARRIVAL_TONE, shouldSoundArrivalAlarm } from '$features/navigation';
import {
  createNoteDetailLoader,
  createPersonalNotesController,
  loadPersonalNoteDialog,
  type NoteDetailLoader,
  type NotePoint,
  type NoteSelection,
  type PoiViewState,
} from '$features/notes';
import type { Poi } from '$features/poi-search';
import { CompanionStatus, type RouteCoverageReport } from '$features/prewarm';
import {
  createProfileBindings,
  createProfilesController,
  downloadProfileJson,
  type ImportedProfile,
  loadProfilesPanel,
  ProfileSwitcher,
} from '$features/profiles';
import { createRouteController } from '$features/routing';
import {
  createTidesController,
  createTidesLoader,
  fetchSignalkTidesReading,
  loadTidesPanel,
  SIGNALK_TIDES_PLUGIN_ID,
  TIDES_OVERLAY_ID,
  type TideStationSelectionEvent,
} from '$features/tides';
import { createTimeTravelController } from '$features/time-travel';
import { createTrackController, createTripLogController } from '$features/tracks';
import { createTrendsController } from '$features/trends';
import { createWayfindingController } from '$features/wayfinding';
import { createWaypointsController, WaypointDialog } from '$features/waypoints';
import {
  createPointConditionsLoader,
  createWeatherLoader,
  defaultProvider,
  fetchWeatherProviders,
  WEATHER_LAYER_IDS,
  type WeatherProvider,
} from '$features/weather';
import {
  AlarmAudioGate,
  AlarmCoordinator,
  alarmAudioPrimed,
  GatedAlarm,
  primeAlarmAudio,
} from '$shared/audio';
import {
  type Bbox4,
  bboxContainsPoint,
  boundsOfPoints,
  type LatLon,
  padBbox,
  quantizeViewCellKey,
} from '$shared/geo';
import {
  Clock,
  createMediaQuery,
  formatClockTime,
  formatDuration,
  isRecord,
  PLATFORM_BREAKPOINTS,
  Toast,
} from '$shared/lib';
import type { CompanionProbeResult, LayerSettings } from '$shared/map';
import { DEFAULT_OVERLAY_STATE, probeCompanion, proxiedSources } from '$shared/map';
import { binnacleStorageKey } from '$shared/persistence';
import {
  BINNACLE_PRIVACY_CHANNEL,
  createBinnaclePrivacyRegistry,
  createBroadcastChannelBroadcaster,
  DevicePrivacyController,
  type EraseSafetyDecision,
  PrivacyActivityCoordinator,
  type PrivacyReport,
} from '$shared/privacy';
import { createScreenWakeLockController, OnlineStatus, registerPwa } from '$shared/pwa';
import {
  booleanPersistedCodec,
  booleanRecordPersistedCodec,
  boundedNumberPersistedCodec,
  CHART_ORIENTATION_MODES,
  type ChartOrientationMode,
  createAlarmLocation,
  createMapView,
  createPersistedCodec,
  createPlanningSpeed,
  createThresholds,
  createTrackSettings,
  DEFAULT_MAP_RENDERING_QUALITY,
  DEFAULT_WIND_ROSE_ARC_MARGIN_RAD,
  DEFAULT_WIND_ROSE_NO_GO_ANGLE_RAD,
  enumPersistedCodec,
  isMapView,
  MAP_RENDERING_QUALITIES,
  MAX_WIND_ROSE_ARC_MARGIN_RAD,
  MAX_WIND_ROSE_NO_GO_ANGLE_RAD,
  type MapRenderingQuality,
  type MapView,
  MIN_WIND_ROSE_ARC_MARGIN_RAD,
  MIN_WIND_ROSE_NO_GO_ANGLE_RAD,
  nullablePersistedCodec,
  type PersistedCodec,
  PersistedValue,
  preferTrackHistory,
  stringArrayPersistedCodec,
  tripLogEnabled,
  useLocalTrackFallback,
  type WeatherSourceId,
} from '$shared/settings';
import type { HistoryProviders } from '$shared/signalk';
import {
  AuthController,
  adminLoginUrl,
  createSignalKClient,
  fetchHistoryProviders,
  fetchServerFeatures,
  fetchSymbols,
  hydrateAisSnapshot,
  isConnectionOpen,
  recentSourceRefs,
  SELF_CONTEXT,
  type ServerFeatures,
  SignalKStore,
  SK_PATHS,
  serverOrigin,
  setWriteOutcomeListener,
} from '$shared/signalk';
import { createTrackStore } from '$shared/storage';
import {
  createThemeController,
  defaultSaveName,
  dialog,
  ErrorBoundary,
  LazyPanelState,
  type PanelId,
  type Theme,
  trapFocus,
} from '$shared/ui';
import { loadInstrumentChart, type MapCommands } from '$widgets/chart-canvas';
import { PlotterView } from '../views';
import { installBrowserZoomGuard } from './browser-zoom-guard';
import { resolveOrientation } from './chart-orientation';
import { createFollowController } from './follow-controller.svelte';
import { collectHandoffFacts } from './handoff-facts';
import LiveRegions from './LiveRegions.svelte';
import { layerSettingsCodec } from './layer-settings-codec';
import { createNotificationsController } from './notifications-controller.svelte';
import { createSafetyAnnunciator } from './safety-annunciator.svelte';
import { createStreamController } from './stream-controller.svelte';
import { createViewHistory } from './view-history';

// serverOrigin reads location, fixed for the page lifetime: capture once, not at every call site.
const origin = serverOrigin();
const chartLockerAccessUrl = adminLoginUrl(
  origin,
  `${location.pathname}${location.search}${location.hash}`,
);

const store = new SignalKStore();
// A one-second reactive clock drives every staleness check (a frozen GPS fix, a dropped feed), so
// they re-evaluate even while no data arrives. Disposed on teardown.
const clock = new Clock();
// Alarm audio readiness on the reactive clock. Every surface that can sound renders the grade as
// its own note: the status strip deliberately carries none, because a readout row is not where a
// browser-permission condition belongs, and on a boat with nothing audible armed the chip stated a
// silence that could not happen while costing the readouts a whole wrapped row.
const alarmAudioGate = new AlarmAudioGate(clock);
const audioState = $derived(alarmAudioGate.state);
const audioBlocked = $derived(alarmAudioGate.blocked);
const vessel = new OwnVessel(store, clock);
const aisRetentionMinutes = new PersistedValue<number>(
  binnacleStorageKey('aisRetentionMinutes'),
  60,
  undefined,
  boundedNumberPersistedCodec(15, 1440),
);
// Remember slow-reporting AIS static names across target pruning and reconnects. The cache is
// display-local, bounded, and expires each name 24 hours after it was last heard over AIS.
const aisNameCache = new AisNameCache();
const aisTargets = new AisTargets(
  store,
  Date.now,
  aisNameCache,
  () => aisRetentionMinutes.value * 60_000,
);
// A worker that dies after connect fires no Comlink settle; the failure callback routes it into
// the stream controller's error state, whose retry restarts the worker. Deferred through a closure
// because the controller is constructed further down; the callback can only fire after connect.
const client = createSignalKClient(() => streamController.onWorkerFailure());
const auth = new AuthController(origin);
// The token in the shape the REST clients expect (string | undefined, not the controller's
// string | null), and whether access has resolved (an authenticated session or an unsecured server),
// derived once rather than re-spelled at every call site and effect guard.
const authToken = $derived(auth.token ?? undefined);
const accessResolved = $derived(auth.status === 'authenticated' || auth.status === 'unsecured');
const net = new OnlineStatus();
const thresholds = createThresholds();
const alarmLocation = createAlarmLocation();
const collisionSettingsSync = createCollisionSettingsSync({
  origin,
  thresholds,
  getToken: () => authToken,
});
const alarmLocationSettingsSync = createAlarmLocationSettingsSync({
  origin,
  alarmLocation,
  getToken: () => authToken,
});
// Anchored own vessel treats moored and swinging boats as non-hazards, silencing the busy-anchorage
// nuisance; the callback reads anchor (constructed below) lazily, only from inside the assessment.
const collision = new CollisionAssessment(vessel, aisTargets, thresholds, () => anchor.watching);
// Every Binnacle-owned tone routes through one coordinator, so simultaneous alarms cannot sum at
// the speaker and priority is deterministic: MOB and an escalating close-quarters collision are
// co-equal and interleave; emergency outranks alarm; arrival is a courtesy that never preempts a
// safety condition. Per-alarm silencing stays at each call site, while the bounded whole-output
// silence below applies once at this shared boundary.
const alarmCoordinator = new AlarmCoordinator();
const alarmSilence = createAlarmSilenceController(clock);
$effect(() => {
  alarmCoordinator.setSilenced(alarmSilence.active);
});
const lookoutAlarm = new LookoutAlarm(
  alarmCoordinator.channel({ id: 'collision', rank: () => (collision.escalating ? 0 : 1) }),
);
// The collision mute is session-only with a bounded auto-expiring window (see CollisionMute): a mute
// set in a crowded anchorage must never carry silently into the next passage or across a reload, and
// a close, imminent contact escalates past it. Deliberately not a PersistedValue and not part of a
// profile bundle.
const collisionMute = new CollisionMute(clock);
// Server capability discovery: gates the v2 Notifications transport below; an older server
// falls back to the raw v1 delta publish.
let serverFeatures = $state<ServerFeatures | undefined>();
type ProviderProbeState = 'checking' | 'retrying' | 'available' | 'absent' | 'failed';
let historyProviders = $state<HistoryProviders | undefined>();
let historyProviderState = $state<ProviderProbeState>('checking');
let historyProbeGeneration = 0;
const notificationsApi = $derived(serverFeatures?.apis.has('notifications') ?? false);

async function probeHistoryProviders(
  retrying = false,
  refreshOpenInstruments = false,
): Promise<void> {
  const generation = ++historyProbeGeneration;
  historyProviderState = retrying ? 'retrying' : 'checking';
  // This helper runs synchronously inside the auth effect. Keep the state it updates out of that
  // effect's dependency set, or assigning a fresh provider result retriggers the probe forever.
  const previousIds = untrack(() => historyProviders?.ids.join('\u0000') ?? '');
  const providers = await fetchHistoryProviders(origin, authToken);
  if (generation !== historyProbeGeneration) return;
  historyProviders = providers;
  historyProviderState =
    providers === undefined ? 'failed' : providers.ids.length > 0 ? 'available' : 'absent';
  const providerIdsChanged = (providers?.ids.join('\u0000') ?? '') !== previousIds;
  if (
    (refreshOpenInstruments || providerIdsChanged) &&
    untrack(() => instruments.open || trends.open)
  ) {
    // The refresh reads the provider state we just assigned. Keep those controller reads out of
    // any effect that initiated this async probe, or the probe becomes its own dependency.
    untrack(() => instruments.refreshCatalog());
  }
}

// Every notifications.* path on the stream, mirrored for the Alarms panel's active-alert list:
// engine, NMEA2000, autopilot, and plugin alarms all surface without Binnacle knowing any of them.
const notificationsStore = new NotificationsStore(store);

// The anchor watch: server-driven when the anchoralarm plugin answers, client-side otherwise. The
// drag alarm mirrors the collision split: an audible tone here, the strip and live region below.
const anchor = new AnchorWatch(store, vessel, clock);
const anchorAlarm = new GatedAlarm(
  ANCHOR_TONE,
  alarmCoordinator.channel({ id: 'anchor', rank: () => 1 }),
);

// Man overboard: one tap on the strip button marks the spot, publishes the boat-wide alarm, and
// raises the recovery strip; a remote station's notifications.mob raises it here too.
const mob = new MobStore(store, vessel, clock);
const mobAlarm = new GatedAlarm(MOB_TONE, alarmCoordinator.channel({ id: 'mob', rank: () => 0 }));

// The measure tool: armed from the menu, fed by chart taps, read by its overlay and strip.
const measure = new MeasureStore();

// Track recording: client-side from navigation.position, persisted whole-voyage in IndexedDB.
const trackSettings = createTrackSettings();
const tripLog = createTripLogController({
  origin,
  getToken: () => authToken,
  providers: () => historyProviders,
  settings: trackSettings,
});
let trackPersistenceDegraded = $state(false);
const recorder = new TrackRecorder(
  trackSettings,
  createTrackStore<TrackPoint>(globalThis.indexedDB, () => {
    trackPersistenceDegraded = true;
  }),
);

// Routes: planned and stored as Signal K resources, drawn by the route overlay, edited on the chart.
const routeStore = new RouteStore();
// Active-navigation guidance: prefers the server Course API and computes the derived values
// client-side when the calcValues provider is absent. The arrival alarm sounds at the waypoint.
const courseGuidance = new CourseGuidance(store, vessel, clock);
const arrivalAlarm = new GatedAlarm(
  ARRIVAL_TONE,
  alarmCoordinator.channel({ id: 'arrival', rank: () => 5, courtesy: true }),
);
const arrivalMuted = new PersistedValue<boolean>(
  binnacleStorageKey('arrivalMuted'),
  false,
  undefined,
  booleanPersistedCodec,
);

// The first-run orientation: shown once per device after the shell is usable, dismissible from
// the Help panel, and reopenable there forever. Closing the auto-opened Help also counts as
// dismissal, so the orientation is skippable without hunting for the button.
const helpOrientationSeen = new PersistedValue<boolean>(
  binnacleStorageKey('helpOrientation'),
  false,
  undefined,
  booleanPersistedCodec,
);

function resetChartHints(): void {
  try {
    localStorage.removeItem(binnacleStorageKey('chartActionsHint'));
  } catch {
    // Storage unavailable (private mode): the hint state never persisted anyway.
  }
}
// The speed used to turn a planned route's distance into per-waypoint passage times. Stored in SI
// (m/s), migrating a pre-SI device's knots on first read; the route plan converts at its field.
const planningSpeedMps = createPlanningSpeed();

// Whole-route distance still to run across the legs ahead, for the passage arrival readout. Only when
// a multi-leg route is active and more than the current leg remains, so a single "go to" or the final
// leg leaves it undefined and the strip shows just the per-leg numbers. Kept separate from the time so
// the geodesy walk re-runs on a waypoint or route change, not on every SOG tick.
const routeDistanceToGoMeters = $derived.by<number | undefined>(() => {
  const idx = courseGuidance.activePointIndex;
  const total = courseGuidance.activePointTotal;
  const toNext = courseGuidance.distanceToNextMeters;
  const id = routeStore.activeId;
  if (id == null || idx == null || total == null || toNext == null || total - idx <= 1) {
    return undefined;
  }
  const route = routeStore.routeById(id);
  if (!route || total !== route.waypoints.length || idx >= route.waypoints.length) return undefined;
  return calculateRouteDistanceToGoMeters(
    route.waypoints,
    idx,
    toNext,
    courseGuidance.routeReversed,
  );
});

// Tides and tidal currents from NOAA CO-OPS (US waters). The store feeds the panel and the nearest
// station markers; the loader caches the station lists and predictions for the session.
const tidesStore = new TidesStore();
// Tide data prefers the signalk-tides plugin when the server runs it (worldwide coverage from
// its configured source), falling back to NOAA CO-OPS exactly as before; a stock server never
// sees a plugin call.
const tidesLoader = createTidesLoader({
  pluginAvailable: () => serverFeatures?.plugins.has(SIGNALK_TIDES_PLUGIN_ID) ?? false,
  pluginTides: (lat, lon) => fetchSignalkTidesReading(lat, lon, { origin, token: chartsToken }),
});

// Weather forecast, fetched browser-side from Open-Meteo. The full Forecast view and the optional
// primary-chart wind overlay keep independent selected view fields while sharing the loader's
// source-specific cache and the profile-owned source selection.
const weather = new WeatherStore();
const chartWeather = new WeatherStore();
// The cached weather loader (Open-Meteo plus RainViewer), constructed here and passed to the panel
// so it is swappable in tests and its in-memory cache lives for the session.
const weatherLoader = createWeatherLoader();
// The point-conditions loader, constructed once here (not per WeatherConditions mount) so reopening
// the weather panel reuses a single persisted-cache connection rather than opening a fresh one.
const pointConditionsLoader = createPointConditionsLoader();
let weatherPanelOpen = $state(false);
// The default Signal K weather provider's display name (for example AccuWeather), detected once the
// stream connects. When set, the weather panel prefers the provider for point data and falls back to
// the free grid; when undefined (no provider configured), the grid answers.
let weatherProvider = $state<WeatherProvider | undefined>();
// The panel's own weather-layer visibility, separate from the nav chart. Default wind and
// waves on so the first open shows something without hunting through toggles. The panel carries no
// persisted view of its own: it always opens where the nav chart is looking.
const weatherLayerSettings = new PersistedValue<LayerSettings>(
  binnacleStorageKey('weatherLayers'),
  {
    [WEATHER_LAYER_IDS.wind]: { ...DEFAULT_OVERLAY_STATE },
    [WEATHER_LAYER_IDS.observedWind]: { ...DEFAULT_OVERLAY_STATE },
    [WEATHER_LAYER_IDS.waves]: { visible: true, opacity: 0.7 },
  },
  undefined,
  layerSettingsCodec,
);
const weatherSource = new PersistedValue<WeatherSourceId>(
  binnacleStorageKey('weatherSource'),
  'automatic',
  undefined,
  enumPersistedCodec(['automatic', 'noaa', 'dwd', 'ecmwf']),
);

let layersView = $state<LayersView | undefined>();
// The edge-docked panels (routes, layers, tracks, collision thresholds) are mutually exclusive: one
// docks at the leading edge at a time. A single active-panel value enforces that structurally, so
// opening one closes whatever was open without each opener having to clear the others by hand.
let activePanel = $state<PanelId | null>(null);
let selectedAisId = $state<string | undefined>();
let selectedWaypointId = $state<string | undefined>();
let selectedMooringId = $state<string | undefined>();
let moorings = $state<MooringPoint[]>([]);
let mooringViewState = $state<MooringViewState>({
  phase: 'idle',
  destinationAis: 'checking',
});
let tidesOpenedFrom = $state<'menu' | 'chart'>('menu');
let profilesPanelAttempt = $state(0);
let personalNoteDialogAttempt = $state(0);
let instrumentsPanelAttempt = $state(0);
let instrumentScreenLayerAttempt = $state(0);
// A fresh object per request, not a bare string: the Layers panel adopts the requested tab on
// each request's new identity, so repeating the same tab still re-targets it, while the
// navigator's own tab clicks stay untouched between requests.
let layersOpenRequest = $state<{
  mode: 'charts' | 'overlays';
  target?: 'basemap';
}>({ mode: 'charts' });
let aisDisplaySettingsRequest = $state(0);
// The left dock's open state is owned here, not inside AppMenu, so a panel's back action can expand
// the menu after it collapsed on selection.
let menuOpen = $state(false);
let menuEditing = $state(false);
let commandPaletteOpen = $state(false);
let actionDialOpen = $state(false);
let actionDialContextPoint = $state<LatLon | undefined>();
type SupermenuBucketId = 'navigate' | 'chart' | 'vessel' | 'weather' | 'system' | 'safety';
let actionDialBucket = $state<SupermenuBucketId | undefined>();
type ActionDialPosition = { x: number; y: number };

function setActionDialOpen(next: boolean): void {
  actionDialOpen = next;
  if (!next) {
    actionDialContextPoint = undefined;
    actionDialBucket = undefined;
  }
}

// A chartplotter's Back action must mean the view the navigator just left, not an approximation
// such as "the menu". This history is deliberately display-local and bounded: it restores only
// transient UI surfaces, never chart data, edits, or actions with safety consequences.
type ViewSnapshot = {
  menuOpen: boolean;
  activePanel: PanelId | null;
  selectedNote: NoteSelection | undefined;
  selectedAisId: string | undefined;
  selectedWaypointId: string | undefined;
  selectedMooringId: string | undefined;
  trendFocusedId: string | undefined;
  weatherPanelOpen: boolean;
  radarControlsOpen: boolean;
  instrumentsOpen: boolean;
};
const viewHistory = createViewHistory<ViewSnapshot>(12);

function captureView(): ViewSnapshot {
  return {
    menuOpen,
    activePanel,
    selectedNote,
    selectedAisId,
    selectedWaypointId,
    selectedMooringId,
    trendFocusedId: trends.focusedId,
    weatherPanelOpen,
    radarControlsOpen,
    instrumentsOpen: instruments.open,
  };
}

function restoreView(view: ViewSnapshot): void {
  menuOpen = view.menuOpen;
  activePanel = view.activePanel;
  selectedNote = view.selectedNote;
  selectedAisId = view.selectedAisId;
  selectedWaypointId = view.selectedWaypointId;
  selectedMooringId = view.selectedMooringId;
  trends.setFocus(view.trendFocusedId);
  weatherPanelOpen = view.weatherPanelOpen;
  radarControlsOpen = view.radarControlsOpen;
  instruments.setOpen(view.instrumentsOpen);
}

function rememberCurrentView(): void {
  // The base chart is a valid return point, including the first navigation away from it.
  viewHistory.push(captureView());
}

function setMenuOpen(next: boolean): void {
  if (next && !menuOpen) rememberCurrentView();
  menuOpen = next;
}

const goBack = (): void => {
  const previous = viewHistory.back();
  if (previous) restoreView(previous);
};

function openCommandPalette(): void {
  commandPaletteOpen = true;
}
let mobCommandRequest = $state(0);
// Closing a panel drops everything that panel put on the chart or armed inside it, so nothing it
// owned outlives it: a dismissed confirm cannot come back armed, and a hover ring cannot strand on
// the chart with no panel to clear it.
const resetPanel = (): void => {
  if (activePanel === 'trends') {
    trends.setOpen(false);
    trends.setFocus(undefined);
    trendReturnInstrumentId = undefined;
  }
  if (activePanel === 'ais') selectedAisId = undefined;
  if (activePanel === 'waypoints') {
    selectedWaypointId = undefined;
    armNavigateWaypointId = undefined;
  }
  if (activePanel === 'poi-search') hoveredPoi = undefined;
  if (activePanel === 'moorings') selectedMooringId = undefined;
  activePanel = null;
};
const closePanel = (): void => {
  resetPanel();
  viewHistory.clear();
};
const goHome = (): void => {
  // Home is a predictable escape hatch: it closes transient UI without changing the chart's
  // position, navigation plan, or the helm's current instrument show or hide choice.
  resetPanel();
  selectedNote = undefined;
  selectedAisId = undefined;
  selectedWaypointId = undefined;
  selectedMooringId = undefined;
  noteReturnsToPlaces = false;
  weatherPanelOpen = false;
  radarControlsOpen = false;
  instrumentsFullScreenForced = false;
  exitScreenInstrumentEditing();
  menuOpen = false;
  actionDialOpen = false;
  actionDialBucket = undefined;
  actionDialContextPoint = undefined;
  viewHistory.clear();
};
// All former "back to menu" routes now restore the actual preceding surface. It preserves the
// function name at call sites while panels are migrated to the shared navigation contract.
const backToMenu = (): void => {
  goBack();
};
function profilesPanelForAttempt() {
  void profilesPanelAttempt;
  return loadProfilesPanel();
}
function personalNoteDialogForAttempt() {
  void personalNoteDialogAttempt;
  return loadPersonalNoteDialog();
}
function instrumentsPanelForAttempt() {
  void instrumentsPanelAttempt;
  return loadInstrumentsPanel();
}
function instrumentScreenLayerForAttempt() {
  void instrumentScreenLayerAttempt;
  return loadInstrumentScreenLayer();
}
const openInstalledCharts = (): void => openPanel('charts-management');
const backToOfflineCharts = (): void => goBack();
// The phone breakpoint, in CSS pixels. A media query cannot reference this constant, so the same
// 600px literal is mirrored in the `@media (max-width: 600px)` blocks in styles/panels.css and the
// scoped styles of WeatherMap, AppMenu, WeatherConditions, and the
// scoped CSS below. This const is the source of truth; retune all of them together.
const NARROW_BREAKPOINT_PX = PLATFORM_BREAKPOINTS.phoneMaxPx;
const INSTRUMENTS_FULLSCREEN_BREAKPOINT_PX = PLATFORM_BREAKPOINTS.compactHelmMaxPx;
// On a phone the note detail and a leading panel both collapse to bottom sheets and would overlap,
// so at narrow widths opening one closes the other. On a wide screen they dock to opposite edges and
// coexist, so this exclusion only applies while the phone query matches.
const narrowQuery = createMediaQuery(`(max-width: ${NARROW_BREAKPOINT_PX}px)`);
const narrow = $derived(narrowQuery.matches);
const standaloneDisplayMode = createMediaQuery('(display-mode: standalone)');
// iPadOS installed web apps use display-mode, while older Safari reports the legacy standalone
// flag. Neither needs a browser full-screen control because the app already owns the display.
const installedPwa = $derived(
  standaloneDisplayMode.matches ||
    (typeof navigator !== 'undefined' &&
      (navigator as Navigator & { standalone?: boolean }).standalone === true),
);
let instrumentsViewportFullScreen = $state(false);
let instrumentsFullScreenForced = $state(false);
const instrumentsFullScreen = $derived(
  instrumentsViewportFullScreen || instrumentsFullScreenForced,
);
// The safety rail's measured clearance, bound out of PlotterView so App-level fixed overlays (the
// full-screen dock) can reserve the space the rail floats over.
let safetyRailClearance = $state('0px');
// The helm rail is intentionally session-only: a reload always restores the safety and navigation
// actions. A vertical drag can start anywhere on the rail, while the hidden state leaves a broad
// bottom-edge swipe target instead of a small, precision handle.
let helmActionsVisible = $state(true);
let helmDragPointer: number | undefined;
let helmDragStartX = 0;
let helmDragStartY = 0;
let helmDragOffset = $state(0);
let helmDragCommitted = false;
let suppressHelmClick = false;
const HELM_DRAG_SLOP_PX = 8;
const HELM_HIDE_DISTANCE_PX = 18;
const HELM_REVEAL_DISTANCE_PX = 32;

function startHelmHideDrag(event: PointerEvent): void {
  if (!event.isPrimary || event.button !== 0) return;
  helmDragPointer = event.pointerId;
  helmDragStartX = event.clientX;
  helmDragStartY = event.clientY;
  helmDragOffset = 0;
  helmDragCommitted = false;
}

function moveHelmHideDrag(event: PointerEvent): void {
  if (event.pointerId !== helmDragPointer) return;
  const distance = event.clientY - helmDragStartY;
  if (distance <= HELM_DRAG_SLOP_PX || distance <= Math.abs(event.clientX - helmDragStartX)) return;
  if (!helmDragCommitted && event.currentTarget instanceof HTMLElement) {
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  helmDragCommitted = true;
  helmDragOffset = distance;
}

function finishHelmHideDrag(event: PointerEvent): void {
  if (event.pointerId !== helmDragPointer) return;
  if (
    event.currentTarget instanceof HTMLElement &&
    event.currentTarget.hasPointerCapture(event.pointerId)
  ) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
  suppressHelmClick = helmDragCommitted;
  if (suppressHelmClick) window.setTimeout(() => (suppressHelmClick = false), 0);
  if (helmDragOffset >= HELM_HIDE_DISTANCE_PX) helmActionsVisible = false;
  helmDragPointer = undefined;
  helmDragOffset = 0;
  helmDragCommitted = false;
}

function cancelHelmHideDrag(event: PointerEvent): void {
  if (event.pointerId !== helmDragPointer) return;
  helmDragPointer = undefined;
  helmDragOffset = 0;
  helmDragCommitted = false;
}

function guardHelmClick(event: MouseEvent): void {
  if (!suppressHelmClick) return;
  suppressHelmClick = false;
  event.preventDefault();
  event.stopPropagation();
}

function startHelmRevealSwipe(event: PointerEvent): void {
  if (!event.isPrimary || event.button !== 0) return;
  helmDragPointer = event.pointerId;
  helmDragStartY = event.clientY;
  helmDragCommitted = false;
  event.currentTarget instanceof HTMLElement &&
    event.currentTarget.setPointerCapture(event.pointerId);
}

function moveHelmRevealSwipe(event: PointerEvent): void {
  if (event.pointerId !== helmDragPointer) return;
  if (helmDragStartY - event.clientY >= HELM_REVEAL_DISTANCE_PX) {
    helmDragCommitted = true;
  }
}

function finishHelmRevealSwipe(event: PointerEvent): void {
  if (event.pointerId !== helmDragPointer) return;
  if (
    event.currentTarget instanceof HTMLElement &&
    event.currentTarget.hasPointerCapture(event.pointerId)
  ) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
  if (helmDragCommitted) helmActionsVisible = true;
  helmDragPointer = undefined;
  helmDragCommitted = false;
}
const openPanel = (panel: PanelId): void => {
  if (activePanel !== panel) rememberCurrentView();
  if (instrumentsFullScreen && instruments.open) instruments.setOpen(false);
  if (activePanel === 'trends' && panel !== 'trends') {
    trends.setOpen(false);
    trends.setFocus(undefined);
    trendReturnInstrumentId = undefined;
  }
  if (panel !== 'ais') selectedAisId = undefined;
  if (panel !== 'waypoints') {
    selectedWaypointId = undefined;
    armNavigateWaypointId = undefined;
  }
  if (panel !== 'poi-search') hoveredPoi = undefined;
  if (panel !== 'moorings') selectedMooringId = undefined;
  activePanel = panel;
  if (panel === 'trends') trends.setOpen(true);
  if (narrow) selectedNote = undefined;
};
// Open the panel if it is closed, close it if it is already open, so a bar pill and a menu tile both
// toggle. Delegates to openPanel/closePanel to keep the narrow-width clear-selectedNote side effect.
const togglePanel = (panel: PanelId, onOpen?: () => void): void => {
  if (activePanel === panel) {
    closePanel();
  } else {
    openPanel(panel);
    onOpen?.();
  }
};

function finishOpeningInstrumentsPanel(): void {
  if (!instruments.open) rememberCurrentView();
  instrumentsPanelRequested = true;
  if (instrumentsFullScreen) {
    radarControlsOpen = false;
    weatherPanelOpen = false;
    resetPanel();
    selectedNote = undefined;
    noteReturnsToPlaces = false;
  }
  instruments.setOpen(true);
}

let instrumentOpenSequence = 0;
let instrumentExpandedRequest = $state<{ id: string; sequence: number } | undefined>();
let windRoseSettingsRequest = $state<{ sequence: number } | undefined>();
let instrumentCustomizeRequest = $state<{ sequence: number } | undefined>();
let tideInstrumentRequested = $state(false);

function openExpandedInstrument(id: string): void {
  instrumentExpandedRequest = { id, sequence: ++instrumentOpenSequence };
  finishOpeningInstrumentsPanel();
}

function openAisRadarInstrument(): void {
  openExpandedInstrument('ais-radar');
}

function openWindRoseSettings(): void {
  instrumentExpandedRequest = undefined;
  windRoseSettingsRequest = { sequence: ++instrumentOpenSequence };
  finishOpeningInstrumentsPanel();
}

function openTideInstrument(): void {
  tideInstrumentRequested = true;
  openExpandedInstrument('tides');
  loadTides();
}

function openTideStationSettings(): void {
  tideInstrumentRequested = false;
  instrumentExpandedRequest = undefined;
  tidesOpenedFrom = 'menu';
  openPanel('tides');
  instruments.setOpen(false);
  loadTides();
}

// An empty screen edit layout starts with two useful visual instruments. Existing layouts remain
// operator-owned. The overlay stays visible after Done under the global Instruments control.
function startScreenInstrumentEditing(): void {
  if (instruments.screenEditing) return;
  instruments.seedEmptyFloating();
  instrumentsFullScreenForced = false;
  instrumentsPanelRequested = false;
  instruments.setOpen(true);
  instruments.setScreenEditing(true);
}
function exitScreenInstrumentEditing(): void {
  instruments.setScreenEditing(false);
}

// The helm control intentionally cycles the entire chart-overlay workflow without reopening the
// former side dock: show the saved overlay, unlock it for editing, then hide it.
function cycleInstruments(): void {
  if (instruments.screenEditing) {
    exitScreenInstrumentEditing();
    instruments.setOpen(false);
  } else if (instruments.open) {
    startScreenInstrumentEditing();
  } else {
    instruments.setOpen(true);
  }
}

function instrumentsActionLabel(): string {
  return instruments.screenEditing
    ? 'Hide instruments'
    : instruments.open
      ? 'Edit instruments'
      : 'Show instruments';
}

async function requestMobFromPalette(): Promise<void> {
  mobCommandRequest += 1;
}
let recolorMap: ((theme: Theme) => void) | undefined;
let chartsToken = $state<string | undefined>();

// The selected POI and a cache-owning detail loader, both set once auth resolves.
let selectedNote = $state<NoteSelection | undefined>();
let noteReturnsToPlaces = $state(false);
let noteLoader = $state<NoteDetailLoader | undefined>();
let mapView = $state<MapView | undefined>();
// The on-screen POIs reported by the notes overlay, clipped to the live viewport for the POI search.
// Replace-only (reassigned wholesale from onNotes), so raw state skips the wasted deep proxy.
let poiNotes = $state.raw<NotePoint[]>([]);
let poiViewState = $state<PoiViewState>({ phase: 'idle', offline: false });
// The clip is gated behind the panel being open so it does not recompute while the POI search
// panel is hidden, and the viewport is quantized so the in-view clip re-runs when the chart
// meaningfully moves, not at GPS rate while follow recenters on every fix.
const poiViewCellKey = $derived(
  activePanel === 'poi-search' && mapView ? quantizeViewCellKey(mapView) : '',
);
const poiInView = $derived.by<Poi[]>(() => {
  if (activePanel !== 'poi-search') return [];
  void poiViewCellKey;
  const bounds = mapCommands?.getBounds();
  const source = bounds
    ? poiNotes.filter((note) => bboxContainsPoint(bounds, note.position))
    : poiNotes;
  return source.map((note) => ({
    id: note.id,
    name: note.name,
    position: note.position,
    category: note.category,
    description: note.description,
    skIcon: note.skIcon,
    ownedByBinnacle: note.ownedByBinnacle,
    source: note.source,
    attribution: note.attribution,
    url: note.url,
  }));
});

// The result the POI search panel is pointing at, ringed on the chart. A hovered row (pointer or
// keyboard) wins over the open selection, so moving down the list previews each marker; neither
// moves the map.
// PlotterView owns the highlight effect for this state (bound down via hoveredPoi/selectedNote).
let hoveredPoi = $state<Poi | undefined>();
let updateReady = $state(false);
const pwa = registerPwa(() => (updateReady = true));
const PWA_UPDATE_CHECK_MS = 60_000;

const theme = createThemeController((next) => recolorMap?.(next));

// Profile state restored across visits: the last map view and the layer settings.
const mapViewStore = createMapView();
const savedView = isMapView(mapViewStore.value) ? mapViewStore.value : undefined;
const instrumentMapViewStore = createMapView(binnacleStorageKey('instrumentMapView'));
let instrumentMapView = $state<MapView | undefined>(
  isMapView(instrumentMapViewStore.value) ? instrumentMapViewStore.value : undefined,
);
let instrumentMapFollowing = $state(false);
let instrumentChartLoadAttempt = $state(0);
function instrumentChartForAttempt(): ReturnType<typeof loadInstrumentChart> {
  void instrumentChartLoadAttempt;
  return loadInstrumentChart();
}
// The live map view if one has been reported, else the persisted view: the fallback that the tides
// load and the weather map's initial view share.
const currentView = $derived(mapView ?? savedView);
const tidesController = createTidesController(tidesStore, tidesLoader, () => currentView);
const layerSettings = new PersistedValue<LayerSettings>(
  binnacleStorageKey('layers'),
  {},
  undefined,
  layerSettingsCodec,
);
const layerOrder = new PersistedValue<string[]>(
  binnacleStorageKey('layerOrder'),
  [],
  undefined,
  stringArrayPersistedCodec({ maxItems: 512 }),
);
const aisIconMode = new PersistedValue<AisVesselKindMode>(
  binnacleStorageKey('aisIconMode'),
  'type-specific',
  undefined,
  enumPersistedCodec(['type-specific', 'generic'] as const),
);
const aisNameMode = new PersistedValue<AisNameMode>(
  binnacleStorageKey('aisNameMode'),
  'adaptive',
  undefined,
  enumPersistedCodec(['off', 'adaptive', 'on'] as const),
);
// A one-shot, device-local latch: the first time a radar is discovered, the echo layer is turned on so
// "if they have radar, the radar layer is enabled". Latched so a later explicit toggle-off is never
// overridden. Not part of a profile: it is local device state, not portable layer configuration.
const radarAutoEnabled = new PersistedValue<boolean>(
  binnacleStorageKey('radarAutoEnabled'),
  false,
  undefined,
  booleanPersistedCodec,
);
const pinnedActions = new PersistedValue<string[]>(
  binnacleStorageKey('pinnedActions'),
  [...DEFAULT_PINNED],
  undefined,
  stringArrayPersistedCodec({ maxItems: 64, maxLength: 128 }),
);
const DEFAULT_HELM_BUTTONS = [
  'lock',
  'fullscreen',
  'home',
  'weather',
  'profiles',
  'instruments',
  'supermenu',
  'center',
] as const;
type HelmButtonId = (typeof DEFAULT_HELM_BUTTONS)[number];
const helmButtons = new PersistedValue<string[]>(
  binnacleStorageKey('helmButtons'),
  [...DEFAULT_HELM_BUTTONS],
  undefined,
  stringArrayPersistedCodec({ maxItems: DEFAULT_HELM_BUTTONS.length, maxLength: 32 }),
);
const helmButtonSet = $derived(new Set(helmButtons.value));
function helmButtonVisible(id: HelmButtonId): boolean {
  return helmButtonSet.has(id);
}
const bottomToolbarLabels = new PersistedValue<boolean>(
  binnacleStorageKey('bottomToolbarLabels'),
  true,
  undefined,
  booleanPersistedCodec,
);
const actionDialPosition = new PersistedValue<ActionDialPosition | null>(
  binnacleStorageKey('actionDialPosition'),
  null,
  undefined,
  createPersistedCodec(
    (value): value is ActionDialPosition =>
      typeof value === 'object' &&
      value !== null &&
      'x' in value &&
      'y' in value &&
      typeof value.x === 'number' &&
      Number.isFinite(value.x) &&
      typeof value.y === 'number' &&
      Number.isFinite(value.y),
  ),
);
// The helm display is normally the active chart. Keep it awake by default, while retaining a
// device-local opt-out for a portable iPad that needs to conserve its battery.
const screenWakeLockEnabled = new PersistedValue<boolean>(
  binnacleStorageKey('screenWakeLockEnabled'),
  true,
  undefined,
  booleanPersistedCodec,
);
const screenWakeLock = createScreenWakeLockController({
  isEnabled: () => screenWakeLockEnabled.value,
});

// The instrument dock: tile selection rides profiles through this PersistedValue (the bindings
// entry reads and writes it), while the open flag stays local so a casual dock toggle never
// dirties the active profile and a profile switch never yanks the dock.
const instrumentTiles = new PersistedValue<string[]>(
  binnacleStorageKey('instrumentTiles'),
  [...DEFAULT_TILES],
  undefined,
  stringArrayPersistedCodec({ maxItems: 100, maxLength: 256 }),
);
const instrumentWebviews = new PersistedValue<WebviewInstrument[]>(
  binnacleStorageKey('instrumentWebviews'),
  [],
  undefined,
  webviewInstrumentsCodec,
);
const instrumentTileLayouts = new PersistedValue<InstrumentTileLayouts>(
  binnacleStorageKey('instrumentTileLayouts'),
  {},
  undefined,
  instrumentTileLayoutsCodec,
);
const aisRadarRangeNm = new PersistedValue<AisRadarRangeNm>(
  binnacleStorageKey('aisRadarRangeNm'),
  DEFAULT_AIS_RADAR_RANGE_NM,
  undefined,
  createPersistedCodec(isAisRadarRangeNm),
);
const windRoseNoGoAngleRad = new PersistedValue<number>(
  binnacleStorageKey('windRoseNoGoAngleRad'),
  DEFAULT_WIND_ROSE_NO_GO_ANGLE_RAD,
  undefined,
  boundedNumberPersistedCodec(MIN_WIND_ROSE_NO_GO_ANGLE_RAD, MAX_WIND_ROSE_NO_GO_ANGLE_RAD),
);
const windRoseArcMarginRad = new PersistedValue<number>(
  binnacleStorageKey('windRoseArcMarginRad'),
  DEFAULT_WIND_ROSE_ARC_MARGIN_RAD,
  undefined,
  boundedNumberPersistedCodec(MIN_WIND_ROSE_ARC_MARGIN_RAD, MAX_WIND_ROSE_ARC_MARGIN_RAD),
);
// Chart orientation mode, profile-owned; the resolver and bearing effect live beside follow.
const chartOrientation = new PersistedValue<ChartOrientationMode>(
  binnacleStorageKey('chartOrientation'),
  'north',
  undefined,
  enumPersistedCodec(CHART_ORIENTATION_MODES),
);
const trendInstruments = new PersistedValue<string[]>(
  binnacleStorageKey('trendInstruments'),
  [...DEFAULT_TREND_INSTRUMENT_IDS],
  undefined,
  stringArrayPersistedCodec({ maxItems: 8, maxLength: 256 }),
);
const instrumentsOpen = new PersistedValue<boolean>(
  binnacleStorageKey('instrumentsOpen'),
  false,
  undefined,
  booleanPersistedCodec,
);
// Retire the former persistent lock state. A forced service-worker update reloads the page, and a
// lock is never allowed to survive that automated transition.
const legacyInterfaceLocked = new PersistedValue<boolean>(
  binnacleStorageKey('interfaceLocked'),
  false,
  undefined,
  booleanPersistedCodec,
);
legacyInterfaceLocked.set(false);
const interfaceLock = createInterfaceLockController();
const instrumentDockWidthStore = new PersistedValue<number>(
  binnacleStorageKey('instrumentDockWidth'),
  DEFAULT_INSTRUMENT_DOCK_WIDTH_PX,
  undefined,
  boundedNumberPersistedCodec(MIN_INSTRUMENT_DOCK_WIDTH_PX, MAX_INSTRUMENT_DOCK_WIDTH_PX),
);
// Instruments placed freely over the chart in screen edit mode. Device scope, like the dock's
// own open state and width: the layout belongs to the helm, never to a profile.
const instrumentScreenLayout = new PersistedValue<FloatingInstrumentBox[]>(
  binnacleStorageKey('instrumentScreenLayout'),
  [],
  undefined,
  floatingInstrumentBoxesCodec,
);
const instrumentOverlayOpacity = new PersistedValue<number>(
  binnacleStorageKey('instrumentOverlayOpacity'),
  1,
  undefined,
  boundedNumberPersistedCodec(0.2, 1),
);
let instrumentDockWidth = $state(untrack(() => instrumentDockWidthStore.value));
let instrumentsPanelRequested = $state(false);
$effect(() => {
  if (!instruments.open) instrumentsPanelRequested = false;
});

function resizeInstrumentDock(width: number): void {
  instrumentDockWidth = width;
}

function commitInstrumentDockWidth(width: number): void {
  instrumentDockWidth = width;
  instrumentDockWidthStore.set(width);
}
const instrumentRegistry = createInstrumentRegistry();
instrumentRegistry.register(BINNACLE_INSTRUMENT_PLUGIN);
const instruments = createInstrumentsController({
  store,
  origin,
  getToken: () => authToken,
  getHistoryProviders: () => historyProviders,
  getHistoryProviderState: () => historyProviderState,
  subscribe: (entries) => void client.raw.subscribe(entries),
  unsubscribe: (paths) => void client.raw.unsubscribe(paths),
  tilesStore: instrumentTiles,
  openStore: instrumentsOpen,
  floatingStore: instrumentScreenLayout,
  webviewStore: instrumentWebviews,
  registry: instrumentRegistry,
});
const trends = createTrendsController({
  store,
  origin,
  getToken: () => authToken,
  getHistoryProviders: () => historyProviders,
  getHistoryProviderState: () => historyProviderState,
  subscribe: (entries) => void client.raw.subscribe(entries),
  unsubscribe: (paths) => void client.raw.unsubscribe(paths),
  selectionStore: trendInstruments,
  getCatalog: () => instruments.trendCatalog,
  getDescriptor: (id) => instruments.trendDescriptor(id),
  prepareDescriptors: (ids) => instruments.prepareTrendDescriptors(ids),
  refreshCatalog: () => instruments.refreshCatalog(),
  getDiscovering: () => instruments.discovering,
  isHistoricalOnly: (id) => instruments.isHistoricalOnly(id),
});
let trendReturnInstrumentId = $state<string | undefined>();

function openFocusedTrend(id: string): void {
  if (!trends.setFocus(id)) return;
  trendReturnInstrumentId = id;
  openPanel('trends');
  instruments.setOpen(false);
}

function closeTrendsPanel(): void {
  trends.setFocus(undefined);
  trendReturnInstrumentId = undefined;
  closePanel();
}

function backFromTrendsPanel(): void {
  goBack();
}
const onToggleHelmButton = (id: string): void => {
  helmButtons.set(togglePinned(helmButtons.value, id));
};
const onResetHelmButtons = (): void => {
  helmButtons.set([...DEFAULT_HELM_BUTTONS]);
};
// Which Layers-panel categories the navigator has left open or closed, so the panel reopens that way.
const layerCategoriesOpen = new PersistedValue<Record<string, boolean>>(
  binnacleStorageKey('layerCategories'),
  {},
  undefined,
  booleanRecordPersistedCodec({ maxEntries: 128 }),
);
const mapRenderingQuality = new PersistedValue<MapRenderingQuality>(
  binnacleStorageKey('mapRenderingQuality'),
  DEFAULT_MAP_RENDERING_QUALITY,
  undefined,
  enumPersistedCodec(MAP_RENDERING_QUALITIES),
);
const instrumentMapRenderingQuality = new PersistedValue<MapRenderingQuality | null>(
  binnacleStorageKey('instrumentMapRenderingQuality'),
  null,
  undefined,
  nullablePersistedCodec(enumPersistedCodec(MAP_RENDERING_QUALITIES)),
);
const instrumentMapAisVisibility = new PersistedValue<boolean | null>(
  binnacleStorageKey('instrumentMapAisVisibility'),
  null,
  undefined,
  nullablePersistedCodec(booleanPersistedCodec),
);
const mainMapAisVisible = $derived(layerSettings.value[AIS_OVERLAY_ID]?.visible ?? true);

// Profiles: named bundles of portable settings, including theme, chart facets, overlays, opacity,
// order, provider display settings, weather layers, thresholds, track, and planning preferences.
// The display-unit preference: follows the server's unit preferences when they resolve, with a
// locally persisted fallback that profiles can carry. The store stays SI; only readouts consult it.
const units = new UnitsStore();

// The raw MapLibre map instance, handed up once after the chart loads so the regions panel can mount
// its Terra Draw rectangle tool independently of the route editor.
let mapInstance = $state<MapLibreMap | undefined>();

// Companion feature-detect. Both the regions and chart-management panels receive the resolved
// base URL as a prop, so they mount ready without their own probe RTT.
let companionProbe = $state<CompanionProbeResult | undefined>();
const companionBase = $derived(
  companionProbe?.state === 'present' || companionProbe?.state === 'access-refused'
    ? companionProbe.base
    : null,
);
// The base the raster overlays may actually be ROUTED through, which is not the same question.
// companionBase deliberately keeps an access-refused base so the panels can offer the access
// request against it, but routing chart tiles through a route that refuses them would replace a
// working direct upstream chart with a broken proxied one.
const companionTileBase = $derived(
  companionProbe?.state === 'present' ? companionProbe.base : null,
);
const shallowAhead = createShallowAheadMonitor({
  vessel,
  store,
  clock,
  active: () =>
    (instruments.open || instruments.screenEditing) &&
    (instruments.selectedIds.includes('shallow-ahead') || instruments.isFloating('shallow-ahead')),
  source: () => {
    const source = proxiedSources(SEASCAPE_DEM_SOURCES, companionTileBase)[0];
    if (!source?.tiles[0]) throw new Error('Seascape depth source is unavailable');
    return {
      template: source.tiles[0],
      proxied: companionTileBase !== null,
      ...(companionTileBase !== null && authToken ? { token: authToken } : {}),
    };
  },
});
let companionProbeGeneration = 0;

// Probed at mount (unauthenticated, so map init is never blocked on auth resolving) and retried
// wherever a stale credential could have been the reason it came back null: once real auth
// arrives, and again on a reconnect that could catch a companion started while the link was down.
function refreshCompanionProbe(): void {
  const generation = ++companionProbeGeneration;
  void probeCompanion(origin, authToken).then((result) => {
    if (generation !== companionProbeGeneration) return;
    companionProbe = result;
    void companionStatus.refresh();
  });
}

// The single owner of Chart Locker health, polled for the status strip's offline-charts chip. The
// base resolves after detectCompanion. Management access uses the browser's Signal K administrator
// session rather than Binnacle's device token.
const companionStatus = new CompanionStatus(() => companionBase);

// Time-travel review: one accepted provider snapshot drives the replay track, marker, and readouts.
// The controller owns bounded range requests, playback, and browser lifecycle cleanup.
const timeTravel = createTimeTravelController(
  origin,
  () => chartsToken,
  () => historyProviders,
);

// Standard server waypoints: fetched from /resources/waypoints, rendered by the chart overlay,
// managed in the Waypoints panel, and dropped from the chart's long-press menu.
const waypointsStore = new WaypointsStore();
const personalNotesStore = new PersonalNotesStore();

// Provided chart symbols (signalk-symbol-manager). Constructed empty so the chart can mount
// immediately and hold one stable reference; filled when the fetch lands after access resolves.
// On a stock server the resource type 404s and every icon stays built-in.
const symbolsStore = new SymbolsStore(origin, undefined);
let symbolsRefreshGeneration = 0;

// Provided chart symbols; absent on a stock server, in which case the built-ins stand. A
// symbol-manager plugin installed or updated while the link was down would otherwise leave stale
// icons until the page reloads, so the reconnect path refreshes these alongside the other resources.
async function refreshSymbols(): Promise<void> {
  const generation = ++symbolsRefreshGeneration;
  const list = await fetchSymbols(origin, authToken);
  if (generation === symbolsRefreshGeneration && list) symbolsStore.setSymbols(list);
}

const profileStore = new ProfileStore();

function localEraseSafety(): EraseSafetyDecision {
  if (!recorder.restored) {
    return { allowed: false, reason: 'Wait for the saved track recording check to finish.' };
  }
  if (mob.active)
    return { allowed: false, reason: 'Resolve the active man-overboard alert first.' };
  if (anchor.watching) return { allowed: false, reason: 'Stop the anchor watch first.' };
  if (courseGuidance.active) return { allowed: false, reason: 'Stop active navigation first.' };
  if (routeStore.working) return { allowed: false, reason: 'Save or cancel the route edit first.' };
  if (measure.active) return { allowed: false, reason: 'Finish or clear the measurement first.' };
  if (recorder.points.length > 0) {
    return { allowed: false, reason: 'Save or clear the unsaved recorded track first.' };
  }
  return { allowed: true };
}

const appScope =
  typeof window === 'undefined' || !import.meta.env.PROD
    ? ''
    : new URL(import.meta.env.BASE_URL, window.location.origin).href;
const privacyRegistry = createBinnaclePrivacyRegistry({
  localStorage: typeof localStorage === 'undefined' ? undefined : localStorage,
  indexedDB: globalThis.indexedDB,
  cacheStorage: globalThis.caches,
  serviceWorker:
    typeof navigator !== 'undefined' && 'serviceWorker' in navigator
      ? navigator.serviceWorker
      : undefined,
  serviceWorkerScopes: appScope ? [appScope] : [],
  // Both precache generations: serwist is current, and the retired workbox prefix stays so an
  // erase on an upgraded installation still removes a stale workbox precache.
  cachePrefixes: appScope
    ? [`serwist-precache-v2-${appScope}`, `workbox-precache-v2-${appScope}`]
    : [],
});
const privacySourceId =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `binnacle-${Math.random().toString(16).slice(2)}`;
const privacyActivity = new PrivacyActivityCoordinator(
  typeof navigator !== 'undefined' && 'locks' in navigator ? navigator.locks : undefined,
);
const privacy = new DevicePrivacyController({
  registry: privacyRegistry,
  canErase: () => privacyActivity.guard(localEraseSafety),
  broadcaster:
    typeof BroadcastChannel === 'undefined'
      ? undefined
      : createBroadcastChannelBroadcaster(BINNACLE_PRIVACY_CHANNEL, privacySourceId),
});

$effect(() => {
  privacyActivity.setUnsafe(!localEraseSafety().allowed);
});

let privacyReloadTimer: ReturnType<typeof setTimeout> | undefined;
function reloadAfterPrivacy(report: PrivacyReport): PrivacyReport {
  if (report.clearedOwnerIds.includes('signalk-credentials')) {
    // The privacy registry already removed the stored identity. Reset runtime auth without writing a
    // replacement into localStorage during the short confirmation window before the reload.
    auth.forgetDeviceCredentials(false);
  }
  if (report.clearedOwnerIds.length > 0) {
    // Give Svelte time to render the completion or named partial-failure report before reloading.
    // Partial results remain visible longer so the navigator can read which owner failed.
    const delayMs = report.status === 'partial' ? 5000 : 750;
    if (privacyReloadTimer) clearTimeout(privacyReloadTimer);
    privacyReloadTimer = setTimeout(() => window.location.reload(), delayMs);
  }
  return report;
}

async function forgetDeviceCredentials(): Promise<PrivacyReport> {
  return reloadAfterPrivacy(await privacy.forgetCredentials());
}

async function eraseAllLocalData(): Promise<PrivacyReport> {
  profilesController.suspend();
  try {
    const report = await privacy.eraseAllLocalData();
    if (!report.clearedOwnerIds.includes('local-settings')) profilesController.resume();
    return reloadAfterPrivacy(report);
  } catch (error) {
    profilesController.resume();
    throw error;
  }
}
// Handed up by the weather mini-map once it is ready, to push a weather-layer snapshot at runtime.
let applyWeatherLayers = $state<((settings: LayerSettings) => void) | undefined>();
// The mini-map is destroyed with the panel; drop the stale handle on close so a later profile
// apply cannot push a snapshot into a removed map or interrupt later profile autosaves.
$effect(() => {
  if (!weatherPanelOpen) applyWeatherLayers = undefined;
});

// The portable-setting binding table lives in the profiles feature (createProfileBindings); the live
// map-layer push on apply stays here, since this composition root owns the map handles.
const profileBindings = createProfileBindings({
  theme,
  layers: layerSettings,
  layerOrder,
  weatherLayers: weatherLayerSettings,
  weatherSource,
  aisIconMode,
  aisNameMode,
  aisRetentionMinutes,
  thresholds,
  trackSettings,
  planningSpeedMps,
  unitsLocal: units.localSetting,
  pinnedActions,
  instrumentTiles,
  instrumentTileLayouts,
  windRoseNoGoAngleRad,
  windRoseArcMarginRad,
  trendInstruments,
  anchorRadius: {
    get: () => anchor.preferredRadiusMeters,
    set: (radiusMeters) => anchor.rememberRadius(radiusMeters),
  },
  chartOrientation,
});

// Push a profile's persisted layer snapshots to the live maps after the bindings update their stores.
function applyProfileRuntime(s: ProfileSettings): void {
  mapCommands?.applyLayers(s.layers, s.layerOrder);
  applyWeatherLayers?.(s.weatherLayers);
  // A profile that actually configures the radar layer is an explicit choice, so latch radar
  // auto-enable to it (a profile that deliberately keeps the echo off must win). A profile saved before
  // radar existed carries no marine-radar entry, so it must NOT latch, or it would permanently suppress
  // first-discovery auto-enable on this device.
  if (s.layers[MARINE_RADAR_OVERLAY_ID]) radarAutoEnabled.set(true);
}

const profilesController = createProfilesController({
  store: profileStore,
  bindings: profileBindings,
  applyRuntime: applyProfileRuntime,
});

$effect(() => profilesController.observeSettings());

// Once the user is authenticated to a secured server, sync profiles through the SignalK applicationData
// API so they follow the user across devices. An unsecured server (status 'unsecured', no token) keeps
// profiles local, since applicationData is disabled without security. A fresh browser waits through
// one bounded hydration window before the offline fallback may create local starters.
async function syncProfiles(): Promise<void> {
  if (auth.status !== 'authenticated' || !auth.token) return;
  const adapter = new SignalKProfileAdapter(origin, () => auth.token ?? undefined, {
    onWriteOutcome: (ok, status) => auth.reportWriteOutcome(ok, status),
  });
  await profilesController.sync(adapter);
}

$effect(() => {
  if (auth.status === 'authenticated' && auth.token) {
    store.connection.phase;
    void syncProfiles();
  } else if (auth.status === 'unsecured' || auth.status === 'denied') {
    void profilesController.initialize();
  }
});

function onApplyProfile(id: string): void {
  profilesController.apply(id);
}

function onSaveNewProfile(name: string): void {
  if (profileStore.profiles.length >= MAX_PROFILES) {
    toast.show('Profile limit reached. Delete a profile before saving another.');
    return;
  }
  profilesController.saveNew(name);
}

function onExportProfile(id: string): void {
  const profile = profileStore.profileById(id);
  if (profile) downloadProfileJson(profile);
}

// Save each imported profile as a new one (a fresh id, so an import never overwrites an existing
// profile); the panel already parsed and validated the picked file.
function onImportProfiles(profiles: ImportedProfile[]): number {
  let importedCount = 0;
  for (const imported of profiles) {
    if (profileStore.profiles.length >= MAX_PROFILES) {
      toast.show('Profile limit reached. Some profiles were not imported.');
      break;
    }
    profileStore.save(imported.name, imported.settings);
    importedCount += 1;
  }
  return importedCount;
}

// User-imported charts: URL descriptors only, persisted locally and synced to the server as chart
// resources so every station sees them. Local .pmtiles FILES are the signalk-pmtiles-plugin's job
// (it serves them as ordinary chart resources Binnacle already renders), not a browser blob store.
const userChartsCodec: PersistedCodec<UserChartSource[]> = {
  decode(value) {
    if (!Array.isArray(value) || value.length > 1_000) return { state: 'invalid' };
    const cleaned: UserChartSource[] = [];
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local decode accumulator
    const ids = new Set<string>();
    let migrated = false;
    for (const item of value) {
      const chart = cleanUserChartSource(item);
      if (!chart || ids.has(chart.id)) {
        migrated = true;
        continue;
      }
      ids.add(chart.id);
      cleaned.push(chart);
      migrated ||= JSON.stringify(item) !== JSON.stringify(chart);
    }
    return { state: migrated ? 'migrated' : 'valid', value: cleaned };
  },
  encode(value) {
    const cleaned: UserChartSource[] = [];
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local encode accumulator
    const ids = new Set<string>();
    for (const item of value) {
      const chart = cleanUserChartSource(item);
      if (!chart || ids.has(chart.id)) continue;
      ids.add(chart.id);
      cleaned.push(chart);
    }
    return cleaned;
  },
};
const userChartsStore = new PersistedValue<UserChartSource[]>(
  binnacleStorageKey('userCharts'),
  [],
  undefined,
  userChartsCodec,
);

const userCharts = new UserCharts(
  userChartsStore.value,
  (sources) => userChartsStore.set(sources),
  (source) => {
    if (source.bounds) mapCommands?.fitBounds(source.bounds);
    userChartsController.syncUrlChartToServer(source);
  },
  (source) => userChartsController.deleteUserChartFromServer(source),
  (source) => {
    userChartsController.dropRegisteredUserChart(source.id);
    userChartsController.syncUrlChartToServer(source);
  },
);

// Tide data is fetched only while something can display it: the tide-stations layer or the Tides
// panel. With both off (the default) a pan must not issue NOAA station and prediction fetches that
// nothing renders.
const tidesWanted = $derived(
  (layerSettings.value[TIDES_OVERLAY_ID]?.visible ?? false) ||
    (layerSettings.value[WEATHER_LAYER_IDS.current]?.visible ?? false) ||
    (layerSettings.value[WEATHER_LAYER_IDS.conditions]?.visible ?? false) ||
    (weatherPanelOpen &&
      (weatherLayerSettings.value[WEATHER_LAYER_IDS.current]?.visible ?? false)) ||
    activePanel === 'tides' ||
    tideInstrumentRequested ||
    (instruments.open && instruments.tiles.some((def) => def.id === 'tides')),
);
$effect(() => {
  if (!instruments.open) tideInstrumentRequested = false;
});

// The view changes once per animation frame while panning; persist only after it
// settles so a drag is one write, not hundreds.
let viewSaveTimer: ReturnType<typeof setTimeout> | undefined;
// Debounce the view save so a drag settles into one write, not hundreds.
const VIEW_SAVE_DEBOUNCE_MS = 400;
function onViewChange(view: MapView): void {
  mapView = view;
  if (viewSaveTimer) clearTimeout(viewSaveTimer);
  viewSaveTimer = setTimeout(() => {
    mapViewStore.set(view);
    // Refresh tides for the settled view; the loader skips small moves and dedups in flight.
    if (tidesWanted) void tidesController.load(view);
  }, VIEW_SAVE_DEBOUNCE_MS);
}

function onInstrumentMapViewChange(view: MapView): void {
  instrumentMapView = view;
  // Follow fixes can arrive every second. Persist hand-positioned cameras, not the boat's track.
  if (!instrumentMapFollowing) instrumentMapViewStore.set(view);
}

// Load tides for the current view, so opening the Tides panel shows data without a pan first.
function loadTides(force = false): void {
  void tidesController.loadCurrent(force);
}

// Toggling the tide layer on (or opening the panel) loads tides for the current view, covering the
// fetches the gated pan-settle path skipped while nothing displayed them. The view read is
// untracked: mapView changes every frame of a pan, and depending on it would re-run this per
// frame while the layer is on; the debounced pan-settle path already covers view changes. Warm the
// small panel module at the same time so tapping a visible chart marker does not start its first
// chunk request while the user is waiting for the station detail.
$effect(() => {
  if (!tidesWanted) return;
  void loadTidesPanel().catch(() => undefined);
  untrack(loadTides);
});

let mapCommands = $state<MapCommands | undefined>();

// A usable local cache is enough to start immediately. Server hydration still runs when
// authentication resolves, but an offline restart must keep profile autosave working. This call
// sits BELOW every declaration applyProfileRuntime touches (mapCommands is the last): with no
// server argument, initialize reaches applySettings synchronously, so calling it earlier reads
// the mapCommands state before its declaration executes, a startup ReferenceError whenever a
// saved profile exists locally. The catch keeps a failed startup apply a visible logged error
// instead of an unhandled rejection.
if (profileStore.profiles.length > 0) {
  profilesController.initialize().catch((error) => {
    console.error('[profiles] startup apply failed', error);
  });
}

// Chart orientation: north-up by default, with course-up and heading-up as explicit profile-owned
// choices. The resolver owns the fallback rules (fresh reference or north, immediately), the
// effect below is the one author of map bearing, and rotation gestures stay disabled.
const orientation = $derived(
  resolveOrientation({
    mode: chartOrientation.value,
    headingRad: vessel.headingRad,
    headingStale: vessel.headingStale,
    cogRad: vessel.cogRad,
    cogStale: vessel.cogStale,
    sogMps: vessel.sogMps,
    sogStale: vessel.sogStale,
  }),
);
$effect(() => {
  mapCommands?.setMapBearing(orientation.bearingDeg);
});
function cycleOrientation(): void {
  const modes = CHART_ORIENTATION_MODES;
  const index = modes.indexOf(chartOrientation.value);
  chartOrientation.set(modes[(index + 1) % modes.length]);
}
const ORIENTATION_TILE_LABELS: Record<ChartOrientationMode, string> = {
  north: 'North up',
  course: 'Course up',
  heading: 'Heading up',
};
// The bounded look-ahead: only a rotated chart making way shifts the boat low on screen (up IS
// ahead there); north-up and a stopped or referenceless boat stay centered. Bounded by a fixed
// pixel budget, and the map is never pitched.
const LOOK_AHEAD_PX = 140;
const lookAheadPx = $derived(
  orientation.active && chartOrientation.value !== 'north' ? LOOK_AHEAD_PX : 0,
);

// Follow lock orchestration (recenter per fix, stale pause with auto recovery, release on manual
// pan) lives in the controller; the host wires the menu tile and onUserPan to it.
const follow = createFollowController({
  vessel,
  commands: () => mapCommands,
  lookAheadPx: () => lookAheadPx,
});

// Show a chart layer at full registration (the persisted snapshot plus the live map), so a feature
// surface can turn its own layer on: starting Measure must reveal a hidden measure layer (or it
// records invisible points), and the Tides panel cross-links its stations layer.
function setLayerVisible(id: string, visible: boolean): void {
  const current = layerSettings.value[id];
  if (current?.visible === visible) return;
  const entry = current ? { ...current, visible } : { visible, opacity: 1 };
  const next = { ...layerSettings.value, [id]: entry };
  layerSettings.set(next);
  mapCommands?.applyLayers(next, layerOrder.value);
}

const HELM_WEATHER_LAYER_IDS = [
  WEATHER_LAYER_IDS.conditions,
  WEATHER_LAYER_IDS.wind,
  WEATHER_LAYER_IDS.current,
  TIDES_OVERLAY_ID,
  WEATHER_LAYER_IDS.temperature,
  WEATHER_LAYER_IDS.uv,
] as const;
type HelmWeatherLayerId = (typeof HELM_WEATHER_LAYER_IDS)[number];

const helmWeatherLayer = $derived(
  HELM_WEATHER_LAYER_IDS.find((id) => layerSettings.value[id]?.visible),
);

function helmWeatherLayerName(id: HelmWeatherLayerId | undefined): string {
  if (id === WEATHER_LAYER_IDS.conditions) return 'conditions';
  if (id === WEATHER_LAYER_IDS.wind) return 'wind and gusts';
  if (id === WEATHER_LAYER_IDS.current) return 'ocean currents';
  if (id === TIDES_OVERLAY_ID) return 'tide and current stations';
  if (id === WEATHER_LAYER_IDS.temperature) return 'temperature';
  if (id === WEATHER_LAYER_IDS.uv) return 'UV index';
  return 'off';
}

function setHelmWeatherLayer(id: HelmWeatherLayerId | undefined): void {
  let changed = false;
  const next = { ...layerSettings.value };
  for (const layerId of HELM_WEATHER_LAYER_IDS) {
    const current = next[layerId];
    const visible = layerId === id;
    if (current?.visible === visible) continue;
    next[layerId] = current ? { ...current, visible } : { visible, opacity: 1 };
    changed = true;
  }
  if (!changed) return;
  layerSettings.set(next);
  mapCommands?.applyLayers(next, layerOrder.value);
}

function cycleHelmWeatherLayer(): void {
  const currentIndex = helmWeatherLayer ? HELM_WEATHER_LAYER_IDS.indexOf(helmWeatherLayer) : -1;
  const next = HELM_WEATHER_LAYER_IDS[currentIndex + 1];
  setHelmWeatherLayer(next);
}

function onTideStationSelect(selection: TideStationSelectionEvent): void {
  setLayerVisible(TIDES_OVERLAY_ID, true);
  if (activePanel !== 'tides') {
    tidesOpenedFrom = 'chart';
    openPanel('tides');
  }
  if (selection.mode === 'automatic') {
    void tidesController.useAutomatic(selection.kind);
  } else {
    void tidesController.selectStation(selection.kind, selection.station);
  }
}

// A menu action can reveal a layer before ChartCanvas finishes its asynchronous map setup. Persisted
// state already records that action; replay the latest full snapshot when commands arrive so the live
// manager cannot remain on the older construction-time props for the rest of the session.
function captureMapCommands(commands: MapCommands): void {
  mapCommands = commands;
  // PlotterView forwards readiness from an effect. Keep this snapshot read out of that effect's
  // dependency set, or applyLayers persists the same state and recursively re-triggers readiness.
  untrack(() => commands.applyLayers(layerSettings.value, layerOrder.value));
}

// Arming always reveals the measure layer first: an armed tool drawing into an invisible layer
// would read as broken. Selecting the active menu item keeps the current measurement. The chart's
// "Measure from here" action explicitly requests a fresh measurement at that position.
function armMeasure(reset = false): boolean {
  // No actionable crosshair before the tap handler exists: arming against a chart that is still
  // constructing advertises a first tap that would be silently dropped.
  if (!mapInstance) {
    toast.show('The chart is still loading. Measure will be available in a moment.');
    return false;
  }
  if (marineRadar.store.areaDraft?.chartEditing) {
    toast.show('Finish the radar-area chart edit before starting Measure.');
    return false;
  }
  if (routeStore.working) {
    toast.show('Save or cancel the route edit before starting Measure.');
    return false;
  }
  setLayerVisible(MEASURE_OVERLAY_ID, true);
  if (!measure.active || reset) measure.start();
  return true;
}

function moveSelectedMeasureToCenter(): void {
  const center = mapInstance?.getCenter();
  if (!center) {
    toast.show('The chart is still loading. Try moving the point again in a moment.');
    return;
  }
  measure.commitMove({ latitude: center.lat, longitude: center.lng });
}

// The marine radar controller owns the spokes worker and the echo layer. Detection runs once server
// features resolve; on a stock server discovery degrades and nothing streams. getCenter and getToken
// are getters so the radar follows the live vessel position and a token that arrives mid-session.
const marineRadar = createMarineRadarController({
  origin,
  getToken: () => chartsToken,
  getCenter: () => vessel.position ?? undefined,
  getHeading: () => vessel.headingRad,
  centerFresh: () => !vessel.positionStale,
  headingFresh: () => !vessel.headingStale,
  radarAvailable: () => serverFeatures !== undefined,
  chartEditBlockedReason: () =>
    radarChartEditBlockedReason({
      measureActive: measure.active,
      routeEditing: routeStore.working !== undefined,
      offlineChartsOpen: activePanel === 'regions' || activePanel === 'charts-management',
      chartReady: mapInstance !== undefined,
    }),
});
// The radar controls slide-over opens from the radar menu tile or the radar layer row's gear;
// radarOpenedFrom records which, so its back arrow returns to the menu only when the menu opened it
// (from the gear the layers panel is still behind it, so going to the menu would strand the navigator).
let radarControlsOpen = $state(false);
let radarOpenedFrom = $state<'menu' | 'layers'>('menu');
let radarDraftDirty = $state(false);
let radarPanelRequest = $state<'close' | 'instruments' | undefined>();

function toggleRadarControlsFromMenu(): void {
  radarOpenedFrom = 'menu';
  if (radarControlsOpen && radarDraftDirty) {
    radarPanelRequest = 'close';
    return;
  }
  if (radarControlsOpen) {
    radarControlsOpen = false;
    viewHistory.clear();
    return;
  }
  rememberCurrentView();
  if (instrumentsFullScreen) instruments.setOpen(false);
  radarControlsOpen = true;
}

const bottomTabObscured = $derived(
  activePanel !== null ||
    weatherPanelOpen ||
    radarControlsOpen ||
    selectedNote !== undefined ||
    (instrumentsFullScreen && instruments.open),
);

// Auto-enable the radar echo the first time a radar is discovered, then latch so a later manual
// toggle-off in the Layers panel is never overridden. The radar layer row's toggle is disabled until a
// radar is available, so there is no pre-availability "off" to preserve, which makes a one-shot correct.
$effect(() => {
  if (!marineRadar.store.hasRadar || radarAutoEnabled.value) return;
  radarAutoEnabled.set(true);
  setLayerVisible(MARINE_RADAR_OVERLAY_ID, true);
});

// The controls hydration poll only feeds the radar panel, so run it only while the panel is open. Live
// control changes and the radar picture arrive over their respective streams.
$effect(() => {
  marineRadar.setPolling(radarControlsOpen);
});

// Set the radar's transmit/standby state; when transmit is keyed up, reveal the echo so powering on
// shows the picture in one action.
function onSetRadarPower(status: RadarStatus): void {
  void marineRadar.setPower(status).then((ok) => {
    if (ok && status === 'transmit') setLayerVisible(MARINE_RADAR_OVERLAY_ID, true);
  });
}

// Shallow-water depth alarm: the lookout controller owns the resolved-depth predicate, the server
// meta.zones authority, the live-region string, and the tone. The strip's Depth readout and the
// live region key off the same conditions through it, matching the anchor drag alarm's own
// strip-chip-plus-live-region pairing.
const shallowController = createShallowController({
  getSafetyDepth: () => vessel.safetyDepth,
  thresholds,
  units,
  origin,
  getToken: () => chartsToken,
  alarm: alarmCoordinator.channel({ id: 'shallow', rank: () => 2 }),
});

// The generic server-alarm channel: any inbound alarm or emergency grade notification outside the
// five dedicated hazards sounds through this one alarm and surfaces on the AlarmStrip, the Alarms
// badge, and the assistive channel. The controller drives it from the shared generic list. It is
// constructed before the menu registry so the Alarms entry can carry the live count.
const genericAlarm = new GenericAlarm(alarmCoordinator.channel({ id: 'generic', rank: () => 2 }));

const notificationsController = createNotificationsController({
  origin,
  token: () => chartsToken,
  notificationsApi: () => notificationsApi,
  writeBlocked: () => auth.writeBlocked,
  requestWriteAccess: () => auth.requestWriteAccess(),
  client,
  collision,
  collisionMute,
  lookoutAlarm,
  anchor,
  notificationsStore,
  companionStatus,
  timeTravel,
  mob,
  genericAlarm,
  ownedDepthNotificationPath: () => shallowController.ownedNotificationPath,
  anchorNotificationCovered: () => anchor.mode === 'server',
});
const collisionAlert = $derived(notificationsController.collisionAlert);
const genericAlarms = $derived(notificationsController.genericAlarms);
const activeAlarmNotifications = $derived(
  notificationsStore.list().filter((notification) => !notification.acknowledged),
);
const helmAlarmGrade = $derived(alarmButtonGrade(activeAlarmNotifications));
const genericNotificationAlert = $derived(notificationsController.notificationAlert);
const muteAlert = $derived(notificationsController.muteAlert);
const muteRemainingMin = $derived(notificationsController.muteRemainingMin);
const companionAnnounce = $derived(notificationsController.companionAnnounce);
const alarmActionError = $derived(notificationsController.alarmActionError);
const toggleCollisionMute = notificationsController.toggleCollisionMute;
const onSilenceNotification = notificationsController.onSilenceNotification;
const onAcknowledgeNotification = notificationsController.onAcknowledgeNotification;
const muteGenericHere = notificationsController.muteGenericHere;

// Helm radar health, shared by the status strip chip and the watch-handoff facts so the two can
// never disagree about the same picture.
const radarHealth = $derived(
  radarHelmHealth({
    echoShown: layerSettings.value[MARINE_RADAR_OVERLAY_ID]?.visible ?? false,
    operationalStatus: marineRadar.store.operationalStatus,
    connection: marineRadar.store.status,
    renderer: marineRadar.store.rendererStatus,
  }),
);

// Watch handoff: timestamped review-status snapshots shared through Signal K applicationData
// (global scope, every station reads one list), with a bounded device draft queue that syncs when
// the server store returns. Creating a snapshot only reads the stores wired here.
const handoffDrafts = new PersistedValue<HandoffSnapshot[]>(
  binnacleStorageKey('handoffDrafts'),
  [],
  undefined,
  createPersistedCodec(
    (value: unknown): value is HandoffSnapshot[] =>
      Array.isArray(value) && value.length <= 10 && value.every(isHandoffSnapshot),
  ),
);
const handoffClient = createHandoffClient(origin, () => authToken);
// The latest route-coverage report, threaded up from the Offline charts panel, so a handoff can
// state whether the corridor was checked without re-running the check.
let routeCoverageFact = $state<string | undefined>();
function onRouteCoverageReport(report: RouteCoverageReport | null): void {
  if (report === null || report.verdict === 'unknown') {
    routeCoverageFact = undefined;
    return;
  }
  const verdict = report.verdict === 'complete' ? 'Complete' : 'Partial';
  routeCoverageFact = `${verdict} for a ${report.corridorNm} nm corridor, checked ${formatClockTime(Date.now())}`;
}
const handoff = createHandoffController({
  client: () => handoffClient,
  drafts: handoffDrafts,
  collectFacts: () =>
    collectHandoffFacts({
      now: Date.now,
      fix: () => ({
        received: vessel.positionReceived,
        stale: vessel.positionStale,
        epochMs: vessel.positionEpochMs ?? 0,
      }),
      course: () => ({
        destination: courseGuidance.active
          ? (courseGuidance.nextPointName ?? 'the next point')
          : undefined,
        xteMeters: courseGuidance.crossTrackErrorMeters,
        ttgSeconds: courseGuidance.timeToGoSeconds,
        ttgBasis: courseGuidance.timeToGoBasis,
      }),
      alarms: () => ({
        raised: genericAlarms.filter(isRaisedNotification).length,
        worst: worstRaisedNotification(genericAlarms)?.state,
        alarmSilencedUntilMs: alarmSilence.active ? alarmSilence.untilMs : undefined,
        collisionMutedUntilMs: collisionMute.active
          ? Date.now() + collisionMute.remainingMs
          : undefined,
      }),
      collision: () => ({
        worst: collision.assessment.worst,
        unassessed: collision.assessment.unassessed.length,
        topCpaMeters: collision.assessment.contacts[0]?.cpaMeters,
        topTcpaSeconds: collision.assessment.contacts[0]?.tcpaSeconds,
      }),
      depthWatch: () => shallowController.monitorState,
      radar: () =>
        radarHealth.state === 'quiet'
          ? 'quiet'
          : radarHealth.state === 'stale'
            ? 'transmitting, picture stale'
            : `failed (${radarHealth.reason})`,
      weatherFetchedAtMs: () => chartWeather.grid?.fetchedAt ?? weather.grid?.fetchedAt,
      tides: () =>
        tidesStore.tide !== undefined
          ? 'tide station data loaded'
          : tidesStore.status === 'idle'
            ? 'not loaded'
            : tidesStore.status,
      routeCoverage: () => routeCoverageFact,
      multiSourcePaths: () => {
        // Watch-critical paths a handoff should name when more than one source fed them recently.
        const watched: Array<[string, string]> = [
          ['position', SK_PATHS.position],
          ['heading', SK_PATHS.headingTrue],
          ['depth', vessel.safetyDepth.path],
        ];
        const now = Date.now();
        const entries: Array<{ name: string; refs: string[] }> = [];
        for (const [name, path] of watched) {
          const refs = recentSourceRefs(store.cell(path).sourceSamples, now);
          if (refs.length > 0) entries.push({ name, refs });
        }
        return entries;
      },
    }),
});
// Reconnect synchronization: a draft taken offline reaches the other stations as soon as the
// browser is back online, without a manual step.
$effect(() => {
  if (net.online) void handoff.syncDrafts();
});

// Full-screen Instruments is a modal whose aria-modal removes the rest of the app, emergency rail
// included, from the accessibility tree, and no sibling subtree can be exempted from it. So an
// alarm-grade safety event closes the full-screen dock outright, returning the rail and its
// actions to the focus and screen-reader path at the moment they matter. Mirrors time travel's
// exit-on-danger. The docked (non-modal) dock is unaffected.
const emergencySafetyActive = $derived(
  mob.active ||
    (collision.assessment.worst === 'danger' && (!collision.suppressed || collision.escalating)) ||
    anchor.dragging ||
    anchor.fixLostAlarm ||
    genericAlarms.some(
      (notification) => notification.state === 'emergency' || notification.state === 'alarm',
    ),
);
$effect(() => {
  if (!emergencySafetyActive || !instrumentsFullScreen) return;
  if (untrack(() => instruments.open)) untrack(() => instruments.setOpen(false));
});

// The first-run welcome: a compact top banner once the shell is usable, never a panel forced open
// over the chart (a helm display rebooting mid-passage must come back to the chart). It yields to
// any active safety event, hides while Help is open, and Dismiss or the panel's own dismissal
// persists on the device.
const showHelpWelcome = $derived(
  !helpOrientationSeen.value &&
    mapInstance !== undefined &&
    !emergencySafetyActive &&
    activePanel !== 'help',
);

// The region-aware chart offer: in US waters the app already holds everything needed to turn a
// reference-map view into a real chart, and nothing points at it. One dismissible banner, once per
// device. It stays out of the way while any panel is open, so a navigator who has just turned
// their last chart off in the Charts tab is never second-guessed by a banner under the sheet.
// The plain-HTTP warning, dismissible per device: a stock server serves Binnacle over HTTP on the
// LAN, so a permanent banner spends every first impression on the one thing a navigator cannot fix
// from here. Help's Signal K access section carries the durable explanation.
const insecureNoteSeen = new PersistedValue<boolean>(
  binnacleStorageKey('insecureNote'),
  false,
  undefined,
  booleanPersistedCodec,
);
const encPromptSeen = new PersistedValue<boolean>(
  binnacleStorageKey('encPrompt'),
  false,
  undefined,
  booleanPersistedCodec,
);
const showEncPrompt = $derived.by(() =>
  shouldOfferNoaaEnc({
    dismissed: encPromptSeen.value,
    emergencyActive: emergencySafetyActive,
    panelOpen: activePanel !== null,
    layers: layersView?.items,
    position: vessel.position,
    positionStale: vessel.positionStale,
  }),
);
function enableNoaaEnc(): void {
  // The manager honors the pinned floor, restores remembered sub-layers, and persists the choice,
  // so turning the chart on is one call and survives a reload.
  layersView?.toggle(NOAA_ENC_SOURCE_ID, true);
  encPromptSeen.set(true);
}

// The one spoken safety channel: structured events in fixed priority order, worst-first speech,
// polite delivery for the rest. The per-channel alert strings stay owned by their controllers.
const safetyAnnunciator = createSafetyAnnunciator();
$effect(() => {
  safetyAnnunciator.update([
    { id: 'mob', rank: 0, text: mobController.mobAlert },
    { id: 'collision', rank: 1, text: collisionAlert },
    { id: 'anchor', rank: 2, text: anchorController.anchorAlert },
    { id: 'shallow', rank: 3, text: shallowController.alert },
    { id: 'notification', rank: 4, text: genericNotificationAlert },
  ]);
});

const wayfindingController = createWayfindingController({
  origin,
  getToken: () => chartsToken,
  onSaved: async (routeId) => {
    await routeController.refreshRoutes();
    routeStore.toggleShown(routeId, true);
    routeController.showRoute(routeId);
  },
});

// The app menu's options, grouped into helm-first intent groups: chart controls and navigation,
// safety, weather, instruments, optional offline charts, and settings. Adding an option is a single
// entry; the launcher renders and groups whatever it is given.
const menuItems = $derived<MenuItem[]>([
  {
    id: 'center',
    label: 'Center on boat',
    shortLabel: 'Center',
    icon: LocateFixed,
    group: 'Chart',
    fixedToBar: true,
    disabled: !mapCommands || !vessel.position || vessel.positionStale,
    disabledLabel: !mapCommands
      ? 'Center (chart is loading)'
      : vessel.positionStale
        ? 'Center needs a fresh GPS fix.'
        : 'Center needs a GPS position.',
    onSelect: () => mapCommands?.centerOnVessel(),
  },
  {
    id: 'follow',
    label: 'Follow boat',
    shortLabel: 'Follow',
    icon: Navigation,
    group: 'Chart',
    // While armed, the tile stays enabled through a stale fix so follow can still be toggled off
    // during a GPS outage without panning the chart.
    disabled: !mapCommands || (!follow.following && (!vessel.position || vessel.positionStale)),
    disabledLabel: !mapCommands
      ? 'Follow (chart is loading)'
      : vessel.positionStale
        ? 'Follow needs a fresh GPS fix.'
        : 'Follow needs a GPS position.',
    pressed: follow.following,
    onSelect: () => follow.toggle(),
  },
  {
    id: 'orientation',
    // One label voice with its siblings; the current mode rides the quiet sublabel line, and the
    // bar pill keeps the bare mode name, which flips on tap and so reveals the cycling itself.
    label: 'Orientation',
    sublabel: ORIENTATION_TILE_LABELS[chartOrientation.value],
    shortLabel: ORIENTATION_TILE_LABELS[chartOrientation.value],
    icon: Compass,
    group: 'Chart',
    disabled: !mapCommands,
    disabledLabel: 'Orientation (chart is loading)',
    pressed: chartOrientation.value !== 'north',
    onSelect: cycleOrientation,
  },
  {
    id: 'layers',
    label: 'Layers and charts',
    shortLabel: 'Charts',
    icon: Layers,
    group: 'Chart',
    disabled: !layersView,
    disabledLabel: 'Layers and charts (chart is loading)',
    pressed: activePanel === 'layers',
    onSelect: () => {
      // Request the Charts tab only when this tile OPENS the panel; a toggle that closes it must
      // not reset the tab the navigator was on.
      if (activePanel !== 'layers') layersOpenRequest = { mode: 'charts' };
      togglePanel('layers');
    },
  },
  // Keep this safety-relevant capability discoverable even when its optional provider is absent. The
  // tile explains the exact requirement instead of disappearing, then becomes the single landing
  // place for saved areas, automatic caching, installed charts, and storage when Chart Locker appears.
  {
    id: 'regions',
    label: 'Offline charts',
    shortLabel: 'Offline',
    icon: DownloadCloud,
    group: 'Chart',
    available: companionBase !== null,
    unavailableHint:
      companionProbe === undefined
        ? 'Checking whether Chart Locker is available on the Signal K server.'
        : companionProbe.state === 'access-refused'
          ? 'Signal K refused access to Chart Locker. Sign in to Signal K administration, then approve Binnacle read access on a secured server.'
          : companionProbe.state === 'absent'
            ? 'Install and start signalk-chart-locker from the Signal K Appstore to enable offline charts.'
            : 'Chart Locker could not be reached. Check the Signal K connection and Chart Locker service, then retry.',
    pressed: activePanel === 'regions' || activePanel === 'charts-management',
    // The landing panel draws saved-area bounds on the chart, so wait for MapLibre once the provider
    // exists. An absent provider uses available rather than disabled so tapping explains the setup.
    disabled:
      (companionBase !== null && mapInstance === undefined) ||
      marineRadar.store.areaDraft?.chartEditing === true,
    disabledLabel:
      marineRadar.store.areaDraft?.chartEditing === true
        ? 'Offline charts (finish the radar-area chart edit first)'
        : 'Offline charts (chart is loading)',
    onSelect: () => togglePanel('regions'),
  },
  {
    id: 'wayfinding',
    label: 'Sail Wayfinder',
    shortLabel: 'Wayfinder',
    icon: Compass,
    group: 'Navigate',
    available: wayfindingController.capabilities?.ready !== false,
    unavailableHint:
      wayfindingController.error ??
      wayfindingController.capabilities?.unavailableReason ??
      'Check Sail Wayfinder readiness for details.',
    pressed: activePanel === 'wayfinding',
    onSelect: () => togglePanel('wayfinding'),
  },
  {
    id: 'routes',
    label: 'Routes',
    icon: Route,
    group: 'Navigate',
    disabled: !mapCommands,
    disabledLabel: 'Routes (chart is loading)',
    pressed: activePanel === 'routes',
    onSelect: () => togglePanel('routes'),
  },
  {
    id: 'waypoints',
    label: 'Waypoints',
    icon: MapPin,
    group: 'Navigate',
    pressed: activePanel === 'waypoints',
    onSelect: () => togglePanel('waypoints'),
  },
  {
    id: 'tracks',
    label: 'Tracks',
    icon: Spline,
    group: 'Navigate',
    fixedToBar: true,
    pressed: activePanel === 'tracks',
    onSelect: () => togglePanel('tracks'),
  },
  // Playback is not a LeftPanel; it has its own active flag and enter and exit API. It grays like
  // the radar tile when no history provider is known, rather than opening to an empty mode. It
  // sits beside Tracks so the two answers to "where was I?" are one neighborhood.
  {
    id: 'time-travel',
    label: 'Playback',
    icon: History,
    group: 'Navigate',
    available: (historyProviders?.ids.length ?? 0) > 0,
    unavailableHint:
      historyProviderState === 'checking' || historyProviderState === 'retrying'
        ? 'Checking for a Signal K history provider.'
        : historyProviderState === 'failed'
          ? 'Could not check for a history provider. Reconnect or reload to check again.'
          : 'Playback needs a history provider plugin on the server, such as signalk-questdb.',
    pressed: timeTravel.active,
    onSelect: () => (timeTravel.active ? timeTravel.exit() : void timeTravel.enter()),
  },
  {
    id: 'poi-search',
    label: 'Find places',
    shortLabel: 'Places',
    icon: Search,
    group: 'Navigate',
    pressed: activePanel === 'poi-search',
    // Find places and its chart markers share the notes overlay. Opening the search therefore
    // reveals that layer instead of presenting an empty list controlled by a hidden setting.
    onSelect: () => {
      if (activePanel === 'poi-search') {
        closePoiSearch();
      } else {
        openPanel('poi-search');
        setLayerVisible('notes', true);
      }
    },
  },
  {
    id: 'moorings',
    label: 'Moorings',
    icon: Anchor,
    group: 'Navigate',
    pressed: activePanel === 'moorings',
    disabled: !mapCommands,
    disabledLabel: 'Moorings (chart is loading)',
    onSelect: () => {
      if (activePanel === 'moorings') {
        closePanel();
      } else {
        openPanel('moorings');
        setLayerVisible('moorings', true);
      }
    },
  },
  // Measure remains armed when selected again; pressed reflects the active state.
  {
    id: 'measure',
    label: 'Measure',
    icon: Ruler,
    group: 'Navigate',
    // Also disabled until the chart's tap handler is ready (mapInstance is set after the tap
    // recognizer registers), so Measure can never advertise a first tap that would be dropped.
    disabled:
      mapInstance === undefined ||
      routeStore.working !== undefined ||
      marineRadar.store.areaDraft?.chartEditing === true,
    disabledLabel:
      mapInstance === undefined
        ? 'Measure (chart is loading)'
        : marineRadar.store.areaDraft?.chartEditing === true
          ? 'Measure (finish the radar-area chart edit first)'
          : 'Measure (save or cancel the route edit first)',
    pressed: measure.active,
    onSelect: armMeasure,
  },
  {
    id: 'ais',
    label: 'Nearby vessels (AIS)',
    shortLabel: 'AIS',
    // Danger-grade contacts only: the warning grade is "getting close", not a collision risk, and
    // a closed panel that claims one would be crying wolf.
    count: collision.assessment.contacts.filter((c) => c.severity === 'danger').length,
    countNoun: 'collision risk',
    icon: Ship,
    group: 'Safety',
    pressed: activePanel === 'ais',
    onSelect: () => togglePanel('ais'),
  },
  // The radar tile is always present: when no radar is discovered it grays out with a hover hint
  // rather than vanishing, matching the radar layer row and the other detect-and-degrade overlays
  // (track history, AIS trails) so a capability never silently disappears. It opens the same controls
  // panel reached from the radar layer row's gear.
  {
    id: 'radar',
    label: 'Radar',
    icon: Radar,
    group: 'Safety',
    available: marineRadar.store.hasRadar,
    unavailableHint: marineRadar.store.unavailableHint,
    pressed: radarControlsOpen,
    onSelect: toggleRadarControlsFromMenu,
  },
  {
    id: 'anchor',
    label: 'Anchor watch',
    shortLabel: 'Anchor',
    icon: Anchor,
    group: 'Safety',
    pressed: activePanel === 'anchor',
    onSelect: () => togglePanel('anchor'),
  },
  {
    id: 'alarms',
    label: 'Alarms',
    sublabel: alarmSilence.active
      ? `Sound muted, ${formatDuration(alarmSilence.remainingSeconds)} left`
      : undefined,
    icon: Bell,
    group: 'Safety',
    pressed: activePanel === 'alarms',
    count: genericAlarms.length,
    countNoun: 'alarm',
    onSelect: () => togglePanel('alarms'),
  },
  {
    id: 'handoff',
    label: 'Watch handoff',
    shortLabel: 'Handoff',
    icon: ClipboardList,
    group: 'Safety',
    pressed: activePanel === 'handoff',
    onSelect: () => togglePanel('handoff'),
  },
  {
    id: 'observed-wind-stations',
    label: 'Observed wind stations',
    shortLabel: 'Observed wind',
    sublabel: 'Show measured NOAA buoy, coastal, and METAR wind on the main chart',
    icon: Wind,
    group: 'Weather',
    pressed: layerSettings.value[WEATHER_LAYER_IDS.observedWind]?.visible ?? false,
    onSelect: () =>
      setLayerVisible(
        WEATHER_LAYER_IDS.observedWind,
        !(layerSettings.value[WEATHER_LAYER_IDS.observedWind]?.visible ?? false),
      ),
  },
  {
    id: 'tides',
    label: 'Tide instrument',
    shortLabel: 'Tides',
    icon: Waves,
    group: 'Weather',
    pressed: instruments.open && tideInstrumentRequested,
    onSelect: openTideInstrument,
  },
  {
    id: 'instruments',
    label: 'Edit instruments',
    shortLabel: 'Edit instruments',
    icon: Gauge,
    group: 'Instruments',
    toolbarEligible: false,
    pressed: instruments.screenEditing,
    onSelect: startScreenInstrumentEditing,
  },
  {
    id: 'trends',
    label: 'Data trends',
    shortLabel: 'Trends',
    icon: ChartLine,
    group: 'Instruments',
    pressed: activePanel === 'trends',
    onSelect: () => {
      trends.setFocus(undefined);
      trendReturnInstrumentId = undefined;
      togglePanel('trends');
    },
  },
  {
    id: 'profiles',
    label: 'Profiles',
    // Units, sync, and device privacy all live inside the profiles panel, and a navigator looking
    // for feet instead of meters scans Settings for the word Units, not for Profiles.
    sublabel: 'Units, sync, and privacy',
    icon: UserCog,
    group: 'Settings',
    pressed: activePanel === 'profiles',
    onSelect: () => togglePanel('profiles'),
  },
  {
    id: 'command-palette',
    label: 'Command palette',
    sublabel: 'Search actions with Command K or Control K',
    icon: Search,
    group: 'Settings',
    onSelect: openCommandPalette,
  },
  {
    id: 'screen-wake-lock',
    label: screenWakeLockEnabled.value ? 'Allow screen sleep' : 'Keep screen awake',
    sublabel: screenWakeLockEnabled.value
      ? 'Screen stays on while Binnacle is visible'
      : 'Allow this display to sleep normally',
    icon: Sun,
    group: 'Settings',
    toolbarEligible: false,
    pressed: screenWakeLockEnabled.value,
    onSelect: () => screenWakeLockEnabled.set(!screenWakeLockEnabled.value),
  },
  {
    id: 'theme',
    label: 'Appearance',
    sublabel: `Current theme: ${theme.theme}`,
    icon: Sun,
    group: 'Settings',
    toolbarEligible: false,
    onSelect: () => theme.cycle(),
  },
  {
    id: 'lock-interface',
    label: 'Lock controls',
    sublabel: 'Prevent accidental chart changes',
    icon: Lock,
    group: 'Safety',
    toolbarEligible: false,
    onSelect: interfaceLock.lock,
  },
  {
    id: 'help',
    label: 'Help',
    icon: CircleHelp,
    group: 'Settings',
    pressed: activePanel === 'help',
    onSelect: () => togglePanel('help'),
  },
]);

// The rail has shell actions that do not belong in the normal app-menu registry. Its Customize
// mode receives this dedicated registry, so every ordinary bottom button can be shown or hidden
// while the two safety controls remain visibly selected and immutable.
const helmButtonItems = $derived<MenuItem[]>([
  {
    id: 'lock',
    label: interfaceLock.locked ? 'Unlock Binnacle' : 'Lock Binnacle',
    shortLabel: 'Lock',
    icon: interfaceLock.locked ? LockOpen : Lock,
    group: 'Bottom buttons',
    onSelect: interfaceLock.locked ? interfaceLock.unlock : interfaceLock.lock,
  },
  ...(!installedPwa
    ? [
        {
          id: 'fullscreen',
          label: 'Toggle full screen',
          shortLabel: 'Full screen',
          icon: Maximize2,
          group: 'Bottom buttons',
          onSelect: () => void toggleBrowserFullScreen(),
        },
      ]
    : []),
  {
    id: 'home',
    label: 'Home',
    icon: House,
    group: 'Bottom buttons',
    onSelect: goHome,
  },
  {
    id: 'weather',
    label: 'Weather and tides',
    icon: CloudSun,
    group: 'Bottom buttons',
    pressed: helmWeatherLayer !== undefined,
    onSelect: cycleHelmWeatherLayer,
  },
  {
    id: 'profiles',
    label: 'Profiles',
    icon: UserCog,
    group: 'Bottom buttons',
    onSelect: () => openPanel('profiles'),
  },
  {
    id: 'instruments',
    label: instrumentsActionLabel(),
    icon: instruments.screenEditing ? Pencil : Gauge,
    group: 'Bottom buttons',
    onSelect: cycleInstruments,
  },
  {
    id: 'supermenu',
    label: actionDialOpen ? 'Close supermenu' : 'Open supermenu',
    shortLabel: 'Menu',
    icon: MenuIcon,
    group: 'Bottom buttons',
    onSelect: () => {
      actionDialContextPoint = undefined;
      actionDialPosition.set({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
      setActionDialOpen(!actionDialOpen);
    },
  },
  {
    id: 'center',
    label: 'Center on vessel',
    shortLabel: 'Center',
    icon: LocateFixed,
    group: 'Bottom buttons',
    disabled: !mapCommands || !vessel.position || vessel.positionStale,
    onSelect: () => mapCommands?.centerOnVessel(),
  },
  {
    id: 'mob',
    label: 'Man overboard',
    icon: LifeBuoy,
    group: 'Always shown',
    fixedToBar: true,
    onSelect: () => void requestMobFromPalette(),
  },
  {
    id: 'alarms',
    label: 'Alarms',
    icon: Bell,
    group: 'Always shown',
    fixedToBar: true,
    count: activeAlarmNotifications.length,
    countNoun: 'alarm',
    onSelect: () => openPanel('alarms'),
  },
]);

const commandPlaces = $derived.by<PlaceSearchItem[]>(() => {
  void aisTargets.version;
  return [
    ...waypointsStore.waypoints.map((waypoint) => ({
      id: `waypoint:${waypoint.id}`,
      name: waypoint.name,
      detail: waypoint.description,
      position: waypoint.position,
      source: 'Waypoint' as const,
    })),
    ...poiNotes.map((note) => ({
      id: `chart:${note.id}`,
      name: note.name,
      detail: note.source ?? note.description,
      position: note.position,
      source: 'Chart layer' as const,
    })),
    ...aisTargets
      .list()
      .filter((target) => target.name)
      .map((target) => ({
        id: `ais:${target.id}`,
        name: target.name ?? target.id,
        detail: target.navigationState,
        position: target.position,
        source: 'AIS' as const,
      })),
  ];
});

function runMenuCommand(item: MenuItem): void {
  item.onSelect();
  menuOpen = false;
}

function openBottomButtonEditor(): void {
  menuEditing = true;
  setMenuOpen(true);
}

// These menu destinations contain persisted preferences, live controls, or both. They remain root
// palette commands, and the shared keywords make "settings" plus the surface name find each one
// directly instead of forcing a trip through the app menu.
const CONFIGURABLE_MENU_ITEM_IDS = new Set([
  'layers',
  'regions',
  'routes',
  'tracks',
  'ais',
  'radar',
  'anchor',
  'alarms',
  'forecast',
  'tides',
  'trends',
  'profiles',
]);

async function toggleBrowserFullScreen(): Promise<void> {
  if (document.fullscreenElement) await document.exitFullscreen();
  else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
}

$effect(() => {
  void screenWakeLockEnabled.value;
  screenWakeLock.refresh();
});

const paletteCommands = $derived.by<CommandPaletteCommand[]>(() => {
  // Opening the palette invalidates this derived list. Read the browser directly at that point,
  // because embedded Chromium can update fullscreenElement after both its event and API promise.
  void commandPaletteOpen;
  const browserFullScreenNow =
    typeof document !== 'undefined' && document.fullscreenElement !== null;
  const menuCommands = menuItems
    .filter((item) => item.id !== 'instruments' && item.id !== 'command-palette')
    .map((item) => ({
      id: `menu:${item.id}`,
      label: item.label,
      description: item.sublabel,
      group: item.group,
      keywords: [
        item.shortLabel ?? '',
        item.group ?? '',
        ...(CONFIGURABLE_MENU_ITEM_IDS.has(item.id)
          ? ['settings', 'configuration', 'preferences', 'adjust']
          : []),
      ],
      icon: item.icon,
      disabled: itemBlocked(item),
      disabledReason: blockedReason(item),
      onSelect: () => runMenuCommand(item),
    }));
  return [
    ...(installedPwa
      ? []
      : [
          {
            id: 'browser-fullscreen',
            label: browserFullScreenNow ? 'Exit full screen' : 'Enter full screen',
            description: browserFullScreenNow
              ? 'Return Binnacle to its browser window'
              : 'Use the entire display for Binnacle',
            group: 'Display',
            keywords: ['fullscreen', 'full-screen', 'screen', 'display'],
            icon: browserFullScreenNow ? Minimize2 : Maximize2,
            disabled:
              typeof document === 'undefined' ||
              (!browserFullScreenNow &&
                typeof document.documentElement.requestFullscreen !== 'function'),
            disabledReason: 'This browser does not offer full-screen mode.',
            onSelect: () => void toggleBrowserFullScreen(),
          },
        ]),
    {
      id: 'go-to',
      label: 'Go to',
      description: 'Search chart layers, waypoints, AIS names, and OpenStreetMap',
      group: 'Navigate',
      keywords: ['find place destination map search'],
      icon: MapPin,
      followUp: {
        placeholder: 'Search for a place, waypoint, or vessel',
        minimumQueryLength: 2,
        search: async (query, signal) => {
          const result = await searchPlaces(query, {
            localItems: commandPlaces,
            signal,
            bias: currentView
              ? { latitude: currentView.lat, longitude: currentView.lon }
              : undefined,
          });
          const commands: CommandPaletteCommand[] = result.items.map((place) => ({
            id: place.id,
            label: place.name,
            description: [place.detail, place.source].filter(Boolean).join(' · '),
            icon: MapPin,
            onSelect: () => {
              if (!mapCommands) {
                toast.show('The chart is still starting. Try Go to again in a moment.');
                return;
              }
              if (instrumentsFullScreen && instruments.open) instruments.setOpen(false);
              mapCommands.flyTo(place.position.latitude, place.position.longitude);
            },
          }));
          if (query.trim().length < 3 && commands.length === 0) {
            commands.push({
              id: 'place-search-keep-typing',
              label: 'Keep typing for online place search',
              description: 'Local waypoint, chart, and AIS names match after two characters.',
              icon: Search,
              disabled: true,
            });
          } else if (result.onlineUnavailable) {
            commands.push({
              id: 'place-search-offline',
              label: result.items.length > 0 ? 'Showing local matches only' : 'No local matches',
              description:
                'Online place search is unavailable. Waypoints, chart names, and AIS names still work offline.',
              icon: Search,
              disabled: true,
            });
          } else if (commands.length === 0) {
            commands.push({
              id: 'place-search-empty',
              label: 'No matching place found',
              description:
                'Try a broader place name or search a saved waypoint, chart name, or AIS vessel.',
              icon: Search,
              disabled: true,
            });
          }
          return commands;
        },
      },
    },
    {
      id: 'basemap-settings',
      label: 'Basemap detail',
      description: 'Choose OpenFreeMap detail layers and rendering quality',
      group: 'Chart',
      keywords: ['OpenStreetMap', 'OpenFreeMap', 'performance', 'speed', 'quality', 'layers'],
      icon: Layers,
      disabled: !layersView,
      disabledReason: 'Basemap settings need the chart to finish loading.',
      onSelect: () => {
        layersOpenRequest = { mode: 'charts', target: 'basemap' };
        openPanel('layers');
      },
    },
    {
      id: 'ais-display-settings',
      label: 'AIS display',
      description: 'Set vessel symbols, name labels, and stale-target retention',
      group: 'Chart',
      keywords: [
        'targets',
        'traffic',
        'names',
        'labels',
        'stale',
        'fade',
        'expiry',
        'retention',
        'fishing',
      ],
      icon: Layers,
      disabled: !layersView,
      disabledReason: 'AIS display settings need the chart to finish loading.',
      onSelect: () => {
        layersOpenRequest = { mode: 'overlays' };
        openPanel('layers');
        aisDisplaySettingsRequest += 1;
      },
    },
    {
      // A root entry, not a child of instruments-layout: placing instruments on the chart is its
      // own surface. The label deliberately does not begin with "Instruments", so the "adjustable
      // surfaces" palette case still matches exactly one /^Instruments / option.
      id: 'instrument-screen-edit',
      label: instruments.screenEditing ? 'Lock screen instruments' : 'Edit screen instruments',
      description: 'Place instruments anywhere on the chart',
      group: 'Instruments',
      keywords: ['settings', 'configuration', 'layout', 'place', 'drag', 'floating', 'overlay'],
      icon: Expand,
      onSelect: () =>
        instruments.screenEditing ? exitScreenInstrumentEditing() : startScreenInstrumentEditing(),
    },
    {
      id: 'wind-forecast-overlay',
      label: `Cycle weather and tide overlay (${helmWeatherLayerName(helmWeatherLayer)})`,
      description:
        'Cycle combined conditions, wind and gusts, ocean currents, tide and current stations, temperature, UV index, and off on the main chart',
      group: 'Weather',
      keywords: [
        'conditions',
        'sea state',
        'waves',
        'wind',
        'gust',
        'ocean current',
        'tide',
        'temperature',
        'UV',
        'forecast',
        'overlay',
        'layer',
      ],
      icon: Wind,
      onSelect: cycleHelmWeatherLayer,
    },
    {
      id: 'observed-wind-stations-overlay',
      label: layerSettings.value[WEATHER_LAYER_IDS.observedWind]?.visible
        ? 'Hide observed wind stations'
        : 'Show observed wind stations',
      description: 'Show measured NOAA buoy, coastal, and METAR wind observations on the chart',
      group: 'Weather',
      keywords: ['wind', 'observed', 'stations', 'buoy', 'noaa', 'overlay'],
      icon: Wind,
      onSelect: () =>
        setLayerVisible(
          WEATHER_LAYER_IDS.observedWind,
          !(layerSettings.value[WEATHER_LAYER_IDS.observedWind]?.visible ?? false),
        ),
    },
    {
      id: 'wind-sources-both',
      label: 'Show forecast and observed wind',
      description: 'Show the forecast wind field together with measured station observations',
      group: 'Weather',
      keywords: ['wind', 'forecast', 'observed', 'both', 'stations'],
      icon: Wind,
      onSelect: () => {
        setLayerVisible(WEATHER_LAYER_IDS.wind, true);
        setLayerVisible(WEATHER_LAYER_IDS.observedWind, true);
      },
    },
    {
      id: 'trip-log-toggle',
      label: tripLogEnabled(trackSettings.value) ? 'Disable trip log' : 'Enable trip log',
      description: tripLogEnabled(trackSettings.value)
        ? 'Hide daily travel, direction, portions, and stops from the chart'
        : 'Show daily travel, direction, portions, and stops on the chart',
      group: 'Navigate',
      keywords: ['tracks', 'history', 'travel', 'breadcrumb'],
      icon: Spline,
      onSelect: () =>
        trackSettings.set({
          ...trackSettings.value,
          tripLogEnabled: !tripLogEnabled(trackSettings.value),
        }),
    },
    {
      id: 'settings',
      label: 'Settings',
      description: 'Open the settings menu',
      group: 'Settings',
      keywords: ['configuration preferences'],
      icon: Settings,
      onSelect: backToMenu,
    },
    {
      id: 'ais-radar-instrument',
      label: 'AIS radar',
      description: `Open traffic radar and range controls, currently ${aisRadarRangeNm.value} nm`,
      group: 'Instruments',
      keywords: ['traffic', 'targets', 'CPA', 'TCPA', 'range', 'configuration'],
      icon: Radar,
      onSelect: openAisRadarInstrument,
    },
    {
      id: 'wind-rose-settings',
      label: 'Wind rose settings',
      description: `Set the no-go sector and apparent-wind fallback margin, currently ${Math.round((windRoseNoGoAngleRad.value * 180) / Math.PI)}° and ±${Math.round((windRoseArcMarginRad.value * 180) / Math.PI)}°`,
      group: 'Instruments',
      keywords: ['wind', 'rose', 'no-go', 'angle', 'sailing', 'configuration'],
      icon: Compass,
      onSelect: openWindRoseSettings,
    },
    {
      id: 'tide-station-settings',
      label: 'Tide station settings',
      description: 'Choose tide and tidal-current stations',
      group: 'Settings',
      keywords: ['tides', 'NOAA', 'station', 'configuration'],
      icon: Waves,
      onSelect: openTideStationSettings,
    },
    {
      id: 'theme',
      label: 'Appearance',
      description: `Current theme: ${theme.theme}`,
      group: 'Settings',
      icon: Sun,
      children: [
        { id: 'theme-day', label: 'Day theme', icon: Sun, onSelect: () => theme.set('day') },
        { id: 'theme-dusk', label: 'Dusk theme', icon: Moon, onSelect: () => theme.set('dusk') },
        {
          id: 'theme-night',
          label: 'Night red theme',
          icon: Moon,
          onSelect: () => theme.set('night-red'),
        },
      ],
    },
    {
      id: 'customize-bottom-buttons',
      label: 'Customize bottom buttons',
      description: 'Choose which helm controls are shown; Man overboard and Alarms stay fixed',
      group: 'Display',
      keywords: ['toolbar', 'helm', 'buttons', 'show', 'hide', 'configuration'],
      icon: MenuIcon,
      onSelect: openBottomButtonEditor,
    },
    {
      id: 'bottom-toolbar-labels',
      label: bottomToolbarLabels.value
        ? 'Hide bottom toolbar labels'
        : 'Show bottom toolbar labels',
      description: bottomToolbarLabels.value
        ? 'Use icons only in the bottom toolbar'
        : 'Show text beside bottom toolbar icons',
      group: 'Display',
      icon: MenuIcon,
      onSelect: () => bottomToolbarLabels.set(!bottomToolbarLabels.value),
    },
    {
      id: 'lock-interface',
      label: interfaceLock.locked ? 'Unlock Binnacle' : 'Lock Binnacle',
      description: interfaceLock.locked
        ? 'Restore helm controls'
        : 'Prevent accidental helm changes',
      group: 'Safety',
      icon: interfaceLock.locked ? LockOpen : Lock,
      onSelect: interfaceLock.locked ? interfaceLock.unlock : interfaceLock.lock,
    },
    {
      id: 'mob',
      label: 'Man overboard',
      description: mob.position ? 'Fly to the active MOB mark' : 'Open the guarded confirmation',
      group: 'Safety',
      icon: LifeBuoy,
      onSelect: () => void requestMobFromPalette(),
    },
    {
      id: 'about',
      label: 'About Binnacle',
      description: `Version ${__APP_VERSION__}`,
      group: 'Settings',
      icon: CircleHelp,
      onSelect: () => toast.show(`Binnacle Custom version ${__APP_VERSION__}`),
    },
    ...(updateReady
      ? [
          {
            id: 'update',
            label: 'Install update',
            description: 'Reload Binnacle with the ready update',
            group: 'Settings',
            icon: DownloadCloud,
            onSelect: () => {
              updateReady = false;
              pwa.update();
            },
          },
        ]
      : []),
    ...menuCommands,
  ];
});

function uniqueActionIds(actions: MenuItem[]): MenuItem[] {
  return actions.filter(
    (action, index) => actions.findIndex(({ id }) => id === action.id) === index,
  );
}

function uniqueRingActions(actions: MenuItem[]): MenuItem[] {
  const seenIds = new SvelteSet<string>();
  const seenLabels = new SvelteSet<string>();
  return actions.filter((action) => {
    // The ring renders shortLabel when present, so that is the visible intent a navigator sees.
    // A context action, such as Measure from here, therefore replaces its generic Measure sibling.
    const label = (action.shortLabel ?? action.label).trim().toLocaleLowerCase();
    if (seenIds.has(action.id) || seenLabels.has(label)) return false;
    seenIds.add(action.id);
    seenLabels.add(label);
    return true;
  });
}

function mobAction(): MenuItem {
  return {
    id: 'mob',
    label: mob.position ? 'Find MOB mark' : 'Man overboard',
    shortLabel: 'MOB',
    icon: LifeBuoy,
    group: 'Safety',
    onSelect: () => void requestMobFromPalette(),
  };
}

const actionDialContextActions = $derived.by<MenuItem[]>(() => {
  if (actionDialContextPoint) {
    const point = actionDialContextPoint;
    const chartActions: MenuItem[] = [
      {
        id: 'go-to-here',
        label: 'Go to here',
        shortLabel: 'Go to',
        icon: Navigation,
        group: 'Chart location',
        onSelect: () => void routeController.onGoToHere(point),
      },
      {
        id: 'start-route-here',
        label: 'Start route here',
        shortLabel: 'Route',
        icon: Route,
        group: 'Chart location',
        onSelect: () => onStartRouteHere(point),
      },
      {
        id: 'drop-waypoint',
        label: 'Drop waypoint',
        shortLabel: 'Waypoint',
        icon: MapPin,
        group: 'Chart location',
        onSelect: () => waypointsController.onDropWaypoint(point),
      },
      {
        id: 'add-note',
        label: 'Add note here',
        shortLabel: 'Note',
        icon: ClipboardList,
        group: 'Chart location',
        onSelect: () => personalNotesController.openAdd(point),
      },
      {
        id: 'measure-from-here',
        label: 'Measure from here',
        shortLabel: 'Measure',
        icon: Ruler,
        group: 'Chart location',
        onSelect: () => {
          if (armMeasure(true)) measure.add(point);
        },
      },
      {
        id: 'lock-interface',
        label: 'Lock controls',
        shortLabel: 'Lock',
        icon: Lock,
        group: 'Safety',
        onSelect: interfaceLock.lock,
      },
    ];
    return chartActions;
  }
  return [];
});

const actionDialBuckets = $derived.by<Record<SupermenuBucketId, MenuItem[]>>(() => {
  const all = uniqueActionIds([
    ...menuItems,
    {
      id: 'lock-interface',
      label: 'Lock controls',
      shortLabel: 'Lock',
      icon: Lock,
      group: 'Safety',
      onSelect: interfaceLock.lock,
    },
    {
      id: 'customize-bottom-buttons',
      label: 'Customize bottom buttons',
      shortLabel: 'Bottom buttons',
      icon: MenuIcon,
      group: 'Settings',
      onSelect: openBottomButtonEditor,
    },
    mobAction(),
  ]);
  const buckets: Record<SupermenuBucketId, MenuItem[]> = {
    navigate: [],
    chart: [],
    vessel: [],
    weather: [],
    system: [],
    safety: [],
  };
  const ids: Partial<Record<string, SupermenuBucketId>> = {
    center: 'navigate',
    follow: 'navigate',
    orientation: 'navigate',
    wayfinding: 'navigate',
    routes: 'navigate',
    waypoints: 'navigate',
    moorings: 'navigate',
    layers: 'chart',
    'charts-management': 'chart',
    measure: 'chart',
    'find-places': 'chart',
    instruments: 'vessel',
    ais: 'vessel',
    radar: 'vessel',
    anchor: 'vessel',
    tracks: 'vessel',
    forecast: 'weather',
    tides: 'weather',
    trends: 'weather',
    weather: 'weather',
    profiles: 'system',
    help: 'system',
    settings: 'system',
    'browser-fullscreen': 'system',
    'customize-bottom-buttons': 'system',
    mob: 'safety',
    'lock-interface': 'safety',
    alarms: 'safety',
  };
  for (const item of all) buckets[ids[item.id] ?? 'system'].push(item);
  const instrumentsAction = all.find(({ id }) => id === 'instruments');
  // Showing or hiding instruments changes the chart's working surface, while the instrument dock
  // also belongs with vessel information. Keep the same toggle in both rings so either mental
  // model reaches it without duplicating its state or behavior.
  if (instrumentsAction) buckets.chart.push(instrumentsAction);
  if (actionDialContextActions.length > 0) {
    buckets.chart = [...actionDialContextActions, ...buckets.chart];
  }
  for (const bucket of Object.values(buckets)) {
    bucket.splice(0, bucket.length, ...uniqueRingActions(bucket));
  }
  return buckets;
});

const actionDialActions = $derived.by<MenuItem[]>(() => {
  if (actionDialBucket) {
    return [
      {
        id: 'supermenu-back',
        label: 'Back to menu categories',
        shortLabel: 'Back',
        icon: ArrowLeft,
        closeMenu: false,
        onSelect: () => (actionDialBucket = undefined),
      },
      ...actionDialBuckets[actionDialBucket],
    ];
  }
  const categories: Array<{ id: SupermenuBucketId; label: string; icon: MenuItem['icon'] }> = [
    { id: 'navigate', label: 'Navigate', icon: Navigation },
    { id: 'chart', label: 'Chart', icon: Layers },
    { id: 'vessel', label: 'Vessel', icon: Ship },
    { id: 'weather', label: 'Weather', icon: CloudSun },
    { id: 'system', label: 'System', icon: Settings },
    { id: 'safety', label: 'Safety', icon: LifeBuoy },
  ];
  return categories.map((category) => ({
    id: `supermenu:${category.id}`,
    label: category.label,
    shortLabel: category.label,
    icon: category.icon,
    closeMenu: false,
    onSelect: () => (actionDialBucket = category.id),
  }));
});

// AIS staleness pruning, tied to the app lifecycle; the entity owns the TTL and cadence policy.
$effect(() => aisTargets.startPruning());

function publishDelta(path: string, value: unknown): void {
  void client.publish({ context: SELF_CONTEXT, updates: [{ values: [{ path, value }] }] });
}

// The man-overboard orchestration: the alarm effect, the MOB live-region string, and the trigger,
// cancel, and steer handlers (the v2 postMobNotification route with its v1 delta fallback and the
// in-flight-id cancel race) all live in the controller; the host wires its handlers to the MOB
// button and strip and reads mobController.mobAlert into LiveRegions. The reactive inputs (token,
// notificationsApi) are getters so the controller reads them live, not frozen at construction.
const mobController = createMobController({
  origin,
  getToken: () => chartsToken,
  mob,
  mobAlarm,
  units,
  notificationsApi: () => notificationsApi,
  writeBlocked: () => auth.writeBlocked,
  streamOpen: () => isConnectionOpen(store.connection.phase),
  publishDelta,
  flyTo: (lat, lon) => mapCommands?.flyTo(lat, lon),
  goTo: (position) => routeController.onGoToHere(position),
});

// The anchor-watch orchestration: the position-fix and drag-alarm effects, the anchor live-region
// string, the resolved transport, and the drop, raise, set-radius, and move handlers all live in the
// controller; the host wires its handlers to the anchor panel and chart and reads
// anchorController.anchorError and .anchorAlert. The reactive inputs (token, serverHasAnchorApi) are
// getters so the transport reselects as access and features resolve.
const anchorController = createAnchorController({
  origin,
  getToken: () => chartsToken,
  anchor,
  vessel,
  anchorAlarm,
  serverHasAnchorApi: () => serverFeatures?.apis.has('anchor') ?? false,
  writeBlocked: () => auth.writeBlocked,
});

// A transient action failure (a failed save, activate, delete, and similar) from the route,
// waypoint, or track controllers: shown once, app-wide, and survives the panel that raised it
// closing, unlike each controller's own panel-local error state.
const toast = new Toast();

// Route controller: owns route CRUD, activation, editing, GPX import/export, track-to-route.
const routeController = createRouteController({
  origin,
  getToken: () => chartsToken,
  writeBlocked: () => auth.writeBlocked,
  requestWriteAccess: () => auth.requestWriteAccess(),
  editBlockedReason: () =>
    measure.active
      ? 'Finish the measurement before editing a route.'
      : marineRadar.store.areaDraft?.chartEditing
        ? 'Finish the radar-area chart edit before editing a route.'
        : undefined,
  routeStore,
  courseGuidance,
  flyTo: (lat, lon) => mapCommands?.flyTo(lat, lon),
  fitBounds: (bounds) => mapCommands?.fitBounds(bounds),
  startRouteEdit: (route, initialPoint) => {
    if (!mapCommands) return false;
    mapCommands.startRouteEdit(route, initialPoint);
    return true;
  },
  stopRouteEdit: () => mapCommands?.stopRouteEdit(),
  getTrackPoints: () => recorder.points,
  toast,
});

// Waypoints controller: owns waypoints CRUD.
const waypointsController = createWaypointsController({
  origin,
  getToken: () => chartsToken,
  writeBlocked: () => auth.writeBlocked,
  requestWriteAccess: () => auth.requestWriteAccess(),
  waypointsStore,
  toast,
});

// Personal notes use the standard notes resource and a session-only confirmed-write overlay. Signal K
// remains authoritative; the local store only prevents a follow-up refresh failure from undoing an
// accepted write on the chart.
const personalNotesController = createPersonalNotesController({
  origin,
  getToken: () => chartsToken,
  writeBlocked: () => auth.writeBlocked,
  requestWriteAccess: () => auth.requestWriteAccess(),
  personalNotes: personalNotesStore,
  onSelect: (selection) => selectNote(selection),
  invalidateDetail: (id) => noteLoader?.invalidate(id),
});

// Track controller: owns saved tracks CRUD and display.
const trackController = createTrackController({
  origin,
  getToken: () => chartsToken,
  requestWriteAccess: () => auth.requestWriteAccess(),
  getRecorderPoints: () => recorder.points,
  clearRecorderThrough: (savedThroughT) => recorder.clearThrough(savedThroughT),
  toast,
});

// User charts controller: owns user chart registration and sync.
const userChartsController = createUserChartsController({
  origin,
  getToken: () => chartsToken,
  canWrite: () =>
    (auth.status === 'unsecured' || auth.status === 'authenticated') && !auth.writeBlocked,
  onSyncError: (message) => toast.show(message),
  userCharts,
  recolorMap: (t) => recolorMap?.(t),
  getTheme: () => theme.theme,
});
userCharts.setReplaceHandler(userChartsController.replaceUserChartOverlay);
userCharts.setTransitionHandler(userChartsController.handleUserChartTransition);

// Re-list the layers when an availability-gating provider appears or disappears, so a degrade overlay
// (radar, AIS trails, track history) flips between grayed-out and active without a manual panel reopen.
// The void reads register each value as a reactive dependency so this effect re-runs when any changes.
$effect(() => {
  void serverFeatures;
  void historyProviders;
  void marineRadar.store.radars.length;
  layersView?.refresh();
});

// Record the track from the vessel position (about 1 Hz); the recorder thins by the
// configured interval and min-distance. SOG is stored raw in m/s (SI).
$effect(() => {
  const position = vessel.position;
  const historyReady = historyProviderState === 'available';
  const historyProbeFinished =
    historyProviderState !== 'checking' && historyProviderState !== 'retrying';
  const localRecordingEnabled =
    !preferTrackHistory(trackSettings.value) ||
    (historyProbeFinished && !historyReady && useLocalTrackFallback(trackSettings.value));
  if (localRecordingEnabled && position && !vessel.positionStale) {
    recorder.consider(position.latitude, position.longitude, vessel.sogMps ?? 0);
  }
});

// A fresh install (no saved view at all) otherwise leaves the map at the meaningless whole-world
// default forever, since centering only happens while following (off by default) or via an
// explicit tap: a new user's first impression is an empty planet with no boat on it. Fly to the
// vessel once its first real fix lands instead. Fires at most once per session; a manual pan or
// Follow toggle takes over from there like normal.
let flownToFirstFix = false;
$effect(() => {
  const commands = mapCommands;
  const position = vessel.position;
  if (savedView || flownToFirstFix || !commands || !position || vessel.positionStale) return;
  flownToFirstFix = true;
  commands.flyTo(position.latitude, position.longitude);
});

// Fly the chart to a position: the shared locate action for the MOB mark and AIS list rows.
function flyToPosition(position: LatLon): void {
  mapCommands?.flyTo(position.latitude, position.longitude);
}

function selectAisTarget(id: string | undefined): void {
  if (id && !aisTargets.find(id)) return;
  selectedAisId = id;
  if (id) openPanel('ais');
}

function selectWaypointFromChart(id: string): void {
  if (!waypointsStore.waypoints.some((waypoint) => waypoint.id === id)) return;
  openPanel('waypoints');
  selectedWaypointId = id;
}

function selectMooring(id: string | undefined): void {
  if (id && !moorings.some((mooring) => mooring.id === id)) return;
  selectedMooringId = id;
  if (id) openPanel('moorings');
}

function selectPoi(poi: Poi): void {
  // Same as tapping the marker on the chart: ring it in place (the highlight effect above) and open
  // its detail in the standard note popup, without moving the map.
  selectNote(
    {
      id: poi.id,
      name: poi.name,
      category: poi.category,
      position: poi.position,
      description: poi.description,
      skIcon: poi.skIcon,
      ownedByBinnacle: poi.ownedByBinnacle,
      attribution: poi.attribution,
      url: poi.url,
    },
    true,
  );
}

// Leg-fit pad fraction: the chart eases to show a highlighted leg with a margin around it.
const LEG_FIT_PAD_FRACTION = 0.3;

// Tap a leg row: toggle its cross-highlight, and ease the chart to the leg only when it is not
// already in view, so a tap on a visible leg does not jolt the camera. The dot tap on the chart sets
// the waypoint highlight directly in the chart widget; this is the list side.
function onHighlightLeg(index: number): void {
  const cur = routeStore.highlight;
  if (cur?.kind === 'leg' && cur.index === index) {
    routeStore.clearHighlight();
    return;
  }
  routeStore.setHighlight({ kind: 'leg', index });
  const wps = routeStore.working?.waypoints;
  const a = wps?.[index];
  const b = wps?.[index + 1];
  if (!a || !b) return;
  const view = mapCommands?.getBounds();
  if (view && bboxContainsPoint(view, a.position) && bboxContainsPoint(view, b.position)) return;
  const box = boundsOfPoints([a.position, b.position]);
  if (box) mapCommands?.fitBounds(padBbox(box, LEG_FIT_PAD_FRACTION));
}

// The panel confirms and cancels an in-progress edit before invoking these navigation callbacks.
function closeRoutesPanel(): void {
  routeController.clearRouteError();
  closePanel();
}
function backFromRoutesPanel(): void {
  routeController.clearRouteError();
  backToMenu();
}

function closeTracksPanel(): void {
  closePanel();
}
function backFromTracksPanel(): void {
  backToMenu();
}
function closeWaypointsPanel(): void {
  closePanel();
}
function backFromWaypointsPanel(): void {
  backToMenu();
}

// A waypoint dropped from the chart context menu saves through the dialog above with no waypoints
// panel open; a save failure surfaces on the app-wide toast rather than forcing the panel open just
// to show it, so a chart-side action does not navigate the user away to a list they never asked for.
async function confirmDroppedWaypoint(result: { name: string; icon?: string }): Promise<void> {
  await waypointsController.confirmAddWaypoint(result);
}

// "Mark that spot and go there": save the new mark, then open the Waypoints panel with its card
// current and its navigation confirm armed. Navigation still needs that confirm, which names the
// destination, so nothing starts a course on one tap.
let armNavigateWaypointId = $state<string | undefined>();
async function saveWaypointAndNavigate(result: { name: string; icon?: string }): Promise<void> {
  const saved = await waypointsController.confirmAddWaypoint(result);
  if (!saved) return;
  selectedWaypointId = saved.id;
  armNavigateWaypointId = saved.id;
  openPanel('waypoints');
}

function onStartRouteHere(position: LatLon): void {
  openPanel('routes');
  routeController.beginNewRoute(position);
}

// A brief on-screen arrival cue paired with the tone, for a helm that has the volume low. role=status
// (polite) so a screen reader hears it too, distinct from the assertive collision channel. Cleared
// after a few seconds.
let arrivalBanner = $state<string | undefined>();
let arrivalBannerTimer: ReturnType<typeof setTimeout> | undefined;

// Sound the arrival alarm and request the next point when the boat enters the active arrival circle.
let arrivedLast = false;
// How long the arrival banner stays up before it auto-clears.
const ARRIVAL_BANNER_MS = 8000;
$effect(() => {
  const arrived = courseGuidance.arrived && routeController.courseActive;
  arrivalAlarm.update(
    shouldSoundArrivalAlarm(
      courseGuidance.arrived,
      routeController.courseActive,
      arrivalMuted.value,
    ),
  );
  if (arrived && !arrivedLast) {
    // Rising edge: show the arrival banner for the point just reached, before any auto-advance moves
    // the name on. A single "go to here" has no name, so fall back to a generic label.
    arrivalBanner = courseGuidance.nextPointName ?? 'destination';
    if (arrivalBannerTimer) clearTimeout(arrivalBannerTimer);
    arrivalBannerTimer = setTimeout(() => {
      arrivalBanner = undefined;
    }, ARRIVAL_BANNER_MS);
    // Auto-advance only along a route; a single "go to here" destination has no next point to step to.
    if (routeStore.activeId !== undefined && courseGuidance.canAdvanceRoute) {
      // The streamed activeRoute.pointIndex stays authoritative, so a server that also auto-advances
      // and this request converge on the same active point. A failed advance is surfaced.
      const activeRoute = courseGuidance.activeRouteSnapshot;
      if (activeRoute) routeController.onArrivalAdvance(activeRoute);
    }
  }
  arrivedLast = arrived;
});

function closeNote(): void {
  // The highlight effect clears the chart ring once selectedNote is undefined.
  personalNotesController.clearError();
  selectedNote = undefined;
  noteReturnsToPlaces = false;
  viewHistory.clear();
}
function selectNote(selection: NoteSelection | undefined, fromPlaces = false): void {
  if (selection && selectedNote === undefined) rememberCurrentView();
  personalNotesController.clearError();
  selectedNote = selection;
  noteReturnsToPlaces = Boolean(selection && fromPlaces && narrow);
  // Only yield a leading panel when actually opening a note, not when the selection clears.
  if (narrow && selection) {
    if (activePanel === 'ais') selectedAisId = undefined;
    if (activePanel === 'waypoints') selectedWaypointId = undefined;
    activePanel = null;
  }
}
function backFromNote(): void {
  goBack();
}
// Close the POI search: clear the hovered POI and any open note so the highlight effect drops the
// chart ring and the trailing-edge detail closes with the list, then close the pane.
function closePoiSearch(): void {
  hoveredPoi = undefined;
  selectedNote = undefined;
  noteReturnsToPlaces = false;
  closePanel();
}

function backFromPoiSearch(): void {
  hoveredPoi = undefined;
  selectedNote = undefined;
  noteReturnsToPlaces = false;
  goBack();
}

// Browsers block audio until a user gesture; prime the shared alarm context on gestures so every
// alarm, including ones constructed later, can sound on its own. A real AudioContext resumes
// asynchronously and a browser may reject a given gesture (a bare modifier key, for one), so the
// listeners stay registered and self-remove only once a later gesture finds the context already
// running. Keydown is included so keyboard-only operators get audible alarms too. Pointerup is
// included because pointerdown carries user activation only for a mouse: on a touchscreen the
// activation arrives on release, so a helm tablet's first tap would otherwise be rejected, which
// matters now that the strip states the blocked condition instead of carrying an Enable button.
const primeAudio = () => {
  if (alarmAudioPrimed()) {
    removePrimeListeners();
    return;
  }
  primeAlarmAudio();
};
const removePrimeListeners = () => {
  window.removeEventListener('pointerdown', primeAudio);
  window.removeEventListener('pointerup', primeAudio);
  window.removeEventListener('keydown', primeAudio);
};

// The count of AIS targets the lookout is tracking, so a quiet footer chip confirms the watch is live
// and receiving traffic, rather than leaving the navigator to wonder whether an empty danger strip
// means "all clear" or "not working". list() reads aisVersion, so the derived stays reactive.
const aisCount = $derived(aisTargets.list().length);

// AIS markers are immediately tappable when the first target arrives. Warm their small detail panel
// at that point so a chart selection cannot become the first request for its UI chunk.
$effect(() => {
  if (aisCount === 0) return;
  void loadAisListPanel().catch(() => undefined);
});

// Refresh state that a resubscribed stream cannot replay. The stream controller owns the connection
// edge detection and invokes this composition callback only for a genuine reopen after the first one.
function refreshAfterStreamReconnect(token: string | undefined): void {
  void routeController.refreshRoutes();
  void waypointsController.refreshWaypoints();
  void personalNotesController.probe();
  void refreshWeatherProvider(token);
  void refreshSymbols();
  void fetchServerFeatures(origin, token).then((features) => {
    if (features) serverFeatures = features;
    void marineRadar.start();
  });
  void probeHistoryProviders(
    true,
    untrack(
      () => instruments.historyStatus === 'failed' || instruments.historyStatus === 'partial',
    ),
  );
  if (instruments.open) instruments.refreshLiveCatalog();
  // A reconnect can land on a restarted or reconfigured server, so cached path meta (zones, a
  // declared staleness window) is refetched rather than trusted for the rest of the session.
  shallowController.refreshMeta();
  if (untrack(() => companionBase === null)) refreshCompanionProbe();
  void units.syncFromServer(origin);
  void collisionSettingsSync.hydrate();
  void alarmLocationSettingsSync.hydrate();
  // The MOB replay decision reads the mirror, so it runs behind the mirror reconcile: before
  // it, the pre-outage mirror still shows the raise a restarted server has already lost, and
  // the replay guard would skip the re-raise every other station needs.
  void notificationsController
    .reconcileAfterReconnect(token)
    .then(() => mobController.onStreamReconnect());
}

// A replacement Web Worker starts its internal connection counter from zero. Offset each worker's
// frames into one page-lifetime sequence so late callbacks can be rejected without making a restarted
// worker look older than the worker it replaced.
let workerGenerationBase = 0;
// Incremented by the provider's resources.charts.* stream event. PlotterView turns the edge into a
// server-chart discovery pass, which swaps an immutable generation URL in place without reloading
// Binnacle. The chart canvas retains a slow polling fallback for providers that emit no event.
let chartCatalogRevision = $state(0);
const streamController = createStreamController({
  client,
  store,
  net,
  accessResolved: () => accessResolved,
  token: () => authToken,
  onToken: (token) => {
    chartsToken = token;
    noteLoader = createNoteDetailLoader(origin, () => chartsToken);
  },
  onFrame: (frame) => {
    const generation =
      frame.generation === undefined
        ? Math.max(store.generation, workerGenerationBase)
        : workerGenerationBase + frame.generation;
    // Assigned, not spread: the frame is a fresh structured clone this callback owns, and the
    // spread rebuilt it once per flush on a documented hot path.
    frame.generation = generation;
    if (!store.applyFrame(frame)) return;
    let chartCatalogChanged = false;
    for (const [path, value] of frame.self) {
      marineRadar.applyControlDelta(path, value);
      if (path.startsWith(SK_PATHS.chartResourcesPrefix)) chartCatalogChanged = true;
    }
    if (chartCatalogChanged) chartCatalogRevision += 1;
  },
  // The open edge is the whole connect-and-reconnect story: every open re-hydrates the course
  // (the one edge tied to the socket actually delivering; hydrateAndSeedCourse serializes
  // overlapping calls), the first open replays a MOB raise or clear published before the socket
  // ever opened (a cold helm display against a still-booting server), and every later open runs
  // the reconnect refresh chain, whose notification reconcile replays MOB after the mirror
  // settles.
  onOpen: (firstOpen, token) => {
    void hydrateAisSnapshot(store, origin, token);
    void routeController.hydrateAndSeedCourse();
    if (firstOpen) mobController.onStreamReconnect();
    else refreshAfterStreamReconnect(token);
  },
  onWorkerRestart: () => {
    workerGenerationBase = store.generation + 1;
    instruments.resubscribe();
    trends.resubscribe();
  },
});

// Detect a configured Signal K weather provider so the panel can prefer it over the free sources.
// undefined means the TRANSPORT failed (a 401 before the token landed, a slow server): keep the
// current value and let the next trigger retry, so one bad probe cannot lock the whole session
// onto the free fallback. An answered {} genuinely means no provider and clears it.
async function refreshWeatherProvider(token: string | undefined): Promise<void> {
  const providers = await fetchWeatherProviders(origin, token);
  if (providers !== undefined) weatherProvider = defaultProvider(providers);
}

// Keyed on the auth token rather than run once at first connect, so a token that arrives later
// (an approval from another tab) or changes re-detects with the right credentials.
$effect(() => {
  collisionSettingsSync.observe(thresholds.value);
});

$effect(() => {
  alarmLocationSettingsSync.observe(alarmLocation.value);
});

$effect(() => {
  if (!accessResolved) return;
  // A write-access approval changes auth.token without reconnecting the stream, and chartsToken
  // seeds only at first connect, so mirror it here or every REST write keeps using the stale
  // read-only token and 401s.
  chartsToken = authToken;
  // Saved tracks are HTTP resources, so load them even when the live WebSocket cannot connect.
  void trackController.refreshSavedTracks();
  // Routes are HTTP resources too. Course hydration remains tied to the stream lifecycle.
  void routeController.refreshRoutes();
  // Waypoints are HTTP resources too, so do not make their first load depend on the live stream.
  void waypointsController.refreshWaypoints();
  // Personal-note writes are v2-only. Recheck capability when credentials change so a newly
  // approved token or enabled provider updates the editor without a reload.
  void personalNotesController.probe();
  void refreshWeatherProvider(authToken);
  // Resolve the server's unit preferences with the same trigger: per-user resolution rides on the
  // session credentials that exist once access has resolved.
  void units.syncFromServer(origin);
  void collisionSettingsSync.hydrate();
  void alarmLocationSettingsSync.hydrate();
  // Capability discovery; a transport failure keeps the current value so one bad probe cannot
  // drop the session back to v1 transports.
  void fetchServerFeatures(origin, authToken).then((features) => {
    if (features) serverFeatures = features;
    void marineRadar.start();
  });
  // The onMount probe runs before this token is available, so an auth-gated companion (Chart
  // Locker) 401s once and is never retried; redo it here once real credentials exist. Untracked:
  // the base this same call resolves would otherwise become a dependency, re-running this whole
  // effect (and re-firing every probe above) a second time on the first successful detection.
  if (untrack(() => companionBase === null)) refreshCompanionProbe();
  // History provider discovery: the v2 features list reports the history API even with no
  // provider registered, so the providers route is the real signal.
  // The probe reads and updates provider state internally. The auth token is already an explicit
  // dependency above, so keep those internal reads from feeding the effect back into itself.
  untrack(() => void probeHistoryProviders(false, true));
  symbolsStore.setAuth(authToken);
  void refreshSymbols();
});

const PROFILE_LOCAL_STARTUP_FALLBACK_MS = 8_000;
const BACK_SWIPE_EDGE_PX = 32;
const BACK_SWIPE_DISTANCE_PX = 72;

onMount(() => {
  // A chartplotter can remain open on deck all day. Poll for a newer service worker so the Update
  // action appears promptly, but never activate it here: applying a build remains an explicit helm
  // decision through the visible Update button.
  pwa.checkForUpdate();
  screenWakeLock.start();
  const pwaUpdateCheck = window.setInterval(() => pwa.checkForUpdate(), PWA_UPDATE_CHECK_MS);
  refreshCompanionProbe();
  companionStatus.start();
  const removeBrowserZoomGuard = installBrowserZoomGuard();
  window.addEventListener('pointerdown', primeAudio);
  window.addEventListener('pointerup', primeAudio);
  window.addEventListener('keydown', primeAudio);
  // Safari reserves the extreme edge for browser navigation in a tab. In the installed standalone
  // app it reaches us, and this recognition turns it into display-local view history. It never
  // intercepts a map drag on the base chart because there is no previous Binnacle view to restore.
  let backSwipe: { pointerId: number; startX: number; startY: number } | undefined;
  const beginBackSwipe = (event: PointerEvent): void => {
    if (
      event.pointerType === 'mouse' ||
      !event.isPrimary ||
      event.clientX > BACK_SWIPE_EDGE_PX ||
      !viewHistory.canGoBack
    ) {
      return;
    }
    backSwipe = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY };
  };
  const finishBackSwipe = (event: PointerEvent): void => {
    if (!backSwipe || backSwipe.pointerId !== event.pointerId) return;
    const { startX, startY } = backSwipe;
    backSwipe = undefined;
    const horizontal = event.clientX - startX;
    const vertical = Math.abs(event.clientY - startY);
    if (horizontal >= BACK_SWIPE_DISTANCE_PX && horizontal > vertical * 1.5) goBack();
  };
  const cancelBackSwipe = (): void => {
    backSwipe = undefined;
  };
  // iPadOS cancels Pointer Events once Safari starts interpreting a horizontal pan. Touch Events
  // stay available long enough to claim an intentional edge-back gesture, so use them whenever
  // the platform provides them and retain Pointer Events for non-touch browsers.
  const usesTouchEvents = typeof TouchEvent !== 'undefined';
  let touchBackSwipe: { identifier: number; startX: number; startY: number } | undefined;
  const beginTouchBackSwipe = (event: TouchEvent): void => {
    const touch = event.changedTouches.item(0);
    if (!touch || touch.clientX > BACK_SWIPE_EDGE_PX || !viewHistory.canGoBack) return;
    touchBackSwipe = { identifier: touch.identifier, startX: touch.clientX, startY: touch.clientY };
  };
  const moveTouchBackSwipe = (event: TouchEvent): void => {
    if (!touchBackSwipe) return;
    const touch = Array.from(event.changedTouches).find(
      ({ identifier }) => identifier === touchBackSwipe?.identifier,
    );
    if (!touch) return;
    const horizontal = touch.clientX - touchBackSwipe.startX;
    const vertical = Math.abs(touch.clientY - touchBackSwipe.startY);
    // Claim only a decisive rightward gesture. Vertical chart interaction and ordinary map pans
    // remain untouched, while preventing Safari from cancelling the pending end event.
    if (horizontal >= 12 && horizontal > vertical * 1.5) event.preventDefault();
  };
  const finishTouchBackSwipe = (event: TouchEvent): void => {
    if (!touchBackSwipe) return;
    const touch = Array.from(event.changedTouches).find(
      ({ identifier }) => identifier === touchBackSwipe?.identifier,
    );
    const swipe = touchBackSwipe;
    touchBackSwipe = undefined;
    if (!touch) return;
    const horizontal = touch.clientX - swipe.startX;
    const vertical = Math.abs(touch.clientY - swipe.startY);
    if (horizontal >= BACK_SWIPE_DISTANCE_PX && horizontal > vertical * 1.5) goBack();
  };
  const cancelTouchBackSwipe = (): void => {
    touchBackSwipe = undefined;
  };
  if (usesTouchEvents) {
    window.addEventListener('touchstart', beginTouchBackSwipe, { capture: true, passive: true });
    window.addEventListener('touchmove', moveTouchBackSwipe, { capture: true, passive: false });
    window.addEventListener('touchend', finishTouchBackSwipe, { capture: true, passive: true });
    window.addEventListener('touchcancel', cancelTouchBackSwipe, { capture: true, passive: true });
  } else {
    window.addEventListener('pointerdown', beginBackSwipe, { passive: true });
    window.addEventListener('pointerup', finishBackSwipe, { passive: true });
    window.addEventListener('pointercancel', cancelBackSwipe, { passive: true });
  }
  const onCommandPaletteShortcut = (event: KeyboardEvent): void => {
    if (event.key.toLocaleLowerCase() !== 'k' || (!event.metaKey && !event.ctrlKey)) return;
    event.preventDefault();
    if (commandPaletteOpen) commandPaletteOpen = false;
    else openCommandPalette();
    menuOpen = false;
  };
  window.addEventListener('keydown', onCommandPaletteShortcut);
  // The auth controller owns the focus and cross-tab listeners that pick up an approval.
  auth.watch();
  void auth.probe().finally(() => {
    // A transport failure leaves auth unknown. Treat the completed probe as enough evidence to start
    // locally, so a first-run offline PWA still gets an active profile and autosave.
    if (auth.status === 'unknown') void profilesController.initializeFallback();
  });
  // A secured server can leave access approval pending for minutes. Start profiles locally after one
  // bounded network window so an offline chartplotter never loses profile autosave while it waits.
  const profileStartupFallback = setTimeout(
    () => void profilesController.initializeFallback(),
    PROFILE_LOCAL_STARTUP_FALLBACK_MS,
  );
  const refreshProfiles = (): void => {
    if (document.visibilityState === 'visible') void syncProfiles();
  };
  window.addEventListener('focus', refreshProfiles);
  document.addEventListener('visibilitychange', refreshProfiles);
  // Every write flows through sendJson, so this one hook lets a refused write (read-only token) raise
  // the read-only banner app-wide, and a later successful write clears it.
  setWriteOutcomeListener((ok, status) => auth.reportWriteOutcome(ok, status));
  const instrumentsFullScreenQuery = window.matchMedia(
    `(max-width: ${INSTRUMENTS_FULLSCREEN_BREAKPOINT_PX}px)`,
  );
  const syncInstrumentsFullScreen = (): void => {
    const next = instrumentsFullScreenQuery.matches;
    instrumentsViewportFullScreen = next;
    if (
      next &&
      instruments.open &&
      (activePanel !== null || weatherPanelOpen || radarControlsOpen || selectedNote !== undefined)
    ) {
      instruments.setOpen(false);
    }
  };
  syncInstrumentsFullScreen();
  instrumentsFullScreenQuery.addEventListener('change', syncInstrumentsFullScreen);
  // Another open Binnacle tab may erase the shared browser storage. Reset this tab's in-memory token
  // and reload so it cannot keep using credentials or cached state that the navigator just removed.
  const privacyChannel =
    typeof BroadcastChannel === 'undefined'
      ? undefined
      : new BroadcastChannel(BINNACLE_PRIVACY_CHANNEL);
  const profileStorageKeys = new Set<string>([
    binnacleStorageKey('profiles'),
    binnacleStorageKey('profileDevice'),
  ]);
  const suspendForRemoteErase = (): void => {
    profilesController.suspend();
    window.location.reload();
  };
  const onProfileStorage = (event: StorageEvent): void => {
    if (event.newValue === null && event.key && profileStorageKeys.has(event.key)) {
      suspendForRemoteErase();
    }
  };
  window.addEventListener('storage', onProfileStorage);
  if (privacyChannel) {
    privacyChannel.onmessage = (event) => {
      if (!isRecord(event.data) || !Array.isArray(event.data.clearedOwnerIds)) return;
      if (
        event.data.type !== 'credentials-forgotten' &&
        event.data.type !== 'device-data-erased' &&
        event.data.type !== 'local-data-erased'
      ) {
        return;
      }
      if (event.data.sourceId === privacySourceId) return;
      const clearedOwnerIds = event.data.clearedOwnerIds.filter(
        (ownerId): ownerId is string => typeof ownerId === 'string',
      );
      if (clearedOwnerIds.length !== event.data.clearedOwnerIds.length) return;
      if (clearedOwnerIds.length === 0) return;
      // Stop timers, server pushes, and post-write local acknowledgements before this tab reloads,
      // or it could recreate profile data another tab just erased.
      profilesController.suspend();
      if (clearedOwnerIds.includes('signalk-credentials')) {
        auth.forgetDeviceCredentials(false);
      }
      window.location.reload();
    };
  }
  return () => {
    clearInterval(pwaUpdateCheck);
    instrumentsFullScreenQuery.removeEventListener('change', syncInstrumentsFullScreen);
    window.removeEventListener('focus', refreshProfiles);
    document.removeEventListener('visibilitychange', refreshProfiles);
    window.removeEventListener('storage', onProfileStorage);
    privacyChannel?.close();
    clearTimeout(profileStartupFallback);
    removeBrowserZoomGuard();
    window.removeEventListener('keydown', onCommandPaletteShortcut);
    if (usesTouchEvents) {
      window.removeEventListener('touchstart', beginTouchBackSwipe, true);
      window.removeEventListener('touchmove', moveTouchBackSwipe, true);
      window.removeEventListener('touchend', finishTouchBackSwipe, true);
      window.removeEventListener('touchcancel', cancelTouchBackSwipe, true);
    } else {
      window.removeEventListener('pointerdown', beginBackSwipe);
      window.removeEventListener('pointerup', finishBackSwipe);
      window.removeEventListener('pointercancel', cancelBackSwipe);
    }
    screenWakeLock.dispose();
  };
});

onDestroy(() => {
  collisionSettingsSync.dispose();
  alarmLocationSettingsSync.dispose();
  privacyActivity.dispose();
  companionStatus.stop();
  streamController.dispose();
  notificationsController.dispose();
  trends.dispose();
  timeTravel.dispose();
  tripLog.dispose();
  if (viewSaveTimer) clearTimeout(viewSaveTimer);
  if (arrivalBannerTimer) clearTimeout(arrivalBannerTimer);
  if (privacyReloadTimer) clearTimeout(privacyReloadTimer);
  toast.dispose();
  // Harmless no-op when a primed gesture already self-removed the pair.
  removePrimeListeners();
  lookoutAlarm.stop();
  anchorAlarm.stop();
  mobAlarm.stop();
  shallowController.stop();
  arrivalAlarm.stop();
  genericAlarm.stop();
  alarmCoordinator.dispose();
  safetyAnnunciator.dispose();
  setWriteOutcomeListener(undefined);
  auth.stop();
  profilesController.dispose();
  void marineRadar.dispose();
  instruments.dispose();
  shallowAhead.dispose();
  net.dispose();
  clock.dispose();
  void client.disconnect();
  // Release the Comlink proxy and terminate the worker so an HMR reload or test remount does not
  // leak it. The disconnect above is best-effort: termination can outrun the posted message, and
  // it severs the socket regardless, so the clean close is preferred but not guaranteed.
  client.dispose();
});
const plotterServices = {
  origin,
  store,
  vessel,
  clock,
  aisTargets,
  units,
  auth,
  net,
  theme,
  trends,
  weatherLoader,
  weatherSource,
  pointConditionsLoader,
  planningSpeedMps,
  windRoseNoGoAngleRad,
  windRoseArcMarginRad,
  thresholds,
  alarmLocation,
  trackSettings,
  aisIconMode,
  aisNameMode,
  aisRetentionMinutes,
  categoriesOpen: layerCategoriesOpen,
  mapRenderingQuality,
  arrivalMuted,
};

const plotterControllers = {
  wayfindingController,
  anchorController,
  mobController,
  routeController,
  waypointsController,
  personalNotesController,
  trackController,
  tripLog,
  marineRadar,
  tidesController,
  handoff,
};

const plotterEntities = {
  anchor,
  mob,
  measure,
  collision,
  courseGuidance,
  recorder,
  routeStore,
  tidesStore,
  waypointsStore,
  personalNotesStore,
  symbolsStore,
  userCharts,
  weather,
  chartWeather,
  timeTravel,
  notificationsStore,
};

const plotterActions = {
  onViewChange,
  onLayersChange: (settings: LayerSettings) => layerSettings.set(settings),
  onOrderChange: (order: string[]) => layerOrder.set(order),
  onWeatherLayersChange: (settings: LayerSettings) => weatherLayerSettings.set(settings),
  onLayersReady: (view: LayersView) => (layersView = view),
  onMapReady: (recolor: (theme: Theme) => void) => {
    recolorMap = recolor;
    recolor(theme.theme);
  },
  onCommandsReady: captureMapCommands,
  onUserChartsReady: userChartsController.onUserChartsReady,
  onMapInstance: (map: MapLibreMap) => (mapInstance = map),
  onMapDestroyed: () => (mapInstance = undefined),
  onUserPan: () => follow.release(),
  onNoteSelect: selectNote,
  onAisSelect: selectAisTarget,
  onWaypointSelect: selectWaypointFromChart,
  onMooringSelect: selectMooring,
  onMoorings: (next: MooringPoint[]) => (moorings = next),
  onMooringStatus: (state: MooringViewState) => (mooringViewState = state),
  onTideStationSelect,
  onNotes: (notes: NotePoint[]) => (poiNotes = notes),
  onPoiStatus: (state: PoiViewState) => (poiViewState = state),
  onWeatherLayersReady: (apply: (settings: LayerSettings) => void) => (applyWeatherLayers = apply),
  onSilenceNotification,
  onAcknowledgeNotification,
  muteGenericHere,
  onRouteCoverageReport,
  openAlarmsPanel: () => openPanel('alarms'),
  closePanel,
  backToMenu,
  closeTrendsPanel,
  backFromTrendsPanel,
  openInstalledCharts,
  backToOfflineCharts,
  openLayersPanel: (mode: 'charts' | 'overlays') => {
    layersOpenRequest = { mode };
    openPanel('layers');
  },
  setLayerVisible,
  onRetryHistoryProviders: () => void probeHistoryProviders(true, true),
  onRetryChartLocker: () => void companionStatus.refresh(),
  armMeasure,
  moveSelectedMeasureToCenter,
  toggleCollisionMute,
  selectPoi,
  flyToPosition: (position: LatLon) => mapCommands?.flyTo(position.latitude, position.longitude),
  onShowChartBounds: (bounds: Bbox4) => mapCommands?.fitBounds(bounds),
  onHighlightLeg,
  closeRoutesPanel,
  backFromRoutesPanel,
  openRoutesPanel: () => openPanel('routes'),
  openProfilesPanel: () => openPanel('profiles'),
  openHelpPanel: () => openPanel('help'),
  enableAlarmSound: primeAlarmAudio,
  resetChartHints,
  dismissHelpOrientation: () => helpOrientationSeen.set(true),
  onDismissInsecureNote: () => insecureNoteSeen.set(true),
  onEnableNoaaEnc: enableNoaaEnc,
  onDismissEncPrompt: () => encPromptSeen.set(true),
  closeTracksPanel,
  backFromTracksPanel,
  closeWaypointsPanel,
  backFromWaypointsPanel,
  onStartRouteHere,
  closeNote,
  closePoiSearch,
  backFromPoiSearch,
  onSetRadarPower,
  onQuickActions: (position: { x: number; y: number; latitude: number; longitude: number }) => {
    actionDialContextPoint = { latitude: position.latitude, longitude: position.longitude };
    // A chart press already identifies the user's intent. Enter the Chart sub-ring directly so
    // its location-specific actions are immediately reachable, with Back available for the
    // primary category ring.
    actionDialBucket = 'chart';
    // The supermenu grows additional rings as actions are added. Keep its hub clear of the chart
    // edge by its actual outer radius, not a fixed two-ring estimate.
    const rings = Math.ceil(actionDialActions.length / 8);
    const clearance = window.innerWidth > 600 ? (7 + Math.max(0, rings - 1) * 5 + 3) * 16 : 0;
    actionDialPosition.set({
      x: Math.min(window.innerWidth - clearance, Math.max(clearance, position.x)),
      y: Math.min(window.innerHeight - clearance, Math.max(clearance, position.y)),
    });
    actionDialOpen = true;
  },
  openInstrumentsPanel: startScreenInstrumentEditing,
  lockInterface: interfaceLock.lock,
};
</script>

<!-- The measured safety-rail clearance rides the shell root so App-level overlays the rail can
     float over (the full-screen instrument dock) inherit it; 0px while no alerts are up. -->
<main
  class="binnacle-shell"
  class:instruments-fullscreen={instrumentsFullScreen}
  class:helm-actions-hidden={!helmActionsVisible}
  style:--rail-clearance={safetyRailClearance}
  style:--instrument-dock-width={`${instrumentDockWidth}px`}
>
  <LiveRegions
    safety={safetyAnnunciator.assertive}
    safetyQueue={safetyAnnunciator.polite}
    mute={muteAlert}
    companion={companionAnnounce}
  />
  <AppMenu
    items={menuItems}
    toolbarItems={helmButtonItems}
    open={menuOpen}
    panelOpen={bottomTabObscured}
    onOpenChange={setMenuOpen}
    pinnedIds={helmButtons.value}
    editing={menuEditing}
    onEditingChange={(next) => (menuEditing = next)}
    onTogglePin={onToggleHelmButton}
    onResetPinned={onResetHelmButtons}
  />
  <PlotterView
    services={plotterServices}
    controllers={plotterControllers}
    entities={plotterEntities}
    actions={plotterActions}
    {routeDistanceToGoMeters}
    {chartsToken}
    {chartCatalogRevision}
    {savedView}
    {currentView}
    layerSettings={layerSettings.value}
    layerOrder={layerOrder.value}
    {layersOpenRequest}
    {aisDisplaySettingsRequest}
    weatherLayerSettings={weatherLayerSettings.value}
    {trackPersistenceDegraded}
    {activePanel}
    {selectedAisId}
    {selectedWaypointId}
    {selectedMooringId}
    {moorings}
    {mooringViewState}
    {armNavigateWaypointId}
    {tidesOpenedFrom}
    bind:menuOpen
    bind:safetyRailClearance
    {layersView}
    {noteLoader}
    bind:selectedNote
    onBackFromNote={noteReturnsToPlaces ? backFromNote : undefined}
    bind:weatherPanelOpen
    bind:radarControlsOpen
    bind:radarOpenedFrom
    bind:radarDraftDirty
    bind:radarPanelRequest
    bind:mapInstance
    {companionBase}
    companionTiles={() => companionTileBase}
    {chartLockerAccessUrl}
    chartLockerState={companionStatus.state}
    chartLockerAdminAccess={companionStatus.state === 'serving'}
    pwaStatus={pwa.status}
    {arrivalBanner}
    toastMessage={toast.message}
    bind:hoveredPoi
    {poiInView}
    {poiViewState}
    {historyProviders}
    {historyProviderState}
    {serverFeatures}
    {notificationsApi}
    {audioBlocked}
    {audioState}
    helpFirstRun={!helpOrientationSeen.value}
    {showHelpWelcome}
    {showEncPrompt}
    insecureNoteDismissed={insecureNoteSeen.value}
    {weatherProvider}
    {collisionMute}
    collisionMuteRemainingMin={collisionMute.active ? muteRemainingMin : undefined}
    {alarmSilence}
    {alarmActionError}
    {genericAlarms}
    genericSounding={notificationsController.genericSounding}
    genericLocallyMuted={notificationsController.genericLocallyMuted}
    shallowMonitor={{
      monitorState: shallowController.monitorState,
      serverLimitMeters: shallowController.serverLimitMeters,
      serverZonesActive: shallowController.serverZonesActive,
    }}
  />
  <ActionDial
    actions={actionDialActions}
    open={actionDialOpen}
    onOpenChange={setActionDialOpen}
    position={actionDialPosition.value}
    onPositionChange={(position) => actionDialPosition.set(position)}
    showTrigger={false}
  />

  {#snippet screenLayerLoadError(retry: () => void)}
    <div class="screen-layer-error">
      <div class="popover-card panel-load-error" role="alert">
        <span>Instrument screen layout could not load.</span>
        <button type="button" class="btn btn-ghost" onclick={retry}>Retry</button>
      </div>
    </div>
  {/snippet}

  <!-- Instruments placed freely over the chart, rendered by the screen edit mode. The slot sits
       exactly over the chart cell and never intercepts itself; the layer root inside owns its
       pointer events per mode. Rendered after PlotterView so it stacks above the chart. -->
  {#if instruments.screenEditing || (instruments.open && instruments.floating.length > 0)}
    <div class="instrument-screen-slot">
      {#await instrumentScreenLayerForAttempt() then module}
        <ErrorBoundary>
          <module.default
            controller={instruments}
            deps={{
              vessel,
              store,
              units,
              clock,
              course: courseGuidance,
              tides: tidesStore,
              shallowAhead,
            }}
            {aisTargets}
            {collision}
            aisRadarRangeNm={aisRadarRangeNm.value}
            onAisRadarRangeChange={(rangeNm) => aisRadarRangeNm.set(rangeNm)}
            theme={theme.theme}
            {companionBase}
            chartToken={chartsToken}
            {mapInstrument}
            onOpenTideSettings={openTideStationSettings}
            windRoseNoGoAngleRad={windRoseNoGoAngleRad.value}
            windRoseArcMarginRad={windRoseArcMarginRad.value}
            onWindRoseNoGoAngleChange={(angleRad) => windRoseNoGoAngleRad.set(angleRad)}
            onWindRoseArcMarginChange={(angleRad) => windRoseArcMarginRad.set(angleRad)}
            topBannerPresent={showHelpWelcome || showEncPrompt || arrivalBanner !== undefined}
            onDone={exitScreenInstrumentEditing}
            onEdit={startScreenInstrumentEditing}
            overlayOpacity={instrumentOverlayOpacity.value}
          />

          {#snippet fallback(_error, reset)}
            {@render screenLayerLoadError(reset)}
          {/snippet}
        </ErrorBoundary>
      {:catch}
        {@render screenLayerLoadError(() => {
          instrumentScreenLayerAttempt += 1;
        })}
      {/await}
    </div>
  {/if}

  {#if activePanel === 'profiles'}
    <div class="panel-slot" id="profiles-panel">
      {#await profilesPanelForAttempt()}
        <LazyPanelState
          title="Profiles"
          closeLabel="Close profiles panel"
          state="loading"
          message="Loading Profiles controls…"
          onClose={closePanel}
          onBack={backToMenu}
        />
      {:then module}
        <ErrorBoundary>
          <module.default
            {auth}
            {units}
            profiles={profileStore.profiles}
            activeId={profileStore.activeId}
            defaultId={profileStore.defaultId}
            syncState={profileStore.syncState}
            remoteUpdateAvailable={profileStore.remoteUpdateAvailable}
            remoteUpdateChanges={profileStore.remoteUpdateChanges}
            onRetrySync={() => void syncProfiles()}
            onApply={onApplyProfile}
            onApplyRemoteUpdate={profilesController.applyRemoteUpdate}
            onKeepCurrentSetup={profilesController.keepCurrentSetup}
            onSaveNew={onSaveNewProfile}
            onRename={(id, name) => profileStore.rename(id, name)}
            onRemove={profilesController.remove}
            onSetDefault={(id) => profileStore.setDefault(id)}
            onExport={onExportProfile}
            onImport={onImportProfiles}
            onForgetCredentials={forgetDeviceCredentials}
            onEraseAllLocalData={eraseAllLocalData}
            onClose={closePanel}
            onBack={backToMenu}
          />

          {#snippet fallback(_error, reset)}
            <LazyPanelState
              title="Profiles"
              closeLabel="Close profiles panel"
              state="error"
              message="Profiles controls stopped unexpectedly."
              onClose={closePanel}
              onBack={backToMenu}
              onRetry={reset}
            />
          {/snippet}
        </ErrorBoundary>
      {:catch}
        <LazyPanelState
          title="Profiles"
          closeLabel="Close profiles panel"
          state="error"
          message="Profiles controls could not load."
          onClose={closePanel}
          onBack={backToMenu}
          onRetry={() => (profilesPanelAttempt += 1)}
        />
      {/await}
    </div>
  {/if}

  {#snippet instrumentsState(message: string, onRetry?: () => void)}
    <!-- biome-ignore lint/a11y/useAriaPropsSupportedByRole: the dynamic role is dialog exactly when aria-modal is defined. -->
    <aside
      id="instrument-dock"
      class="instruments"
      role={instrumentsFullScreen ? 'dialog' : undefined}
      aria-label="Instruments"
      aria-modal={instrumentsFullScreen ? 'true' : undefined}
      tabindex="-1"
      use:dialog={() => instruments.setOpen(false)}
      use:trapFocus={instrumentsFullScreen}
    >
      <div class="panel-body panel-body--flex">
        <div
          class:panel-loading={!onRetry}
          class:panel-load-error={onRetry !== undefined}
          role={onRetry ? 'alert' : 'status'}
        >
          <span>{message}</span>
          {#if onRetry}
            <button type="button" class="btn btn-ghost" onclick={onRetry}>Retry</button>
          {/if}
        </div>
      </div>
    </aside>
  {/snippet}

  {#snippet instrumentsMobAction()}
    <!-- The same MOB store and trigger flow as the toolbar button, rendered inside the modal
         dialog subtree so full-screen Instruments always carries a reachable MOB initiation.
         Fly-to-mark closes the dock first, or the chart movement happens invisibly under it. -->
    <MobButton
      {mob}
      onTrigger={mobController.onTrigger}
      onLocate={(position) => {
        instruments.setOpen(false);
        flyToPosition(position);
      }}
      writeBlocked={auth.writeBlocked}
    />
  {/snippet}

  {#snippet interfaceLockAction()}
    <button
      type="button"
      class="btn btn-pill fixed-toolbar-action"
      aria-label="Lock Binnacle"
      title="Lock Binnacle"
      onclick={interfaceLock.lock}
    >
      <Lock size={16} aria-hidden="true" />
      <span class="fixed-action-label">Lock</span>
    </button>
  {/snippet}

  {#snippet mapInstrument(expanded: boolean, actionLabel: string, onOpen: () => void)}
    {#await instrumentChartForAttempt()}
      <div class="tile tile--empty"><p class="muted-note">Loading map…</p></div>
    {:then module}
      <module.default
        {origin}
        {vessel}
        {aisTargets}
        aisAssessment={() => collision.assessment}
        aisKindMode={aisIconMode.value}
        aisNameMode={aisNameMode.value}
        {units}
        {thresholds}
        {userCharts}
        theme={theme.theme}
        {companionBase}
        companionTiles={() => companionTileBase}
        {chartsToken}
        initialView={instrumentMapView}
        savedLayers={layerSettings.value}
        savedOrder={layerOrder.value}
        mapRenderingQuality={mapRenderingQuality.value}
        qualityOverride={instrumentMapRenderingQuality.value}
        onQualityOverrideChange={(quality) => instrumentMapRenderingQuality.set(quality)}
        {mainMapAisVisible}
        aisVisibilityOverride={instrumentMapAisVisibility.value}
        onAisVisibilityOverrideChange={(visible) => instrumentMapAisVisibility.set(visible)}
        following={instrumentMapFollowing}
        onFollowingChange={(following) => (instrumentMapFollowing = following)}
        onViewChange={onInstrumentMapViewChange}
        {expanded}
        {actionLabel}
        {onOpen}
      />
    {:catch}
      <div class="tile tile--empty">
        <p class="alert-note">Map failed to load.</p>
        <button type="button" class="btn" onclick={() => (instrumentChartLoadAttempt += 1)}>
          Retry
        </button>
      </div>
    {/await}
  {/snippet}

  {#if instruments.open && instrumentsPanelRequested}
    {#await instrumentsPanelForAttempt()}
      {@render instrumentsState('Loading Instruments controls…')}
    {:then module}
      <ErrorBoundary>
        <module.default
          controller={instruments}
          deps={{
            vessel,
            store,
            units,
            clock,
            course: courseGuidance,
            tides: tidesStore,
            shallowAhead,
          }}
          {aisTargets}
          {collision}
          aisRadarRangeNm={aisRadarRangeNm.value}
          onAisRadarRangeChange={(rangeNm) => aisRadarRangeNm.set(rangeNm)}
          windRoseNoGoAngleRad={windRoseNoGoAngleRad.value}
          onWindRoseNoGoAngleChange={(angleRad) => windRoseNoGoAngleRad.set(angleRad)}
          windRoseArcMarginRad={windRoseArcMarginRad.value}
          onWindRoseArcMarginChange={(angleRad) => windRoseArcMarginRad.set(angleRad)}
          initialWindRoseSettingsRequest={windRoseSettingsRequest}
          onWindRoseSettingsRequestHandled={() => (windRoseSettingsRequest = undefined)}
          initialCustomizeRequest={instrumentCustomizeRequest}
          onCustomizeRequestHandled={() => (instrumentCustomizeRequest = undefined)}
          theme={theme.theme}
          {companionBase}
          chartToken={chartsToken}
          {mapInstrument}
          initialExpandedRequest={instrumentExpandedRequest}
          onExpandedRequestHandled={() => (instrumentExpandedRequest = undefined)}
          onOpenTideSettings={openTideStationSettings}
          fullscreen={instrumentsFullScreen}
          dockWidth={instrumentDockWidth}
          onDockResize={resizeInstrumentDock}
          onDockResizeCommit={commitInstrumentDockWidth}
          tileLayouts={instrumentTileLayouts.value}
          onTileLayoutsChange={(layouts) => instrumentTileLayouts.set(layouts)}
          emergencyAction={instrumentsMobAction}
          lockAction={interfaceLockAction}
          initialDetailId={trendReturnInstrumentId}
          restoreTrendFocusId={trendReturnInstrumentId}
          onViewTrend={openFocusedTrend}
          onTrendFocusRestored={() => (trendReturnInstrumentId = undefined)}
          screenEditing={instruments.screenEditing}
          overlayOpacity={instrumentOverlayOpacity.value}
          onOverlayOpacityChange={(opacity) => instrumentOverlayOpacity.set(opacity)}
        />

        {#snippet fallback(_error, reset)}
          {@render instrumentsState('Instruments controls stopped unexpectedly.', reset)}
        {/snippet}
      </ErrorBoundary>
    {:catch}
      {@render instrumentsState('Instruments controls could not load.', () => {
        instrumentsPanelAttempt += 1;
      })}
    {/await}
  {/if}

  <MobButton
    {mob}
    showButton={false}
    requestOpen={mobCommandRequest}
    onTrigger={mobController.onTrigger}
    onLocate={flyToPosition}
    writeBlocked={auth.writeBlocked}
  />
  {#if helmActionsVisible}
    <div
      class="helm-primary-actions"
      class:helm-primary-actions--update-ready={updateReady}
      role="group"
      aria-label="Helm actions"
      style:--helm-drag-offset={`${helmDragOffset}px`}
      onpointerdowncapture={startHelmHideDrag}
      onpointermove={moveHelmHideDrag}
      onpointerup={finishHelmHideDrag}
      onpointercancel={cancelHelmHideDrag}
      onclickcapture={guardHelmClick}
    >
      <div class="helm-actions-start">
        {#if helmButtonVisible('lock')}
          <button
            type="button"
            class="btn btn-pill"
            aria-label={interfaceLock.locked ? 'Unlock Binnacle' : 'Lock Binnacle'}
            title={interfaceLock.locked ? 'Unlock Binnacle' : 'Lock Binnacle'}
            onclick={interfaceLock.locked ? interfaceLock.unlock : interfaceLock.lock}
          >
            {#if interfaceLock.locked}
              <LockOpen size={16} aria-hidden="true" />
            {:else}
              <Lock size={16} aria-hidden="true" />
            {/if}
          </button>
        {/if}
        {#if !installedPwa}
          {#if helmButtonVisible('fullscreen')}
            <button
              type="button"
              class="btn btn-pill"
              aria-label="Toggle full screen"
              title="Toggle full screen"
              onclick={() => void toggleBrowserFullScreen()}
            >
              <Maximize2 size={16} aria-hidden="true" />
            </button>
          {/if}
        {/if}
        {#if helmButtonVisible('home')}
          <button
            type="button"
            class="btn btn-pill"
            aria-label="Home"
            title="Return to chart"
            onclick={goHome}
          >
            <House size={16} aria-hidden="true" />
          </button>
        {/if}
        {#if helmButtonVisible('weather')}
          <button
            type="button"
            class="btn btn-pill"
            class:is-on={helmWeatherLayer !== undefined}
            aria-label={`Weather and tides: ${helmWeatherLayerName(helmWeatherLayer)}. Activate for next overlay.`}
            aria-pressed={helmWeatherLayer !== undefined}
            title={`Weather and tides: ${helmWeatherLayerName(helmWeatherLayer)}`}
            onclick={cycleHelmWeatherLayer}
          >
            <CloudSun size={16} aria-hidden="true" />
          </button>
        {/if}
      </div>
      <div class="helm-mob-action">
        <MobButton
          {mob}
          showLabel={false}
          onTrigger={mobController.onTrigger}
          onLocate={flyToPosition}
          writeBlocked={auth.writeBlocked}
        />
      </div>
      <div class="helm-actions-end">
        {#if helmButtonVisible('profiles')}
          <ProfileSwitcher
            active={profileStore.active}
            profiles={profileStore.profiles}
            hasUpdate={profileStore.remoteUpdateAvailable}
            onSelect={onApplyProfile}
            onManage={() => openPanel('profiles')}
          />
        {/if}
        {#if helmButtonVisible('instruments')}
          <button
            type="button"
            class="btn btn-pill helm-instruments-action"
            aria-label={instrumentsActionLabel()}
            title={instrumentsActionLabel()}
            onclick={cycleInstruments}
          >
            {#if instruments.screenEditing}
              <Pencil size={18} aria-hidden="true" />
            {:else}
              <Gauge size={18} aria-hidden="true" />
            {/if}
          </button>
        {/if}
        {#if updateReady}
          <button
            type="button"
            class="btn btn-pill helm-update-action"
            aria-label="Install ready update"
            title="A Binnacle update is ready to install"
            onclick={() => {
            updateReady = false;
            pwa.update();
          }}
          >
            <DownloadCloud size={16} aria-hidden="true" />
          </button>
        {/if}
        {#if helmButtonVisible('supermenu')}
          <button
            type="button"
            class="btn btn-pill"
            aria-label={actionDialOpen ? 'Close supermenu' : 'Open supermenu'}
            aria-expanded={actionDialOpen}
            aria-haspopup="menu"
            onpointerdown={(event) => event.stopPropagation()}
            onclick={() => {
            actionDialContextPoint = undefined;
            actionDialPosition.set({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
            setActionDialOpen(!actionDialOpen);
          }}
          >
            <MenuIcon size={16} aria-hidden="true" />
          </button>
        {/if}
        {#if helmButtonVisible('center')}
          <button
            type="button"
            class="btn btn-pill helm-center-action"
            aria-label="Center on vessel"
            title={!mapCommands
            ? 'Center on vessel (chart is loading)'
            : vessel.positionStale
              ? 'Center on vessel needs a fresh GPS fix'
              : !vessel.position
                ? 'Center on vessel needs a GPS position'
                : 'Center on vessel'}
            disabled={!mapCommands || !vessel.position || vessel.positionStale}
            onclick={() => mapCommands?.centerOnVessel()}
          >
            <LocateFixed size={16} aria-hidden="true" />
          </button>
        {/if}
        <AlarmButton
          grade={helmAlarmGrade}
          count={activeAlarmNotifications.length}
          onOpen={() => openPanel('alarms')}
        />
      </div>
    </div>
  {:else}
    <button
      type="button"
      class="helm-edge-reveal"
      aria-label="Show helm controls"
      title="Swipe up or tap to show helm controls"
      onclick={() => (helmActionsVisible = true)}
      onpointerdown={startHelmRevealSwipe}
      onpointermove={moveHelmRevealSwipe}
      onpointerup={finishHelmRevealSwipe}
      onpointercancel={cancelHelmHideDrag}
    >
      <span class="visually-hidden">Swipe up or tap to show helm controls</span>
    </button>
  {/if}
</main>

{#if commandPaletteOpen}
  <CommandPalette commands={paletteCommands} onClose={() => (commandPaletteOpen = false)} />
{/if}

{#if waypointsController.addWaypointAt}
  <WaypointDialog
    defaultName={defaultSaveName('Waypoint')}
    symbols={symbolsStore}
    busy={waypointsController.busy}
    onSave={(result) => void confirmDroppedWaypoint(result)}
    onSaveAndNavigate={auth.writeBlocked
      ? undefined
      : (result) => void saveWaypointAndNavigate(result)}
    onCancel={waypointsController.cancelAddWaypoint}
  />
{/if}
{#if waypointsController.editingWaypoint}
  <!-- Key on the waypoint so editing a different one remounts the dialog and re-seeds its fields,
       rather than capturing only the first waypoint's name and icon. -->
  {#key waypointsController.editingWaypoint}
    <WaypointDialog
      defaultName={waypointsController.editingWaypoint.name}
      waypoint={waypointsController.editingWaypoint}
      symbols={symbolsStore}
      busy={waypointsController.busy}
      onSave={(result) => void waypointsController.onSaveWaypointEdit(result)}
      onCancel={waypointsController.cancelEditWaypoint}
    />
  {/key}
{/if}
{#if personalNotesController.editor}
  {#key personalNotesController.editor}
    {#await personalNoteDialogForAttempt()}
      <dialog
        class="modal-card lazy-note-dialog"
        aria-label="Loading personal note editor"
        use:dialog={personalNotesController.cancelEdit}
      >
        <p role="status">Loading personal note editor…</p>
        <button type="button" class="btn" onclick={personalNotesController.cancelEdit}>
          Cancel
        </button>
      </dialog>
    {:then module}
      <ErrorBoundary>
        <module.default
          editor={personalNotesController.editor}
          symbols={symbolsStore}
          {auth}
          capability={personalNotesController.capability}
          probing={personalNotesController.probing}
          busy={personalNotesController.busy}
          error={personalNotesController.error}
          onSave={(input) => void personalNotesController.save(input)}
          onCancel={personalNotesController.cancelEdit}
          onProbe={() => void personalNotesController.probe()}
        />

        {#snippet fallback(_error, reset)}
          <dialog
            class="modal-card lazy-note-dialog"
            aria-label="Personal note editor unavailable"
            use:dialog={personalNotesController.cancelEdit}
          >
            <p class="alert-note" role="alert">Personal note editor stopped unexpectedly.</p>
            <div class="panel-controls">
              <button type="button" class="btn btn-primary" onclick={reset}>Retry</button>
              <button type="button" class="btn" onclick={personalNotesController.cancelEdit}>
                Cancel
              </button>
            </div>
          </dialog>
        {/snippet}
      </ErrorBoundary>
    {:catch}
      <dialog
        class="modal-card lazy-note-dialog"
        aria-label="Personal note editor unavailable"
        use:dialog={personalNotesController.cancelEdit}
      >
        <p class="alert-note" role="alert">Personal note editor could not load.</p>
        <div class="panel-controls">
          <button
            type="button"
            class="btn btn-primary"
            onclick={() => (personalNoteDialogAttempt += 1)}
          >
            Retry
          </button>
          <button type="button" class="btn" onclick={personalNotesController.cancelEdit}>
            Cancel
          </button>
        </div>
      </dialog>
    {/await}
  {/key}
{/if}

<InterfaceLockLayer controller={interfaceLock} />

<style>
.lazy-note-dialog {
  display: grid;
  gap: var(--space-3);
  inline-size: min(25rem, calc(100dvw - 2 * var(--space-4)));
  padding: var(--space-4);
}
.binnacle-shell {
  --helm-action-size: var(--control-size);
  --helm-actions-clearance: calc(
    var(--helm-action-size) +
    2 *
    var(--space-2) +
    env(safe-area-inset-bottom, 0px)
  );
  --helm-panel-offset: calc(
    var(--helm-action-size) +
    var(--space-2) +
    env(safe-area-inset-bottom, 0px)
  );
  --helm-reveal-clearance: calc(var(--control-size) + env(safe-area-inset-bottom, 0px));
  display: grid;
  grid-template-rows: 1fr auto;
  /* The outer columns are the app-menu and instrument docks. Every in-flow child is placed
     explicitly, so auto-placement cannot flow chart content into either dock column. */
  grid-template-columns: auto 1fr auto;
  /* #app is this component's sole mount target (see main.ts) and already carries the dvh-tracked
     (with a vh fallback) block-size, so inheriting it here keeps that fallback in one place. */
  block-size: 100%;
  margin-block: 0;
  margin-inline: 0;
  font-family: var(--font-ui);
  background: var(--surface);
  color: var(--text);
}
.binnacle-shell.helm-actions-hidden {
  --helm-actions-clearance: var(--helm-reveal-clearance);
  --helm-panel-offset: var(--helm-reveal-clearance);
}
.binnacle-shell > :global(.app-menu-dock) {
  grid-row: 1;
  grid-column: 1;
}
/* PlotterView's root is the chart host; place it explicitly like every other shell child, so
   auto-placement can never drift it into the dock column. */
.binnacle-shell > :global(.chart-host) {
  grid-row: 1;
  grid-column: 2;
}
.binnacle-shell > :global(.action-dial) {
  grid-row: 1;
  grid-column: 2;
}
.binnacle-shell > :global(.instruments) {
  grid-row: 1;
  grid-column: 3;
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: var(--z-panel);
  inline-size: clamp(20rem, var(--instrument-dock-width), calc(100dvw - 3rem));
  border-inline-start: 1px solid var(--border);
  /* The dock scrolls its own tiles; without this a long tile list would stretch the shell row. */
  min-block-size: 0;
}
.binnacle-shell > :global(.instruments.instrument-focus) {
  z-index: calc(var(--z-menu) + 1);
}
.binnacle-shell.instruments-fullscreen > :global(.instruments) {
  position: fixed;
  inset: 0;
  z-index: var(--z-panel);
  inline-size: auto;
  background: var(--surface);
}
/* The screen edit layer occupies exactly the chart cell. The slot never intercepts; the layer
   root inside manages its own pointer events per mode (none when locked, auto while editing). */
.instrument-screen-slot {
  grid-row: 1;
  grid-column: 2;
  position: relative;
  z-index: var(--z-overlay);
  pointer-events: none;
}
.screen-layer-error {
  position: absolute;
  inset-block-start: var(--space-2);
  inset-inline-start: var(--space-2);
  z-index: var(--z-overlay);
  pointer-events: auto;
}
.screen-layer-error .panel-load-error {
  flex-direction: row;
  min-block-size: 0;
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
}
.helm-primary-actions {
  display: flex;
  /* This fixed rail is still a shell grid child. Span the shell explicitly so its center is the
     viewport center, not an auto-placement cell beside the chart. */
  grid-row: 1 / -1;
  grid-column: 1 / -1;
  position: fixed;
  z-index: calc(var(--z-menu) + 2);
  /* iPad Safari's layout viewport can be wider than the visible chart. Use the dynamic viewport
     width so the helm rail and its emergency key remain on the screen the operator is touching. */
  inset-inline-start: 0;
  inline-size: 100dvw;
  /* Move a hide drag with the inset instead of transform. A transformed rail becomes the containing
     block for the profile switcher's viewport-fixed menu and would place that menu below the screen. */
  inset-block-end: calc(
    var(--space-2) +
    env(safe-area-inset-bottom, 0px) -
    var(--helm-drag-offset, 0px)
  );
  justify-content: center;
  gap: var(--space-2);
  pointer-events: auto;
  touch-action: none;
}
.helm-actions-start,
.helm-actions-end {
  display: flex;
  gap: var(--space-2);
}
.helm-primary-actions :global(button) {
  pointer-events: auto;
}
.helm-primary-actions :global(.btn-pill) {
  inline-size: var(--helm-action-size);
  block-size: var(--helm-action-size);
  min-inline-size: var(--helm-action-size);
  padding: 0;
  border-radius: 50%;
  justify-content: center;
}
.helm-update-action {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 18%, var(--surface));
  color: var(--text);
}
.helm-edge-reveal {
  grid-row: 1 / -1;
  grid-column: 1 / -1;
  position: fixed;
  z-index: calc(var(--z-menu) + 2);
  inset-block-end: 0;
  inset-inline-start: 0;
  inline-size: 100dvw;
  block-size: calc(var(--control-size) + env(safe-area-inset-bottom, 0px));
  padding: 0;
  border: 0;
  border-block-start: 1px solid transparent;
  background: transparent;
  cursor: n-resize;
  touch-action: none;
}
.helm-edge-reveal:hover,
.helm-edge-reveal:focus-visible {
  border-block-start-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}
/* iPad helm chrome favors deliberate, gloved-hand operation. Every control, including MOB,
   stays in one row so emergency access never obscures another action. */
@media (pointer: coarse) and (min-width: 601px) and (max-width: 1200px) {
  .binnacle-shell {
    /* Nine always-reachable helm actions must fit an iPad in portrait. A full 2x control makes
       the rail wider than the visible viewport once its gaps are included. */
    --helm-action-size: calc(1.75 * var(--control-size));
  }
  .helm-primary-actions :global(.btn-pill svg) {
    inline-size: calc(var(--control-size) * 0.73);
    block-size: calc(var(--control-size) * 0.73);
  }
}
/* PLATFORM_BREAKPOINTS.compactHelmMaxPx. Keep this CSS breakpoint aligned with the matchMedia
   state that supplies the panel's dialog behavior. */
@media (max-width: 900px) {
  .binnacle-shell > :global(.instruments) {
    position: fixed;
    inset: 0;
    z-index: var(--z-panel);
    inline-size: auto;
    background: var(--surface);
  }
}
@media (max-width: 480px) {
  .helm-primary-actions {
    justify-content: flex-start;
    gap: var(--space-1);
    padding-inline: var(--space-1);
    overflow-x: auto;
    overscroll-behavior-inline: contain;
    scrollbar-width: none;
  }
  .helm-actions-start,
  .helm-actions-end {
    gap: var(--space-1);
  }
  /* A stale or absent fix leaves this shortcut disabled. On a phone, keep its equivalent in the
     Navigate supermenu and reserve the fixed rail for the working weather, MOB, and alarm actions. */
  .helm-center-action {
    display: none;
  }
}
</style>
