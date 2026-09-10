import { describe, expect, it } from 'vitest';
import type { CourseGuidance } from '$entities/course';
import { TidesStore } from '$entities/tides';
import { UnitsStore } from '$entities/units';
import { OwnVessel } from '$entities/vessel';
import type { ReactiveClock, UnitsMode } from '$shared/lib';
import { feetToMeters, knotsToMetersPerSecond, PLACEHOLDER } from '$shared/lib';
import { PersistedValue } from '$shared/settings';
import type { SKFrame } from '$shared/signalk';
import { SignalKStore, SK_PATHS } from '$shared/signalk';
import type { TileDeps } from './tile-catalog';
import {
  ALL_CATALOG_PATHS,
  batteryCurrentTileDef,
  batteryDefsFor,
  batterySocTileDef,
  batteryStatusTileDef,
  batteryTileDef,
  batteryTimeTileDef,
  CLIENT_DEFAULT_ZONES,
  DEFAULT_TILES,
  insideDefsFor,
  insideHumidityTileDef,
  insideTemperatureTileDef,
  instrumentOptionLabels,
  propulsionDefsFor,
  propulsionLoadTileDef,
  propulsionRpmTileDef,
  propulsionTemperatureTileDef,
  solarDefsFor,
  solarPowerTileDef,
  TILE_CATALOG,
  TILE_STALE_MS,
  tankDefsFor,
  tankLevelTileDef,
  tileById,
} from './tile-catalog';

// Asserts the tile exists and calls read() - avoids non-null assertions throughout tests.
function readTile(id: string, deps: TileDeps) {
  const def = tileById(id);
  if (!def) throw new Error(`No tile with id '${id}'`);
  return def.read(deps);
}

function skFrame(self: Record<string, unknown>, epoch = 1000): SKFrame {
  return {
    self: new Map(Object.entries(self)) as SKFrame['self'],
    connection: { phase: 'open', attempt: 0 },
    epoch,
  };
}

function makeDeps(clock: ReactiveClock, mode: UnitsMode = 'metric') {
  const store = new SignalKStore();
  const vessel = new OwnVessel(store);
  // OwnVessel pre-creates its own paths; add the instrument-only paths the tiles need.
  store.ensureCells([
    SK_PATHS.speedThroughWater,
    SK_PATHS.headingMagnetic,
    SK_PATHS.windAngleApparent,
    SK_PATHS.windSpeedTrue,
    SK_PATHS.windAngleTrueWater,
    SK_PATHS.windAngleTrueGround,
    SK_PATHS.windSpeedOverGround,
    SK_PATHS.windDirectionTrue,
    SK_PATHS.attitude,
  ]);
  // PersistedValue uses fallback when no storage is available (Node test env).
  const local = new PersistedValue<UnitsMode>('binnacle-custom:units', mode);
  const units = new UnitsStore(local);
  return { store, vessel, units, clock, course: inactiveCourse() };
}

function inactiveCourse(): CourseGuidance {
  return { active: false } as unknown as CourseGuidance;
}

function activeCourse(dtwMeters: number | undefined, btwRad: number | undefined): CourseGuidance {
  return {
    active: true,
    distanceToNextMeters: dtwMeters,
    bearingToNextRad: btwRad,
  } as unknown as CourseGuidance;
}

describe('tile catalog structure', () => {
  it('DEFAULT_TILES are sog, heading, depth, wind-apparent in that order', () => {
    expect(DEFAULT_TILES).toEqual(['sog', 'heading', 'depth', 'wind-apparent']);
  });

  it('every DEFAULT_TILES id resolves via tileById', () => {
    for (const id of DEFAULT_TILES) {
      expect(tileById(id), `tileById('${id}')`).toBeDefined();
    }
  });

  it('tileById returns undefined for an unknown id', () => {
    expect(tileById('no-such-tile')).toBeUndefined();
  });

  it('offers an independent map instrument outside the default dock', () => {
    expect(tileById('map')).toMatchObject({
      label: 'Map',
      kind: 'map',
      category: 'navigation',
      paths: [SK_PATHS.position],
    });
    expect(DEFAULT_TILES).not.toContain('map');
  });

  it('offers shallow water ahead using navigation and Signal K draft inputs', () => {
    expect(tileById('shallow-ahead')).toMatchObject({
      label: 'Shallow water ahead',
      abbr: 'CPA',
      kind: 'numeric',
      category: 'depth',
      paths: [
        SK_PATHS.position,
        SK_PATHS.courseOverGroundTrue,
        SK_PATHS.speedOverGround,
        SK_PATHS.draftCurrent,
        SK_PATHS.draftMaximum,
        SK_PATHS.draftMinimum,
      ],
    });
    expect(DEFAULT_TILES).not.toContain('shallow-ahead');
  });

  it('ALL_CATALOG_PATHS contains every path from every def', () => {
    const all = new Set(ALL_CATALOG_PATHS);
    for (const def of TILE_CATALOG) {
      for (const path of def.paths) {
        expect(all.has(path), `${path} in ALL_CATALOG_PATHS (from ${def.id})`).toBe(true);
      }
    }
  });

  it('ALL_CATALOG_PATHS has no duplicate entries', () => {
    expect(ALL_CATALOG_PATHS.length).toBe(new Set(ALL_CATALOG_PATHS).size);
  });

  it('ALL_CATALOG_PATHS includes the new instrument paths added in Tasks 1-3', () => {
    const all = new Set(ALL_CATALOG_PATHS);
    expect(all.has(SK_PATHS.speedThroughWater)).toBe(true);
    expect(all.has(SK_PATHS.windAngleApparent)).toBe(true);
    expect(all.has(SK_PATHS.windSpeedTrue)).toBe(true);
    expect(all.has(SK_PATHS.windAngleTrueWater)).toBe(true);
    expect(all.has(SK_PATHS.headingMagnetic)).toBe(true);
    expect(all.has(SK_PATHS.windSpeedOverGround)).toBe(true);
    expect(all.has(SK_PATHS.windDirectionTrue)).toBe(true);
    expect(all.has(SK_PATHS.attitude)).toBe(true);
  });
});

