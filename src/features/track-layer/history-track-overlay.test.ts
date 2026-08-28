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
              { position: { latitude: 10, longitude: 179 } },
              { position: { latitude: 12, longitude: -179 } },
            ],
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
