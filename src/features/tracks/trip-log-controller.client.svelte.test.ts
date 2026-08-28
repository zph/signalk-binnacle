import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTrackSettings } from '$shared/settings';
import {
  type fetchHistoryValuesAcrossProviders,
  type HistoryValues,
  SK_PATHS,
} from '$shared/signalk';
import { createFakeStorage } from '$shared/testing';
import { createTripLogController } from './trip-log-controller.svelte';

const NOW = new Date(2026, 7, 27, 12).getTime();
const TODAY = '2026-08-27';
const EARLIER = '2026-08-23';
const cleanups: Array<() => void> = [];
type TripQuery = Parameters<typeof fetchHistoryValuesAcrossProviders>[3];

function history(
  date: string,
  rows: HistoryValues['rows'],
  columns: HistoryValues['columns'] = [
    { path: SK_PATHS.position, method: '' },
    { path: SK_PATHS.speedOverGround, method: '' },
    { path: SK_PATHS.windAngleApparent, method: '' },
  ],
): HistoryValues {
  return {
    from: `${date}T00:00:00.000Z`,
    to: `${date}T23:59:59.999Z`,
    columns,
    rows,
  };
}

function movingDay(date: string): HistoryValues {
  return history(
    date,
    [
      [`${date}T12:00:00.000Z`, { latitude: 38, longitude: -122 }, 1],
      [`${date}T12:10:00.000Z`, { latitude: 38.01, longitude: -121.99 }, 2],
    ],
    [
      { path: SK_PATHS.position, method: 'first' },
      { path: SK_PATHS.speedOverGround, method: 'average' },
    ],
  );
}

function windDay(date: string): HistoryValues {
  return history(
    date,
    [[`${date}T12:00:00.000Z`, 0.2]],
    [{ path: SK_PATHS.windAngleApparent, method: 'average' }],
  );
}

function setup(
  fetchValues: (
    origin: string,
    token: string | undefined,
    providers: { ids: readonly string[] },
    query: TripQuery,
  ) => Promise<{ values: HistoryValues; provider: string | undefined } | undefined>,
) {
  const settings = createTrackSettings(createFakeStorage());
  let controller!: ReturnType<typeof createTripLogController>;
  flushSync(() => {
    const destroyRoot = $effect.root(() => {
      controller = createTripLogController({
        origin: 'http://boat',
        getToken: () => 'token',
        providers: () => ({ ids: ['history'] }),
        settings,
        now: () => NOW,
        fetchValues,
      });
    });
    cleanups.push(() => {
      controller.dispose();
      destroyRoot();
    });
  });
  return { controller, settings };
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

describe('createTripLogController', () => {
  it('does not query history until the trip log is enabled', async () => {
    const fetchValues = vi.fn(async (_origin, _token, _providers, query: TripQuery) => ({
      values: query.paths.includes(SK_PATHS.position) ? movingDay(TODAY) : windDay(TODAY),
      provider: 'history',
    }));
    const { controller, settings } = setup(fetchValues);

    expect(controller.status).toBe('idle');
    expect(fetchValues).not.toHaveBeenCalled();

    settings.set({ ...settings.value, tripLogEnabled: true });
    await vi.waitFor(() => expect(controller.status).toBe('ready'));
    expect(controller.selectedDate).toBe(TODAY);
    expect(controller.day?.hasTravel).toBe(true);
    expect(controller.day?.portions[0]?.averageWindAngleRad).toBeCloseTo(0.2);
    expect(fetchValues).toHaveBeenCalledTimes(2);
  });

  it('falls back from an idle current day to the latest day with travel', async () => {
    const queries: TripQuery[] = [];
    const fetchValues = vi.fn(async (_origin, _token, _providers, query) => {
      queries.push(query);
      if (query.durationSeconds) {
        return {
          values: history(
            TODAY,
            [[`${EARLIER}T19:00:00.000Z`, 1]],
            [{ path: SK_PATHS.speedOverGround, method: 'max' }],
          ),
          provider: 'history',
        };
      }
      const requestedDate = query.from?.slice(0, 10);
      return {
        values: query.paths.includes(SK_PATHS.windAngleApparent)
          ? windDay(requestedDate ?? TODAY)
          : requestedDate === EARLIER
            ? movingDay(EARLIER)
            : history(TODAY, []),
        provider: 'history',
      };
    });
    const { controller, settings } = setup(fetchValues);

    settings.set({ ...settings.value, tripLogEnabled: true });
    await vi.waitFor(() => expect(controller.status).toBe('ready'));

    expect(controller.selectedDate).toBe(EARLIER);
    expect(controller.day?.hasTravel).toBe(true);
    expect(queries).toHaveLength(4);
    expect(queries[0]).toMatchObject({
      paths: [SK_PATHS.position, SK_PATHS.speedOverGround],
      resolutionSeconds: 60,
    });
    expect(queries[1]).toMatchObject({
      paths: [`${SK_PATHS.speedOverGround}:max`],
      durationSeconds: 366 * 24 * 60 * 60,
      resolutionSeconds: 15 * 60,
    });
    expect(queries[2].from?.slice(0, 10)).toBe(EARLIER);
    expect(queries[3]).toMatchObject({ paths: [SK_PATHS.windAngleApparent] });
  });
});
