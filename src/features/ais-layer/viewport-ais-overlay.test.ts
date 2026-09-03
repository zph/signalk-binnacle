import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeMap, fakeOverlayContext, jsonResponse, sourceFeatures } from '$shared/testing';
import { createViewportAisOverlay } from './viewport-ais-overlay';

function viewMap(view: { west: number; south: number; east: number; north: number }) {
  return {
    ...createFakeMap(),
    getBounds: () => ({
      getWest: () => view.west,
      getSouth: () => view.south,
      getEast: () => view.east,
      getNorth: () => view.north,
    }),
  };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('viewport AIS overlay', () => {
  it('waits for a stable viewport, fetches it, renders targets, and follows a later pan', async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requested.push(url);
        const id = requested.length === 1 ? 'first' : 'second';
        return jsonResponse(200, {
          state: 'live',
          targets: [
            {
              id,
              mmsi: requested.length === 1 ? '111111111' : '222222222',
              name: id,
              position: { latitude: 41.5, longitude: requested.length === 1 ? -71.3 : -70.3 },
              lastReportAtMs: Date.now(),
            },
          ],
        });
      }),
    );
    const view = { west: -71.4, south: 41.4, east: -71.2, north: 41.6 };
    const map = viewMap(view);
    const ctx = fakeOverlayContext(map);
    const overlay = createViewportAisOverlay({
      origin: 'http://pi',
      getToken: () => 'token',
      available: () => true,
    });
    overlay.add(ctx);

    overlay.sync(ctx);
    vi.advanceTimersByTime(1_499);
    overlay.sync(ctx);
    expect(requested).toHaveLength(0);
    vi.advanceTimersByTime(1);
    overlay.sync(ctx);
    await flush();
    expect(requested).toHaveLength(1);
    expect(sourceFeatures(map, 'binnacle-viewport-ais-source')).toEqual([
      expect.objectContaining({ properties: expect.objectContaining({ id: 'first' }) }),
    ]);

    view.west = -70.4;
    view.east = -70.2;
    overlay.sync(ctx);
    vi.advanceTimersByTime(1_500);
    overlay.sync(ctx);
    await flush();
    expect(requested).toHaveLength(2);
    expect(JSON.parse(new URL(requested[1]).searchParams.get('bbox') ?? '')).toEqual([
      -70.5, 41.3, -70.1, 41.7,
    ]);
    expect(sourceFeatures(map, 'binnacle-viewport-ais-source')).toEqual([
      expect.objectContaining({ properties: expect.objectContaining({ id: 'second' }) }),
    ]);
  });
});