describe('state grading', () => {
  it("epoch === 0 → 'never' with value === PLACEHOLDER", () => {
    const clock = { now: 5000 };
    const deps = makeDeps(clock);
    const reading = readTile('sog', deps);
    expect(reading.state).toBe('never');
    expect(reading.value).toBe(PLACEHOLDER);
  });

  it("value undefined after a report → 'placeholder'", () => {
    const clock = { now: 5000 };
    const deps = makeDeps(clock);
    // Stamp the epoch without setting a value (direct cell write, as the brief allows).
    const cell = deps.store.cell(SK_PATHS.speedOverGround);
    cell.epoch = 5000;
    // cell.value remains undefined (default)
    const reading = readTile('sog', deps);
    expect(reading.state).toBe('placeholder');
    expect(reading.value).toBe(PLACEHOLDER);
  });

  it("elapsed > TILE_STALE_MS → 'stale' with last value retained (not PLACEHOLDER)", () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.store.applyFrame(skFrame({ [SK_PATHS.speedOverGround]: 3.0 }, 1000));
    clock.now = 1000 + TILE_STALE_MS + 1;
    const reading = readTile('sog', deps);
    expect(reading.state).toBe('stale');
    expect(reading.value).not.toBe(PLACEHOLDER);
  });

  it("elapsed <= TILE_STALE_MS with value present → 'live'", () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.store.applyFrame(skFrame({ [SK_PATHS.speedOverGround]: 3.0 }, 1000));
    clock.now = 1000 + 100;
    const reading = readTile('sog', deps);
    expect(reading.state).toBe('live');
  });

  it('a declared meta.timeout window on the cell replaces the ten-second default', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.store.applyFrame(skFrame({ [SK_PATHS.speedOverGround]: 3.0 }, 1000));
    const cell = deps.store.cell(SK_PATHS.speedOverGround);
    // A five-minute sensor declared via meta.timeout: not stale at eleven seconds.
    cell.staleWindowMs = 300_000;
    clock.now = 1000 + TILE_STALE_MS + 1;
    expect(readTile('sog', deps).state).toBe('live');
    clock.now = 1000 + 300_001;
    expect(readTile('sog', deps).state).toBe('stale');
    // timeout 0 declares the path never stale.
    cell.staleWindowMs = Number.POSITIVE_INFINITY;
    clock.now = 1000 + 100_000_000;
    expect(readTile('sog', deps).state).toBe('live');
  });

  it("server stale declaration → 'stale' even with a fresh epoch, value retained", () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.store.applyFrame(skFrame({ [SK_PATHS.speedOverGround]: 3.0 }, 1000));
    deps.store.applyFrame({
      self: new Map(),
      selfStales: new Map([[SK_PATHS.speedOverGround, {}]]),
      connection: { phase: 'open', attempt: 0 },
      epoch: 1500,
    });
    clock.now = 1600;
    const reading = readTile('sog', deps);
    expect(reading.state).toBe('stale');
    expect(reading.value).not.toBe(PLACEHOLDER);
  });
});

describe('shallow water ahead tile', () => {
  it('shows CPA, TCPA, and the shallow depth from the Seascape profile', () => {
    const deps: TileDeps = {
      ...makeDeps({ now: 10_000 }),
      shallowAhead: {
        reading: {
          state: 'hazard',
          message: 'Shallow water ahead.',
          distanceM: 926,
          tcpaSeconds: 600,
          depthM: 3.5,
          updatedAtMs: 10_000,
        },
        dispose() {},
      },
    };

    expect(readTile('shallow-ahead', deps)).toMatchObject({
      state: 'live',
      value: '926 m',
      secondary: 'TCPA 10 min · depth 3.5 m',
      referenceLabel: 'SEASCAPE',
      sourceLabel: 'Seascape reference bathymetry',
    });
  });

  it('calls incomplete source coverage a gap, never clear water', () => {
    const deps: TileDeps = {
      ...makeDeps({ now: 10_000 }),
      shallowAhead: {
        reading: {
          state: 'coverage-gap',
          message: 'Coverage is incomplete.',
          coverageFraction: 0.42,
          updatedAtMs: 10_000,
        },
        dispose() {},
      },
    };

    expect(readTile('shallow-ahead', deps)).toMatchObject({
      state: 'placeholder',
      value: 'Coverage gap',
      secondary: '42% of projected course sampled',
    });
  });
});

describe('sog tile', () => {
  it('formats speed in knots and carries siValue as m/s', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    // 1 m/s = 3600/1852 ≈ 1.944 kn
    deps.store.applyFrame(skFrame({ [SK_PATHS.speedOverGround]: 1.0 }, 1000));
    const reading = readTile('sog', deps);
    expect(reading.unit).toBe('kn');
    // formatKnotsOr rounds to 1 decimal place, so compare within 1-decimal tolerance.
    expect(Number(reading.value)).toBeCloseTo(1.944, 1);
    expect(reading.siValue).toBeCloseTo(1.0);
  });
});

