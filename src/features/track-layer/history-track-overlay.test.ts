import { describe, expect, it, vi } from 'vitest';
import { createTrackSettings } from '$shared/settings';
import {
  createFakeMap,
  createFakeStorage,
  fakeOverlayContext,
  sourceFeatures,
} from '$shared/testing';
import { createHistoryTrackOverlay, type TripLogView } from './history-track-overlay';

function settings() {
  const value = createTrackSettings(createFakeStorage());
  value.set({ ...value.value, tripLogEnabled: true });
  return value;
}

interface TestTripLog extends TripLogView {
  selectedDate: string;
  today: string;
  status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';
  version: number;
  selectDate: ReturnType<typeof vi.fn>;
  selectLatest: ReturnType<typeof vi.fn>;
  previousDay: ReturnType<typeof vi.fn>;
  nextDay: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

function controller(overrides: Partial<TestTripLog> = {}): TestTripLog {
  return {
    day: undefined,
    selectedDate: '2026-08-27',
    today: '2026-08-27',
    status: 'ready',
    version: 1,
    selectDate: vi.fn(),
    selectLatest: vi.fn(),
    previousDay: vi.fn(),
    nextDay: vi.fn(),
    refresh: vi.fn(),
    dispose: vi.fn(),
    ...overrides,
  };
}

describe('createHistoryTrackOverlay', () => {
  it('draws daily portions across the antimeridian with direction and duration features', async () => {
    const tripLog = controller({
      day: {
        stops: [],
        portions: [
          {
            points: [
              {
                position: { latitude: 10, longitude: 179 },
                timestamp: 0,
                speedMps: 2,
                windSpeedMps: 5,
                windDirectionRad: 0,
                windReference: 'true',
              },
              {
                position: { latitude: 12, longitude: -179 },
                timestamp: 60_000,
                speedMps: 2,
                windSpeedMps: 6,
                windDirectionRad: Math.PI / 2,
                windReference: 'true',
              },
            ],
            id: 'portion',
            startedAt: 0,
            endedAt: 60_000,
            averageSpeedMps: 2,
            durationSeconds: 60,
            labelPosition: { latitude: 12, longitude: -179 },
          },
        ],
      },
    });
    const overlay = createHistoryTrackOverlay(settings(), tripLog);
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));

    expect(sourceFeatures(map, 'binnacle-track-history')[0]?.geometry).toEqual({
      type: 'MultiLineString',
      coordinates: [
        [
          [179, 10],
          [180, 11],
        ],
        [
          [-180, 11],
          [-179, 12],
        ],
      ],
    });
    expect(sourceFeatures(map, 'binnacle-track-history')[1]?.properties).toEqual({
      kind: 'duration',
      label: '1 min',
    });
    const features = sourceFeatures(map, 'binnacle-track-history');
    expect(features.filter((feature) => feature.properties?.kind === 'annotation')).toHaveLength(2);
    expect(features.filter((feature) => feature.properties?.kind === 'wind-barb')).toHaveLength(2);
    expect(features.filter((feature) => feature.properties?.kind === 'minute-segment')).toEqual([
      expect.objectContaining({ properties: { kind: 'minute-segment', timestamp: 0 } }),
    ]);
    expect(map.handlerCount('click', 'binnacle-track-history-minute-hits')).toBe(1);
  });

  it('hides during time travel without changing its accepted visibility', async () => {
    let reviewing = false;
    const overlay = createHistoryTrackOverlay(settings(), controller(), () => reviewing);
    const map = createFakeMap();
    const context = fakeOverlayContext(map);
    await overlay.add(context);

    reviewing = true;
    overlay.sync(context);
    expect(map.setLayoutProperty).toHaveBeenCalledWith(
      'binnacle-track-history-line',
      'visibility',
      'none',
    );

    reviewing = false;
    overlay.sync(context);
    expect(map.setLayoutProperty).toHaveBeenCalledWith(
      'binnacle-track-history-line',
      'visibility',
      'visible',
    );
  });
});
