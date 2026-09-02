import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDynamicOverlays } from './build-overlays';

const factories = vi.hoisted(() => {
  const marker = (id: string) => ({ id });
  return {
    createAisOverlay: vi.fn((_targets: unknown, _options: { assessment?: () => unknown }) =>
      marker('ais'),
    ),
    createAisTrailsOverlay: vi.fn(
      (
        _origin: string,
        _getToken: () => string | undefined,
        _isAvailable: () => boolean,
        _selfContext: () => string | undefined,
      ) => marker('ais-trails'),
    ),
    createAisVectorsOverlay: vi.fn((_targets: unknown, _assessment: () => unknown) =>
      marker('ais-vectors'),
    ),
    createAnchorOverlay: vi.fn(() => marker('anchor')),
    createCollisionOverlay: vi.fn(() => marker('collision')),
    createCourseOverlay: vi.fn(() => marker('course')),
    createHistoryTrackOverlay: vi.fn(
      (
        _origin: string,
        _getToken: () => string | undefined,
        _providers: () => unknown,
        _settings: unknown,
        _reviewActive: () => boolean,
      ) => marker('history-track'),
    ),
    createMeasureOverlay: vi.fn(() => marker('measure')),
    createMobOverlay: vi.fn(() => marker('mob')),
    createRouteOverlay: vi.fn(() => marker('route')),
    createTidesOverlay: vi.fn(() => marker('tides')),
    createTimeTravelOverlay: vi.fn(() => marker('time-travel')),
    createTimeTravelTrackOverlay: vi.fn(() => marker('time-travel-track')),
    createTrackOverlay: vi.fn(() => marker('track')),
    createVesselOverlay: vi.fn((_vessel: unknown, _reviewActive: () => boolean) =>
      marker('vessel'),
    ),
    createWaypointOverlay: vi.fn(() => marker('waypoints')),
    createWindOverlay: vi.fn(
      (_weather: unknown, _makeCanvas: unknown, _getSpeedUnit: () => string) =>
        marker('weather-wind'),
    ),
    createCurrentOverlay: vi.fn(
      (_weather: unknown, _makeCanvas: unknown, _getSpeedUnit: () => string) =>
        marker('weather-current'),
    ),
    createTemperatureOverlay: vi.fn(() => marker('weather-temperature')),
    createUvOverlay: vi.fn(() => marker('weather-uv')),
    createObservedWindOverlay: vi.fn(() => marker('weather-observed-wind')),
  };
});

vi.mock('$features/ais-layer', () => ({
  createAisOverlay: factories.createAisOverlay,
  createAisTrailsOverlay: factories.createAisTrailsOverlay,
  createAisVectorsOverlay: factories.createAisVectorsOverlay,
}));
vi.mock('$features/anchor-watch', () => ({ createAnchorOverlay: factories.createAnchorOverlay }));
vi.mock('$features/lookout', () => ({ createCollisionOverlay: factories.createCollisionOverlay }));
vi.mock('$features/measure', () => ({ createMeasureOverlay: factories.createMeasureOverlay }));
vi.mock('$features/mob', () => ({ createMobOverlay: factories.createMobOverlay }));
vi.mock('$features/route-layer', () => ({
  createCourseOverlay: factories.createCourseOverlay,
  createRouteOverlay: factories.createRouteOverlay,
}));
vi.mock('$features/tides', () => ({ createTidesOverlay: factories.createTidesOverlay }));
vi.mock('$features/time-travel', () => ({
  createTimeTravelOverlay: factories.createTimeTravelOverlay,
  createTimeTravelTrackOverlay: factories.createTimeTravelTrackOverlay,
}));
vi.mock('$features/track-layer', () => ({
  createHistoryTrackOverlay: factories.createHistoryTrackOverlay,
  createTrackOverlay: factories.createTrackOverlay,
}));
vi.mock('$features/vessel-layer', () => ({ createVesselOverlay: factories.createVesselOverlay }));
vi.mock('$features/waypoints', () => ({ createWaypointOverlay: factories.createWaypointOverlay }));
vi.mock('$features/weather', () => ({
  createCurrentOverlay: factories.createCurrentOverlay,
  createTemperatureOverlay: factories.createTemperatureOverlay,
  createUvOverlay: factories.createUvOverlay,
  createWindOverlay: factories.createWindOverlay,
  createObservedWindOverlay: factories.createObservedWindOverlay,
}));