describe('depth tile', () => {
  it('formats in meters and returns unit m when mode is metric', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock, 'metric');
    deps.store.applyFrame(skFrame({ [SK_PATHS.depthBelowTransducer]: 10.0 }, 1000));
    const reading = readTile('depth', deps);
    expect(reading.unit).toBe('m');
    expect(reading.value).toBe('10.0');
  });

  it('formats in feet and returns unit ft when mode is imperial', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock, 'imperial');
    // 1 m = 1/0.3048 ≈ 3.281 ft
    deps.store.applyFrame(skFrame({ [SK_PATHS.depthBelowTransducer]: 1.0 }, 1000));
    const reading = readTile('depth', deps);
    expect(reading.unit).toBe('ft');
    // formatLengthOr rounds to 1 decimal place, so compare within 1-decimal tolerance.
    expect(Number(reading.value)).toBeCloseTo(3.281, 1);
  });

  it('prefers below-keel, then below-transducer, then below-surface and labels the reference', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock, 'metric');
    deps.store.applyFrame(
      skFrame(
        {
          [SK_PATHS.depthBelowTransducer]: 8,
          [SK_PATHS.depthBelowSurface]: 9,
          [SK_PATHS.depthBelowKeel]: 7,
        },
        1000,
      ),
    );
    let reading = readTile('depth', deps);
    expect(reading.value).toBe('7.0');
    expect(reading.referenceLabel).toBe('Keel');

    // A positive-offset sounder publishes transducer and surface together; the safety resolution
    // keeps the smaller transducer reading so the tile and the shallow alarm agree.
    const pairedDeps = makeDeps(clock, 'metric');
    pairedDeps.store.applyFrame(
      skFrame({ [SK_PATHS.depthBelowTransducer]: 8, [SK_PATHS.depthBelowSurface]: 9 }, 1000),
    );
    reading = readTile('depth', pairedDeps);
    expect(reading.value).toBe('8.0');
    expect(reading.referenceLabel).toBe('Xducer');

    const surfaceDeps = makeDeps(clock, 'metric');
    surfaceDeps.store.applyFrame(skFrame({ [SK_PATHS.depthBelowSurface]: 9 }, 1000));
    reading = readTile('depth', surfaceDeps);
    expect(reading.value).toBe('9.0');
    expect(reading.referenceLabel).toBe('Surface');
  });

  it('leaves the reference unlabeled until a depth source reports', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock, 'metric');
    const reading = readTile('depth', deps);
    expect(reading.state).toBe('never');
    expect(reading.value).toBe(PLACEHOLDER);
    expect(reading.referenceLabel).toBeUndefined();
  });

  it('grades a stale keel reading on the keel path rather than a fresh transducer', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock, 'metric');
    deps.store.applyFrame(skFrame({ [SK_PATHS.depthBelowKeel]: 7 }, 1000));
    clock.now = 1000 + TILE_STALE_MS + 1;
    deps.store.applyFrame(skFrame({ [SK_PATHS.depthBelowTransducer]: 8 }, clock.now));
    const reading = readTile('depth', deps);
    expect(reading.state).toBe('stale');
    expect(reading.value).toBe('7.0');
    expect(reading.referenceLabel).toBe('Keel');
  });
});

describe('tide tile', () => {
  it('reads the shared tide store and keeps tide height in SI', () => {
    const clock = { now: 1500 };
    const tides = new TidesStore();
    tides.setReadings(
      {
        station: { id: 'T1', name: 'Test Harbor', latitude: 1, longitude: 2 },
        distanceMeters: 1000,
        events: [
          { timeMs: 1000, heightMeters: 0.2, kind: 'low' },
          { timeMs: 2000, heightMeters: 1.2, kind: 'high' },
        ],
        samples: [{ timeMs: 1500, heightMeters: 0.7 }],
      },
      undefined,
      'noaa-coops',
    );
    const reading = readTile('tides', { ...makeDeps(clock), tides });

    expect(reading.state).toBe('live');
    expect(reading.siValue).toBe(0.7);
    expect(reading.tide?.station.name).toBe('Test Harbor');
  });
});

describe('heading tile fallback chain', () => {
  it('headingTrue present → no referenceLabel, bearing in degrees', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    // π/2 rad = 90°, zero-padded to three digits with embedded degree sign
    deps.store.applyFrame(skFrame({ [SK_PATHS.headingTrue]: Math.PI / 2 }, 1000));
    const reading = readTile('heading', deps);
    expect(reading.state).toBe('live');
    expect(reading.referenceLabel).toBeUndefined();
    expect(reading.value).toMatch(/^\d{3}°$/);
    expect(Number(reading.value.replace('°', ''))).toBeCloseTo(90, 0);
  });

  it('only headingMagnetic reported → state live, referenceLabel M', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.store.applyFrame(skFrame({ [SK_PATHS.headingMagnetic]: Math.PI }, 1000));
    const reading = readTile('heading', deps);
    expect(reading.state).toBe('live');
    expect(reading.referenceLabel).toBe('M');
    expect(reading.value).toMatch(/^\d{3}°$/);
    expect(Number(reading.value.replace('°', ''))).toBeCloseTo(180, 0);
  });

  it('only COG reported → state live, referenceLabel COG', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.store.applyFrame(skFrame({ [SK_PATHS.courseOverGroundTrue]: Math.PI / 4 }, 1000));
    const reading = readTile('heading', deps);
    expect(reading.state).toBe('live');
    expect(reading.referenceLabel).toBe('COG');
  });

  it("none reported → state 'never', value PLACEHOLDER", () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    const reading = readTile('heading', deps);
    expect(reading.state).toBe('never');
    expect(reading.value).toBe(PLACEHOLDER);
  });

  it('primary stale but still preferred over a fresh magnetic fallback', () => {
    // Once headingTrue has ever reported, the tile grades on it even if stale.
    // It should not silently switch to a magnetic source mid-passage.
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.store.applyFrame(
      skFrame({ [SK_PATHS.headingTrue]: 0, [SK_PATHS.headingMagnetic]: 0.1 }, 1000),
    );
    clock.now = 1000 + TILE_STALE_MS + 1;
    const reading = readTile('heading', deps);
    expect(reading.state).toBe('stale');
    expect(reading.referenceLabel).toBeUndefined();
  });
});

describe('heading compass tile', () => {
  it('uses the same resolved heading and reference as the numeric heading tile', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.store.applyFrame(skFrame({ [SK_PATHS.headingMagnetic]: Math.PI / 3 }, 1000));
    expect(readTile('heading-compass', deps)).toEqual(readTile('heading', deps));
    expect(tileById('heading-compass')?.kind).toBe('compass');
  });
});

describe('wind-apparent tile', () => {
  it('returns live state, knots speed, signed angleRad, and m/s siValue', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    // -0.5 rad = port side (negative = port by Signal K convention)
    deps.store.applyFrame(
      skFrame({ [SK_PATHS.windSpeedApparent]: 5.0, [SK_PATHS.windAngleApparent]: -0.5 }, 1000),
    );
    const reading = readTile('wind-apparent', deps);
    expect(reading.state).toBe('live');
    expect(reading.unit).toBe('kn');
    // 5.0 m/s ≈ 9.72 kn
    expect(Number(reading.value)).toBeCloseTo(9.72, 1);
    expect(reading.siValue).toBeCloseTo(5.0);
    expect(reading.angleRad).toBeCloseTo(-0.5);
  });
});

