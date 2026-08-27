import { describe, expect, it, vi } from 'vitest';
import { createTrackSettings } from '$shared/settings';
import { SK_PATHS } from '$shared/signalk';
import {
  createFakeMap,
  createFakeStorage,
  fakeOverlayContext,
  sourceFeatures,
} from '$shared/testing';
import { createHistoryTrackOverlay, detectTrackStops } from './history-track-overlay';

const settings = () => createTrackSettings(createFakeStorage());

describe('createHistoryTrackOverlay', () => {
  it('splits a historical track crossing the antimeridian', async () => {
    const fetchValues = vi.fn(async () => ({
      provider: 'history',
      values: {
        from: '2026-06-08T00:00:00Z',
        to: '2026-06-08T00:01:00Z',
        columns: [{ path: SK_PATHS.position, method: '' }],
        rows: [
          ['2026-06-08T00:00:00Z', { latitude: 10, longitude: 179 }],
          ['2026-06-08T00:01:00Z', { latitude: 12, longitude: -179 }],
        ] as const,
      },
    }));
    const overlay = createHistoryTrackOverlay(
      'http://sk',
      () => 'token',
      () => ({ ids: ['history'] }),
      settings(),
      () => false,
      { fetchValues, now: () => 1 },
    );
    const map = createFakeMap();
    const context = fakeOverlayContext(map);
    await overlay.add(context);

    overlay.sync(context);

    await vi.waitFor(() =>
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
      }),
    );
  });

  it('hides during time travel without changing its accepted visibility', async () => {
    let reviewing = false;
    const fetchValues = vi.fn(async () => undefined);
    const overlay = createHistoryTrackOverlay(
      'http://sk',
      () => 'token',
      () => ({ ids: ['history'] }),
      settings(),
      () => reviewing,
      { fetchValues, now: () => 1 },
    );
    const map = createFakeMap();
    const context = fakeOverlayContext(map);
    await overlay.add(context);
    overlay.setVisible(context, true);

    reviewing = true;
    overlay.sync(context);
    expect(map.setLayoutProperty).toHaveBeenCalledWith(
      'binnacle-track-history-line',
      'visibility',
      'none',
    );
    expect(fetchValues).not.toHaveBeenCalled();

    reviewing = false;
    overlay.sync(context);
    expect(map.setLayoutProperty).toHaveBeenCalledWith(
      'binnacle-track-history-line',
      'visibility',
      'visible',
    );
    expect(fetchValues).toHaveBeenCalledOnce();
  });

  it('detects a stop below the configured speed for the configured duration', () => {
    const rows = Array.from(
      { length: 8 },
      (_, index) =>
        [
          new Date(Date.UTC(2026, 7, 27, 12, index)).toISOString(),
          { latitude: 20 + index * 0.00001, longitude: -87 },
          index === 7 ? 0.2 : 0.05,
        ] as const,
    );
    const stops = detectTrackStops(
      {
        from: rows[0][0],
        to: rows.at(-1)?.[0] ?? rows[0][0],
        columns: [
          { path: SK_PATHS.position, method: '' },
          { path: SK_PATHS.speedOverGround, method: '' },
        ],
        rows,
      },
      0.15,
      5,
    );

    expect(stops).toEqual([
      expect.objectContaining({
        position: { latitude: 20, longitude: -87 },
        durationSeconds: 360,
      }),
    ]);
  });

  it('does not bridge missing samples into a stop', () => {
    const values = {
      from: '2026-08-27T12:00:00.000Z',
      to: '2026-08-27T12:10:00.000Z',
      columns: [
        { path: SK_PATHS.position, method: '' },
        { path: SK_PATHS.speedOverGround, method: '' },
      ],
      rows: [
        ['2026-08-27T12:00:00.000Z', { latitude: 20, longitude: -87 }, 0.01],
        ['2026-08-27T12:10:00.000Z', { latitude: 20, longitude: -87 }, 0.01],
      ],
    } as const;

    expect(detectTrackStops(values, 0.15, 5)).toEqual([]);
  });
});
