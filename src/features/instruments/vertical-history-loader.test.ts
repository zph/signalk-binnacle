import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TileDef } from './tile-catalog';
import { createTileHistory, maximumHistoryId } from './tile-history.svelte';
import { backfillVerticalTileHistory, pollVerticalTileHistory } from './vertical-history-loader';

const angleDef = {
  id: 'twa-history',
  paths: ['environment.wind.angleTrueWater', 'environment.wind.angleTrueGround'],
  zonesPath: 'environment.wind.angleTrueWater',
  viz: 'vertical-angle',
} as TileDef;

const speedDef = {
  id: 'tws-history',
  paths: ['environment.wind.speedTrue'],
  zonesPath: 'environment.wind.speedTrue',
  viz: 'vertical-speed',
} as TileDef;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('backfillVerticalTileHistory', () => {
  it('polls again as each five-second history bucket advances', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-10T18:10:10.000Z'));
    const fetchMock = vi.fn().mockImplementation(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            range: {
              from: '2026-09-10T18:00:00.000Z',
              to: '2026-09-10T18:10:00.000Z',
            },
            values: [{ path: 'environment.wind.angleTrueWater', method: 'average' }],
            data: [['2026-09-10T18:10:00.000Z', 0.25]],
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const stop = pollVerticalTileHistory(createTileHistory(), [angleDef], {
      origin: 'http://boat.test',
      providers: { ids: ['questdb'] },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const initialUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(initialUrl.searchParams.get('duration')).toBeNull();
    expect(initialUrl.searchParams.get('from')).toBe('2026-09-10T18:00:10.000Z');
    expect(initialUrl.searchParams.get('to')).toBe('2026-09-10T18:10:10.000Z');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const nextUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(nextUrl.searchParams.get('duration')).toBeNull();
    expect(nextUrl.searchParams.get('from')).toBe('2026-09-10T18:10:05.000Z');
    expect(nextUrl.searchParams.get('to')).toBe('2026-09-10T18:10:15.000Z');
    stop();
  });

  it('loads average and maximum TWS columns in one request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          range: {
            from: '2026-09-10T18:00:00.000Z',
            to: '2026-09-10T18:10:00.000Z',
          },
          values: [
            { path: 'environment.wind.speedTrue', method: 'average' },
            { path: 'environment.wind.speedTrue', method: 'max' },
          ],
          data: [['2026-09-10T18:00:00.000Z', 4, 7]],
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const history = createTileHistory();

    await backfillVerticalTileHistory(
      history,
      [speedDef],
      { origin: 'http://boat.test', providers: { ids: ['questdb'] } },
      new AbortController().signal,
    );

    expect(history.series('tws-history')).toEqual([4]);
    expect(history.series(maximumHistoryId('tws-history'))).toEqual([7]);
    const requestUrl = decodeURIComponent(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl).toContain(
      'paths=environment.wind.speedTrue:average,environment.wind.speedTrue:max',
    );
  });

  it('fills the tile from the first populated fallback path at five-second resolution', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          range: {
            from: '2026-09-10T18:00:00.000Z',
            to: '2026-09-10T18:10:00.000Z',
          },
          values: [
            { path: 'environment.wind.angleTrueWater', method: '' },
            { path: 'environment.wind.angleTrueGround', method: '' },
          ],
          data: [
            ['2026-09-10T18:00:00.000Z', null, 0.25],
            ['2026-09-10T18:00:05.000Z', null, 0.5],
          ],
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const history = createTileHistory();

    await backfillVerticalTileHistory(
      history,
      [angleDef],
      { origin: 'http://boat.test', token: 'token', providers: { ids: ['questdb'] } },
      new AbortController().signal,
    );

    expect(history.series('twa-history')).toEqual([0.25, 0.5]);
    expect(fetchMock).toHaveBeenCalledOnce();
    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestUrl).toContain('duration=600');
    expect(requestUrl).toContain('resolution=5');
  });

  it('loads a 24-hour window at an adaptive two-minute resolution', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          range: {
            from: '2026-09-09T18:10:00.000Z',
            to: '2026-09-10T18:10:00.000Z',
          },
          values: [{ path: 'environment.wind.angleTrueWater', method: 'average' }],
          data: [],
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await backfillVerticalTileHistory(
      createTileHistory(),
      [angleDef],
      { origin: 'http://boat.test', providers: { ids: ['questdb'] } },
      new AbortController().signal,
      Number.POSITIVE_INFINITY,
      undefined,
      { 'twa-history': 1_440 },
    );

    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestUrl).toContain('duration=86400');
    expect(requestUrl).toContain('resolution=120');
  });

  it('does not merge a response after cancellation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          range: {
            from: '2026-09-10T18:00:00.000Z',
            to: '2026-09-10T18:10:00.000Z',
          },
          values: [{ path: 'environment.wind.angleTrueWater', method: '' }],
          data: [['2026-09-10T18:00:00.000Z', 0.25]],
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const history = createTileHistory();
    const controller = new AbortController();
    controller.abort();

    await backfillVerticalTileHistory(
      history,
      [angleDef],
      { origin: 'http://boat.test', providers: { ids: ['questdb'] } },
      controller.signal,
    );

    expect(history.series('twa-history')).toEqual([]);
  });
});