describe('wind-apparent tile ground fallback', () => {
  it('ground-only store: state live, GND referenceLabel, speed from windSpeedOverGround in knots', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.store.applyFrame(
      skFrame(
        { [SK_PATHS.windSpeedOverGround]: 5.14, [SK_PATHS.windDirectionTrue]: Math.PI },
        1000,
      ),
    );
    const reading = readTile('wind-apparent', deps);
    expect(reading.state).toBe('live');
    expect(reading.referenceLabel).toBe('GND');
    expect(Number(reading.value)).toBeCloseTo(9.99, 0);
    expect(reading.siValue).toBeCloseTo(5.14);
  });

  it('ground fallback: angleRad = normalized(directionTrue - headingTrue) when heading present', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    // directionTrue = π (from south), headingTrue = π/2 (east) → relative = π - π/2 = π/2
    deps.store.applyFrame(
      skFrame(
        {
          [SK_PATHS.windSpeedOverGround]: 3.0,
          [SK_PATHS.windDirectionTrue]: Math.PI,
          [SK_PATHS.headingTrue]: Math.PI / 2,
        },
        1000,
      ),
    );
    const reading = readTile('wind-apparent', deps);
    expect(reading.angleRad).toBeCloseTo(Math.PI / 2, 4);
  });

  it('ground fallback: angleRad undefined when no heading source', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.store.applyFrame(
      skFrame({ [SK_PATHS.windSpeedOverGround]: 3.0, [SK_PATHS.windDirectionTrue]: 1.0 }, 1000),
    );
    const reading = readTile('wind-apparent', deps);
    expect(reading.angleRad).toBeUndefined();
  });

  it('apparent-present boat: apparent takes priority, no GND label', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.store.applyFrame(
      skFrame(
        {
          [SK_PATHS.windSpeedApparent]: 5.0,
          [SK_PATHS.windAngleApparent]: -0.5,
          [SK_PATHS.windSpeedOverGround]: 8.0,
          [SK_PATHS.windDirectionTrue]: 1.0,
        },
        1000,
      ),
    );
    const reading = readTile('wind-apparent', deps);
    expect(reading.referenceLabel).toBeUndefined();
    expect(reading.siValue).toBeCloseTo(5.0);
  });

  it('stale apparent keeps priority over fresh ground wind', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.store.applyFrame(
      skFrame({ [SK_PATHS.windSpeedApparent]: 5.0, [SK_PATHS.windAngleApparent]: -0.5 }, 1000),
    );
    clock.now = 1000 + TILE_STALE_MS + 1;
    deps.store.applyFrame(
      skFrame(
        { [SK_PATHS.windSpeedOverGround]: 8.0, [SK_PATHS.windDirectionTrue]: 1.0 },
        clock.now,
      ),
    );
    const reading = readTile('wind-apparent', deps);
    expect(reading.state).toBe('stale');
    expect(reading.referenceLabel).toBeUndefined();
    expect(reading.siValue).toBeCloseTo(5.0);
  });
});

describe('wind-true tile', () => {
  it('reads from windSpeedTrue and windAngleTrueWater cells', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.store.applyFrame(
      skFrame({ [SK_PATHS.windSpeedTrue]: 6.0, [SK_PATHS.windAngleTrueWater]: 0.8 }, 1000),
    );
    const reading = readTile('wind-true', deps);
    expect(reading.state).toBe('live');
    expect(reading.unit).toBe('kn');
    expect(reading.siValue).toBeCloseTo(6.0);
    expect(reading.angleRad).toBeCloseTo(0.8);
  });

  it('falls back to ground-referenced true wind angle and labels it', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.store.applyFrame(
      skFrame({ [SK_PATHS.windSpeedTrue]: 6.0, [SK_PATHS.windAngleTrueGround]: -0.4 }, 1000),
    );
    const reading = readTile('wind-true', deps);
    expect(reading.angleRad).toBeCloseTo(-0.4);
    expect(reading.referenceLabel).toBe('GND');
  });
});

describe('vertical true-wind history tiles', () => {
  it('uses true wind speed for the TWS history trace', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.store.applyFrame(skFrame({ [SK_PATHS.windSpeedTrue]: 6 }, 1000));

    const def = tileById('tws-history');
    const reading = readTile('tws-history', deps);
    expect(def?.viz).toBe('vertical-speed');
    expect(reading).toMatchObject({ state: 'live', value: '11.7', unit: 'kn', siValue: 6 });
  });

  it('prefers water-referenced TWA and falls back to a labeled ground reference', () => {
    const waterClock = { now: 1000 };
    const waterDeps = makeDeps(waterClock);
    waterDeps.store.applyFrame(skFrame({ [SK_PATHS.windAngleTrueWater]: -Math.PI / 4 }, 1000));
    expect(readTile('twa-history', waterDeps)).toMatchObject({
      state: 'live',
      value: 'P 45',
      unit: '°',
      siValue: -Math.PI / 4,
    });

    const groundClock = { now: 1000 };
    const groundDeps = makeDeps(groundClock);
    groundDeps.store.applyFrame(skFrame({ [SK_PATHS.windAngleTrueGround]: Math.PI / 3 }, 1000));
    expect(readTile('twa-history', groundDeps)).toMatchObject({
      state: 'live',
      value: 'S 60',
      unit: '°',
      referenceLabel: 'GND',
    });
    expect(tileById('twa-history')?.viz).toBe('vertical-angle');
  });
});