function setup(marineRadarLayer?: { id: string }, interactionsAllowed?: () => boolean) {
  const assessment = { contacts: [], worst: 'clear' };
  const deps = {
    origin: 'http://boat.local',
    getToken: vi.fn(() => 'live-token'),
    store: { selfContext: 'vessels.self' },
    vessel: { name: 'vessel' },
    aisTargets: { name: 'ais-targets' },
    onAisSelect: vi.fn(),
    selectedAisId: vi.fn(() => 'vessels.selected'),
    aisKindMode: vi.fn(() => 'generic' as const),
    onWaypointSelect: vi.fn(),
    anchor: { name: 'anchor' },
    mob: { name: 'mob' },
    measure: { name: 'measure' },
    collision: { name: 'collision', assessment },
    guidance: { name: 'guidance' },
    recorder: { name: 'recorder' },
    routeStore: { name: 'routes' },
    tides: { name: 'tides' },
    weather: { name: 'weather' },
    units: { name: 'units', speedUnit: 'kn' },
    waypoints: { name: 'waypoints' },
    symbols: { name: 'symbols' },
    trackSettings: { value: { intervalSeconds: 10 } },
    tripLog: { day: undefined, status: 'ready', version: 0 },
    savedTracks: { list: vi.fn() },
    notesOverlay: { id: 'notes' },
    onTideStationSelect: vi.fn(),
    interactionsAllowed,
    onAnchorMoved: vi.fn(),
    aisTrailsAvailable: vi.fn(() => true),
    historyProviders: vi.fn(() => ({ providers: [] })),
    onAisMotionUpdate: vi.fn(),
    timeTravel: { name: 'time-travel', active: false },
    marineRadarLayer,
  };
  return { deps, overlays: buildDynamicOverlays(deps as never) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildDynamicOverlays', () => {
  it('locks the complete bottom-to-top safety and navigation order', () => {
    const radar = { id: 'marine-radar' };
    const { overlays } = setup(radar);

    expect(overlays.map(({ id }) => id)).toEqual([
      'weather-wind',
      'weather-current',
      'weather-temperature',
      'weather-uv',
      'weather-observed-wind',
      'tides',
      'anchor',
      'measure',
      'route',
      'course',
      'waypoints',
      'notes',
      'ais-trails',
      'ais-vectors',
      'ais',
      'collision',
      'mob',
      'history-track',
      'track',
      'time-travel-track',
      'vessel',
      'time-travel',
      'marine-radar',
    ]);
  });

  it('omits only the optional radar layer when no radar controller supplied one', () => {
    const { overlays } = setup();
    expect(overlays.map(({ id }) => id)).toEqual([
      'weather-wind',
      'weather-current',
      'weather-temperature',
      'weather-uv',
      'weather-observed-wind',
      'tides',
      'anchor',
      'measure',
      'route',
      'course',
      'waypoints',
      'notes',
      'ais-trails',
      'ais-vectors',
      'ais',
      'collision',
      'mob',
      'history-track',
      'track',
      'time-travel-track',
      'vessel',
      'time-travel',
    ]);
  });

  it('forwards live getters and each store to the intended overlay factory', () => {
    const { deps } = setup();

    expect(factories.createTidesOverlay).toHaveBeenCalledWith(
      deps.tides,
      deps.units,
      deps.onTideStationSelect,
    );
    expect(factories.createWindOverlay).toHaveBeenCalledWith(
      deps.weather,
      undefined,
      expect.any(Function),
    );
    expect(factories.createCurrentOverlay).toHaveBeenCalledWith(
      deps.weather,
      undefined,
      expect.any(Function),
    );
    expect(factories.createTemperatureOverlay).toHaveBeenCalledWith(deps.weather);
    expect(factories.createUvOverlay).toHaveBeenCalledWith(deps.weather);
    expect(factories.createObservedWindOverlay).toHaveBeenCalledWith(
      deps.origin,
      deps.getToken,
      expect.any(Function),
    );
    const windSpeedUnit = factories.createWindOverlay.mock.calls[0]?.[2];
    const currentSpeedUnit = factories.createCurrentOverlay.mock.calls[0]?.[2];
    expect(windSpeedUnit?.()).toBe('kn');
    expect(currentSpeedUnit?.()).toBe('kn');
    deps.units.speedUnit = 'kmh';
    expect(windSpeedUnit?.()).toBe('kmh');
    expect(currentSpeedUnit?.()).toBe('kmh');
    expect(factories.createAnchorOverlay).toHaveBeenCalledWith(
      deps.anchor,
      deps.vessel,
      deps.onAnchorMoved,
      deps.interactionsAllowed,
    );
    expect(factories.createMeasureOverlay).toHaveBeenCalledWith(deps.measure, deps.units);
    expect(factories.createRouteOverlay).toHaveBeenCalledWith(deps.routeStore);
    expect(factories.createWaypointOverlay).toHaveBeenCalledWith(deps.waypoints, deps.symbols, {
      onSelect: deps.onWaypointSelect,
      interactionsAllowed: deps.interactionsAllowed,
    });
    expect(factories.createAisTrailsOverlay).toHaveBeenCalledWith(
      deps.origin,
      deps.getToken,
      deps.aisTrailsAvailable,
      expect.any(Function),
    );
    const selfContext = factories.createAisTrailsOverlay.mock.calls[0]?.[3];
    expect(selfContext?.()).toBe('vessels.self');
    deps.store.selfContext = 'vessels.changed';
    expect(selfContext?.()).toBe('vessels.changed');
    expect(factories.createAisVectorsOverlay).toHaveBeenCalledWith(
      deps.aisTargets,
      expect.any(Function),
      Date.now,
      deps.onAisMotionUpdate,
      {
        origin: deps.origin,
        getToken: deps.getToken,
        providers: deps.historyProviders,
        selectedId: deps.selectedAisId,
      },
    );
    const collisionAssessment = factories.createAisVectorsOverlay.mock.calls[0]?.[1];
    expect(collisionAssessment?.()).toBe(deps.collision.assessment);
    expect(factories.createAisOverlay).toHaveBeenCalledWith(deps.aisTargets, {
      assessment: expect.any(Function),
      onSelect: deps.onAisSelect,
      selectedId: deps.selectedAisId,
      kindMode: deps.aisKindMode,
      interactionsAllowed: deps.interactionsAllowed,
    });
    const iconAssessment = factories.createAisOverlay.mock.calls[0]?.[1]?.assessment;
    expect(iconAssessment?.()).toBe(deps.collision.assessment);
    expect(factories.createHistoryTrackOverlay).toHaveBeenCalledWith(
      deps.trackSettings,
      deps.tripLog,
      expect.any(Function),
    );
    const historyReviewActive = factories.createHistoryTrackOverlay.mock.calls[0]?.[2];
    expect(factories.createTrackOverlay).toHaveBeenCalledWith(
      deps.recorder,
      deps.trackSettings,
      deps.savedTracks,
      expect.any(Function),
    );
    expect(factories.createCourseOverlay).toHaveBeenCalledWith(deps.guidance, deps.vessel);
    expect(factories.createCollisionOverlay).toHaveBeenCalledWith(deps.collision);
    expect(factories.createMobOverlay).toHaveBeenCalledWith(deps.mob, deps.vessel);
    expect(factories.createVesselOverlay).toHaveBeenCalledWith(deps.vessel, expect.any(Function));
    const reviewActive = factories.createVesselOverlay.mock.calls[0]?.[1];
    expect(reviewActive?.()).toBe(false);
    expect(historyReviewActive?.()).toBe(false);
    deps.timeTravel.active = true;
    expect(reviewActive?.()).toBe(true);
    expect(historyReviewActive?.()).toBe(true);
    expect(factories.createTimeTravelTrackOverlay).toHaveBeenCalledWith(deps.timeTravel);
    expect(factories.createTimeTravelOverlay).toHaveBeenCalledWith(deps.timeTravel);
  });

  it('forwards one live chart-interaction gate to Tide and AIS hit surfaces', () => {
    const interactionsAllowed = vi.fn(() => false);
    const { deps } = setup(undefined, interactionsAllowed);

    expect(factories.createTidesOverlay).toHaveBeenCalledWith(
      deps.tides,
      deps.units,
      deps.onTideStationSelect,
      Date.now,
      interactionsAllowed,
    );
    expect(factories.createAisOverlay).toHaveBeenCalledWith(deps.aisTargets, {
      assessment: expect.any(Function),
      onSelect: deps.onAisSelect,
      selectedId: deps.selectedAisId,
      kindMode: deps.aisKindMode,
      interactionsAllowed,
    });
  });
});