describe('wind rose tile', () => {
  it('combines apparent wind, true wind, heading, speed over ground, and resolved depth', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock, 'metric');
    deps.store.applyFrame(
      skFrame(
        {
          [SK_PATHS.windSpeedApparent]: 5,
          [SK_PATHS.windAngleApparent]: -0.5,
          [SK_PATHS.windSpeedTrue]: 4,
          [SK_PATHS.windAngleTrueWater]: 0.7,
          [SK_PATHS.headingTrue]: 1.2,
          [SK_PATHS.speedOverGround]: 3,
          [SK_PATHS.depthBelowKeel]: 1.8,
        },
        1000,
      ),
    );
    const reading = readTile('wind-rose', deps);
    expect(reading.state).toBe('live');
    expect(reading.windRose?.apparent.angleRad).toBeCloseTo(-0.5);
    expect(reading.windRose?.apparent.angleEpoch).toBe(1000);
    expect(reading.windRose?.trueWind.angleRad).toBeCloseTo(0.7);
    expect(reading.windRose?.trueWind.angleEpoch).toBe(1000);
    expect(reading.windRose?.heading.siValue).toBeCloseTo(1.2);
    expect(reading.windRose?.heading.value).toBe('069°');
    expect(reading.windRose?.speedOverGround.siValue).toBe(3);
    expect(reading.windRose?.depth.value).toBe('1.8');
    expect(reading.windRose?.depth.referenceLabel).toBe('Keel');
  });

  it('stays live when only true wind is available', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.store.applyFrame(
      skFrame({ [SK_PATHS.windSpeedTrue]: 4, [SK_PATHS.windAngleTrueWater]: 0.7 }, 1000),
    );
    const reading = readTile('wind-rose', deps);
    expect(reading.state).toBe('live');
    expect(reading.siValue).toBe(4);
  });

  it('rounds each numeric readout to a whole value at 10 and above', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock, 'metric');
    deps.store.applyFrame(
      skFrame(
        {
          [SK_PATHS.windSpeedApparent]: knotsToMetersPerSecond(10),
          [SK_PATHS.windSpeedTrue]: knotsToMetersPerSecond(10.49),
          [SK_PATHS.speedOverGround]: knotsToMetersPerSecond(10.5),
          [SK_PATHS.depthBelowKeel]: 12.6,
        },
        1000,
      ),
    );

    const reading = readTile('wind-rose', deps);
    expect(reading.windRose?.apparent.value).toBe('10');
    expect(reading.windRose?.trueWind.value).toBe('10');
    expect(reading.windRose?.speedOverGround.value).toBe('11');
    expect(reading.windRose?.depth.value).toBe('13');

    // The precision change belongs to the combined rose, not the standalone instruments.
    expect(readTile('wind-apparent', deps).value).toBe('10.0');
    expect(readTile('depth', deps).value).toBe('12.6');
  });

  it('keeps tenths below 10 and applies the threshold after depth unit conversion', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock, 'imperial');
    deps.store.applyFrame(
      skFrame(
        {
          [SK_PATHS.windSpeedApparent]: knotsToMetersPerSecond(9.94),
          [SK_PATHS.windSpeedTrue]: knotsToMetersPerSecond(9.9),
          [SK_PATHS.speedOverGround]: knotsToMetersPerSecond(9.94),
          [SK_PATHS.depthBelowKeel]: feetToMeters(10.49),
        },
        1000,
      ),
    );

    const reading = readTile('wind-rose', deps);
    expect(reading.windRose?.apparent.value).toBe('9.9');
    expect(reading.windRose?.trueWind.value).toBe('9.9');
    expect(reading.windRose?.speedOverGround.value).toBe('9.9');
    expect(reading.windRose?.depth.value).toBe('10');
    expect(reading.windRose?.depth.unit).toBe('ft');
  });
});

describe('attitude instruments', () => {
  it('reads heel from the roll field of navigation.attitude', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.store.applyFrame(
      skFrame({ [SK_PATHS.attitude]: { pitch: 0.1, roll: -Math.PI / 12 } }, 1000),
    );
    const reading = readTile('heel', deps);
    expect(reading.state).toBe('live');
    expect(reading.value).toBe('15.0');
    expect(reading.secondary).toBe('Port');
    expect(reading.rollRad).toBeCloseTo(-Math.PI / 12);
  });

  it('keeps pitch and roll in radians while formatting the paired display', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.store.applyFrame(skFrame({ [SK_PATHS.attitude]: { pitch: 0.1, roll: -0.2 } }, 1000));
    const reading = readTile('pitch-roll', deps);
    expect(reading.pitchRad).toBe(0.1);
    expect(reading.rollRad).toBe(-0.2);
    expect(reading.value).toContain('° /');
  });
});

describe('pressure tile', () => {
  it('formats in hPa (metric)', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock, 'metric');
    // 101325 Pa = 1013 hPa
    deps.store.applyFrame(skFrame({ [SK_PATHS.outsidePressure]: 101325 }, 1000));
    const reading = readTile('pressure', deps);
    expect(reading.unit).toBe('hPa');
    expect(reading.value).toBe('1013');
  });

  it('formats in inHg (imperial)', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock, 'imperial');
    // 101325 Pa ≈ 29.92 inHg
    deps.store.applyFrame(skFrame({ [SK_PATHS.outsidePressure]: 101325 }, 1000));
    const reading = readTile('pressure', deps);
    expect(reading.unit).toBe('inHg');
    expect(Number(reading.value)).toBeCloseTo(29.92, 1);
  });
});

describe('position tile', () => {
  it('returns PLACEHOLDER when no fix', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    const reading = readTile('position', deps);
    expect(reading.state).toBe('never');
    expect(reading.value).toBe(PLACEHOLDER);
  });

  it('returns formatted lat and lon separated by newline when fix present', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.store.applyFrame(
      skFrame({ [SK_PATHS.position]: { latitude: 36.8, longitude: -121.7 } }, 1000),
    );
    const reading = readTile('position', deps);
    expect(reading.state).toBe('live');
    expect(reading.unit).toBe('');
    const [latLine, lonLine] = reading.value.split('\n');
    expect(latLine).toContain('N');
    expect(lonLine).toContain('W');
  });
});

describe('course tile', () => {
  it("returns state 'never' and PLACEHOLDER when no course is active", () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    const reading = readTile('course', deps);
    expect(reading.state).toBe('never');
    expect(reading.value).toBe(PLACEHOLDER);
    expect(reading.unit).toBe('');
  });

  it("returns state 'live' with DTW/BTW two-line value when course is active", () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    // 1852 m = 1.00 nm; Math.PI / 4 rad = 45 deg
    deps.course = activeCourse(1852, Math.PI / 4);
    const reading = readTile('course', deps);
    expect(reading.state).toBe('live');
    expect(reading.unit).toBe('');
    const [dtwLine, btwLine] = reading.value.split('\n');
    expect(dtwLine).toContain('nm');
    // dtwLine is e.g. "1.00 nm"; parseFloat parses the leading numeric portion.
    expect(parseFloat(dtwLine)).toBeCloseTo(1.0, 1);
    expect(btwLine).toContain('°');
    expect(parseFloat(btwLine)).toBeCloseTo(45, 0);
  });

  it('renders PLACEHOLDER lines when active with undefined DTW and BTW', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.course = activeCourse(undefined, undefined);
    const reading = readTile('course', deps);
    expect(reading.state).toBe('live');
    const [dtwLine, btwLine] = reading.value.split('\n');
    expect(dtwLine).toContain(PLACEHOLDER);
    expect(btwLine).toContain(PLACEHOLDER);
  });

  it('carries no siValue (the distance path has no zones to band against)', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.course = activeCourse(3704, 0);
    const reading = readTile('course', deps);
    expect(reading.siValue).toBeUndefined();
  });

  it('course tile has empty paths array (no demand subscription needed)', () => {
    const def = tileById('course');
    expect(def?.paths).toEqual([]);
  });

  it('course tile is NOT in DEFAULT_TILES', () => {
    expect(DEFAULT_TILES).not.toContain('course');
  });

  it('course tile IS in TILE_CATALOG', () => {
    expect(TILE_CATALOG.some((d) => d.id === 'course')).toBe(true);
  });
});

describe('batteryTileDef', () => {
  it('generates correct id, label, and path for an instance', () => {
    const def = batteryTileDef('house');
    expect(def.id).toBe('battery:house');
    expect(def.label).toBe('Voltage · House battery');
    expect(def.abbr).toBe('VOLT');
    expect(def.description).toBe('House battery voltage.');
    expect(def.paths).toEqual(['electrical.batteries.house.voltage']);
    expect(def.zonesPath).toBe('electrical.batteries.house.voltage');
    expect(def.kind).toBe('numeric');
    expect(def.sensorGloss).toBe('No battery data');
  });

  it('reads voltage from the store cell', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    const def = batteryTileDef('house');
    deps.store.ensureCells(def.paths);
    deps.store.applyFrame(skFrame({ 'electrical.batteries.house.voltage': 12.6 }, 1000));
    const reading = def.read(deps);
    expect(reading.state).toBe('live');
    expect(reading.value).toBe('12.6');
    expect(reading.unit).toBe('V');
    expect(reading.siValue).toBeCloseTo(12.6);
  });

  it("returns state 'never' and unit V when no data", () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    const def = batteryTileDef('starter');
    deps.store.ensureCells(def.paths);
    const reading = def.read(deps);
    expect(reading.state).toBe('never');
    expect(reading.unit).toBe('V');
  });
});

describe('tileById battery: pattern', () => {
  it('resolves a valid battery instance id', () => {
    const def = tileById('battery:house');
    expect(def).toBeDefined();
    expect(def?.id).toBe('battery:house');
  });

  it('resolves battery ids with digits and hyphens', () => {
    expect(tileById('battery:bank-1')).toBeDefined();
    expect(tileById('battery:b2')).toBeDefined();
  });

  it('returns undefined for battery: ids with invalid characters', () => {
    expect(tileById('battery:has space')).toBeUndefined();
    expect(tileById('battery:has.dot')).toBeUndefined();
    expect(tileById('battery:')).toBeUndefined();
  });

  it('still resolves all static tile ids', () => {
    for (const def of TILE_CATALOG) {
      expect(tileById(def.id), `tileById('${def.id}')`).toBeDefined();
    }
  });
});

describe('CLIENT_DEFAULT_ZONES', () => {
  it('contains an entry for the depth path', () => {
    expect(CLIENT_DEFAULT_ZONES.has(SK_PATHS.depthBelowKeel)).toBe(true);
  });

  it('depth zones: value 1.5 → alarm, 3 → warning (warn maps to warning), 10 → normal (outside zones)', () => {
    // Verify the zone values directly without going through the controller, so the test is
    // a pure data check independent of zoneStateFor.
    const zones = CLIENT_DEFAULT_ZONES.get(SK_PATHS.depthBelowKeel);
    expect(zones).toBeDefined();
    expect(zones?.some((z) => z.upper === 2 && z.state === 'alarm')).toBe(true);
    expect(zones?.some((z) => z.lower === 2 && z.upper === 5 && z.state === 'warn')).toBe(true);
  });
});

describe('water-temp tile', () => {
  it('formats Celsius with unit °C in metric mode', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock, 'metric');
    // 294.62 K = 21.47 °C, rounded to whole degrees like the weather panel.
    deps.store.applyFrame(skFrame({ [SK_PATHS.waterTemperature]: 294.62 }, 1000));
    const reading = readTile('water-temp', deps);
    expect(reading.state).toBe('live');
    expect(reading.unit).toBe('°C');
    expect(reading.value).toBe('21');
    expect(reading.siValue).toBeCloseTo(294.62);
  });

  it('formats Fahrenheit with unit °F in imperial mode', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock, 'imperial');
    // 294.62 K ≈ 70.65 °F → 71
    deps.store.applyFrame(skFrame({ [SK_PATHS.waterTemperature]: 294.62 }, 1000));
    const reading = readTile('water-temp', deps);
    expect(reading.unit).toBe('°F');
    expect(reading.value).toBe('71');
  });

  it('has viz spark', () => {
    expect(tileById('water-temp')?.viz).toBe('spark');
  });
});

describe('air-temp tile', () => {
  it('reads environment.outside.temperature and formats per mode', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock, 'metric');
    deps.store.applyFrame(skFrame({ [SK_PATHS.outsideTemperature]: 300 }, 1000));
    const reading = readTile('air-temp', deps);
    expect(reading.state).toBe('live');
    expect(reading.unit).toBe('°C');
    // 300 K = 26.85 °C → 27
    expect(reading.value).toBe('27');
  });
});

describe('gnss-satellites tile', () => {
  it('renders the integer count with no unit and no viz', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.store.applyFrame(skFrame({ [SK_PATHS.gnssSatellites]: 20 }, 1000));
    const reading = readTile('gnss-satellites', deps);
    expect(reading.state).toBe('live');
    expect(reading.value).toBe('20');
    expect(reading.unit).toBe('');
    expect(tileById('gnss-satellites')?.viz).toBeUndefined();
  });
});

describe('rate-of-turn tile', () => {
  it('renders signed degrees per minute at one decimal with unit °/min', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    // 0.0043633 rad/s * (180/π) * 60 ≈ 15.0 °/min
    deps.store.applyFrame(skFrame({ [SK_PATHS.rateOfTurn]: 0.0043633 }, 1000));
    const reading = readTile('rate-of-turn', deps);
    expect(reading.state).toBe('live');
    expect(reading.value).toBe('15.0');
    expect(reading.unit).toBe('°/min');
    expect(reading.siValue).toBeCloseTo(0.0043633);
  });

  it('keeps the sign for a turn to port (negative rad/s)', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    deps.store.applyFrame(skFrame({ [SK_PATHS.rateOfTurn]: -0.0043633 }, 1000));
    const reading = readTile('rate-of-turn', deps);
    expect(reading.value).toBe('-15.0');
  });

  it('has viz rot', () => {
    expect(tileById('rate-of-turn')?.viz).toBe('rot');
  });
});

describe('batterySocTileDef', () => {
  it('generates the SOC id, path, full label, and battery viz', () => {
    const def = batterySocTileDef('house');
    expect(def.id).toBe('battery-soc:house');
    expect(def.label).toBe('State of charge · House battery');
    expect(def.abbr).toBeUndefined();
    expect(def.viz).toBe('battery');
    expect(def.paths).toEqual(['electrical.batteries.house.capacity.stateOfCharge']);
    expect(def.sensorGloss).toBe('No charge data');
  });

  it('renders a 0..1 ratio as a whole-number percent with unit %', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    const def = batterySocTileDef('house');
    deps.store.ensureCells(def.paths);
    deps.store.applyFrame(
      skFrame({ 'electrical.batteries.house.capacity.stateOfCharge': 0.82 }, 1000),
    );
    const reading = def.read(deps);
    expect(reading.state).toBe('live');
    expect(reading.value).toBe('82');
    expect(reading.unit).toBe('%');
    expect(reading.siValue).toBeCloseTo(0.82);
  });

  it('resolves via tileById', () => {
    expect(tileById('battery-soc:house')?.id).toBe('battery-soc:house');
  });
});

describe('batteryTimeTileDef', () => {
  it('renders time remaining via formatDuration', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    const def = batteryTimeTileDef('house');
    deps.store.ensureCells(def.paths);
    // 45600 s = 760 min → "12h 40m"
    deps.store.applyFrame(
      skFrame({ 'electrical.batteries.house.capacity.timeRemaining': 45600 }, 1000),
    );
    const reading = def.read(deps);
    expect(reading.state).toBe('live');
    expect(reading.value).toBe('12h 40m');
    expect(reading.unit).toBe('');
    expect(def.label).toBe('Time remaining · House battery');
    expect(def.abbr).toBe('TIME');
    expect(def.viz).toBeUndefined();
  });

  it("a reported-then-null cell grades 'placeholder' with the dash, never a fake number", () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    const def = batteryTimeTileDef('house');
    deps.store.ensureCells(def.paths);
    // Battery full or charging: the server reports null for timeRemaining.
    deps.store.applyFrame(
      skFrame({ 'electrical.batteries.house.capacity.timeRemaining': null }, 1000),
    );
    const reading = def.read(deps);
    expect(reading.state).toBe('placeholder');
    expect(reading.value).toBe(PLACEHOLDER);
  });

  it("a never-reported cell grades 'never'", () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    const def = batteryTimeTileDef('house');
    deps.store.ensureCells(def.paths);
    const reading = def.read(deps);
    expect(reading.state).toBe('never');
    expect(reading.value).toBe(PLACEHOLDER);
  });

  it('resolves via tileById', () => {
    expect(tileById('battery-time:house')?.id).toBe('battery-time:house');
  });
});

describe('batteryCurrentTileDef', () => {
  it('renders signed amps at one decimal with unit A and spark viz', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    const def = batteryCurrentTileDef('house');
    deps.store.ensureCells(def.paths);
    // Negative current = discharge.
    deps.store.applyFrame(skFrame({ 'electrical.batteries.house.current': -12.34 }, 1000));
    const reading = def.read(deps);
    expect(reading.state).toBe('live');
    expect(reading.value).toBe('-12.3');
    expect(reading.unit).toBe('A');
    expect(reading.siValue).toBeCloseTo(-12.34);
    expect(def.label).toBe('Current · House battery');
    expect(def.abbr).toBe('AMPS');
    expect(def.viz).toBe('spark');
  });

  it('resolves via tileById', () => {
    expect(tileById('battery-current:house')?.id).toBe('battery-current:house');
  });
});

describe('batteryStatusTileDef', () => {
  it('generates the battery face id, paths, and kind', () => {
    const def = batteryStatusTileDef('house');
    expect(def.id).toBe('battery-status:house');
    expect(def.label).toBe('Battery · House battery');
    expect(def.paths).toEqual([
      'electrical.batteries.house.capacity.stateOfCharge',
      'electrical.batteries.house.power',
      'electrical.batteries.house.current',
      'electrical.batteries.house.voltage',
    ]);
    expect(def.zonesPath).toBe('electrical.batteries.house.capacity.stateOfCharge');
    expect(def.kind).toBe('battery');
    expect(def.sensorGloss).toBe('No battery data');
  });

  it('reads percent, watts, amps, and volts with per-metric grades', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    const def = batteryStatusTileDef('house');
    deps.store.ensureCells(def.paths);
    deps.store.applyFrame(
      skFrame(
        {
          'electrical.batteries.house.capacity.stateOfCharge': 0.87,
          'electrical.batteries.house.power': -1240,
          'electrical.batteries.house.current': -100,
          'electrical.batteries.house.voltage': 12.4,
        },
        1000,
      ),
    );
    const reading = def.read(deps);
    expect(reading.state).toBe('live');
    expect(reading.value).toBe('87');
    expect(reading.unit).toBe('%');
    expect(reading.siValue).toBeCloseTo(0.87);
    expect(reading.battery?.soc.value).toBe('87');
    // 1240 W is above the kW threshold, so the unit steps to kW rather than a four-digit watt count.
    expect(reading.battery?.power.value).toBe('-1.2');
    expect(reading.battery?.power.unit).toBe('kW');
    expect(reading.battery?.power.siValue).toBeCloseTo(-1240);
    expect(reading.battery?.current.value).toBe('-100.0');
    expect(reading.battery?.current.unit).toBe('A');
    expect(reading.battery?.voltage.value).toBe('12.4');
    expect(reading.battery?.voltage.unit).toBe('V');
  });

  it('derives power from current times voltage when the power path is absent', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    const def = batteryStatusTileDef('house');
    deps.store.ensureCells(def.paths);
    deps.store.applyFrame(
      skFrame(
        {
          'electrical.batteries.house.capacity.stateOfCharge': 0.62,
          'electrical.batteries.house.current': -24.5,
          'electrical.batteries.house.voltage': 12.6,
        },
        1000,
      ),
    );
    const reading = def.read(deps);
    expect(reading.battery?.power.siValue).toBeCloseTo(-308.7, 0);
    expect(reading.battery?.power.value).toBe('-309');
    expect(reading.battery?.power.unit).toBe('W');
    // The power path itself never reported, so its own metric grades 'never' even though the
    // derived wattage is shown.
    expect(reading.battery?.power.state).toBe('never');
  });

  it('grades the tile never when no battery path has ever reported', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    const def = batteryStatusTileDef('house');
    deps.store.ensureCells(def.paths);
    const reading = def.read(deps);
    expect(reading.state).toBe('never');
    expect(reading.value).toBe(PLACEHOLDER);
    expect(reading.battery?.soc.state).toBe('never');
  });

  it('is part of batteryDefsFor and resolves via tileById', () => {
    expect(batteryDefsFor('house').map((d) => d.id)).toContain('battery-status:house');
    expect(tileById('battery-status:house')?.id).toBe('battery-status:house');
  });
});

describe('dynamic non-battery tile defs', () => {
  it('renders propulsion revolutions as RPM and resolves through tileById', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    const def = propulsionRpmTileDef('port');
    deps.store.ensureCells(def.paths);
    deps.store.applyFrame(skFrame({ 'propulsion.port.revolutions': 20 }, 1000));
    const reading = def.read(deps);
    expect(reading.value).toBe('1200');
    expect(reading.unit).toBe('rpm');
    expect(def.label).toBe('RPM · Port engine');
    expect(def.abbr).toBe('RPM');
    expect(tileById('prop-rpm:port')?.category).toBe('propulsion');
  });

  it('keeps the reading and source explicit across dynamic labels', () => {
    expect(propulsionLoadTileDef('port')).toMatchObject({
      label: 'Load · Port engine',
      abbr: 'LOAD',
    });
    expect(propulsionTemperatureTileDef('port')).toMatchObject({
      label: 'Temperature · Port engine',
      abbr: 'TEMP',
    });
    expect(tankLevelTileDef('freshWater.main')).toMatchObject({
      label: 'Level · Fresh Water Main tank',
      abbr: 'LEVEL',
    });
    expect(solarPowerTileDef('arch')).toMatchObject({
      label: 'Power · Arch solar',
      abbr: 'POWER',
    });
    expect(insideTemperatureTileDef('cabin')).toMatchObject({
      label: 'Temperature · Cabin',
      abbr: 'TEMP',
    });
  });

  it('keeps every generated option label unique within a source family', () => {
    for (const defs of [
      propulsionDefsFor('port'),
      tankDefsFor('freshWater.main'),
      solarDefsFor('arch'),
      insideDefsFor('cabin'),
    ]) {
      expect(new Set(defs.map((def) => def.label)).size).toBe(defs.length);
    }
  });

  it('resolves unique option names across the complete instrument catalog', () => {
    const defs = [
      ...TILE_CATALOG,
      ...batteryDefsFor('house'),
      ...propulsionDefsFor('port'),
      ...tankDefsFor('freshWater.main'),
      ...solarDefsFor('arch'),
      ...insideDefsFor('cabin'),
    ];
    const labels = [...instrumentOptionLabels(defs).values()].map((label) => label.toLowerCase());

    expect(new Set(labels).size).toBe(defs.length);
  });

  it('disambiguates repeated future catalog labels at the option boundary', () => {
    const rpm = propulsionRpmTileDef('port');
    const temperature = propulsionTemperatureTileDef('port');
    const labels = instrumentOptionLabels([
      { ...rpm, label: 'Port engine' },
      { ...temperature, label: 'Port engine' },
    ]);

    expect(labels.get(rpm.id)).toBe('RPM · Port engine');
    expect(labels.get(temperature.id)).toBe('TEMP · Port engine');
  });

  it('keeps option names unique when repeated definitions also share an abbreviation', () => {
    const first = propulsionRpmTileDef('port');
    const second = { ...first, id: 'prop-rpm:secondary' };
    const labels = [...instrumentOptionLabels([first, second]).values()];

    expect(new Set(labels).size).toBe(2);
  });

  it('renders tank level as percent and resolves through tileById', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    const def = tankLevelTileDef('fresh');
    deps.store.ensureCells(def.paths);
    deps.store.applyFrame(skFrame({ 'tanks.fresh.currentLevel': 0.64 }, 1000));
    const reading = def.read(deps);
    expect(reading.value).toBe('64');
    expect(reading.unit).toBe('%');
    expect(tileById('tank-level:fresh')?.category).toBe('tanks');
  });

  it('supports typed Signal K tank paths while rejecting dotted non-tank ids', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    const def = tankLevelTileDef('freshWater.main');
    deps.store.ensureCells(def.paths);
    deps.store.applyFrame(skFrame({ 'tanks.freshWater.main.currentLevel': 0.72 }, 1000));
    const reading = def.read(deps);
    expect(reading.value).toBe('72');
    expect(def.label).toBe('Level · Fresh Water Main tank');
    expect(tileById('tank-level:freshWater.main')?.paths).toEqual([
      'tanks.freshWater.main.currentLevel',
    ]);
    expect(tileById('battery:house.bank')).toBeUndefined();
  });

  it('renders solar panel power with W or kW units and resolves through tileById', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    const def = solarPowerTileDef('arch');
    deps.store.ensureCells(def.paths);
    deps.store.applyFrame(skFrame({ 'electrical.solar.arch.panelPower': 1250 }, 1000));
    const reading = def.read(deps);
    expect(reading.value).toBe('1.3');
    expect(reading.unit).toBe('kW');
    expect(tileById('solar-power:arch')?.category).toBe('electrical');
  });

  it('renders cabin humidity from relativeHumidity or humidity fallback', () => {
    const clock = { now: 1000 };
    const deps = makeDeps(clock);
    const def = insideHumidityTileDef('cabin');
    deps.store.ensureCells(def.paths);
    deps.store.applyFrame(skFrame({ 'environment.inside.cabin.humidity': 0.57 }, 1000));
    const reading = def.read(deps);
    expect(reading.value).toBe('57');
    expect(reading.unit).toBe('%');
    expect(tileById('inside-humidity:cabin')?.category).toBe('cabin');
  });
});
