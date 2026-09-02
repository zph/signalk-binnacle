import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMoorings } from './moorings-client';

afterEach(() => vi.unstubAllGlobals());

describe('mooring client', () => {
  it('falls back across every NOAA scale band and prefers the most detailed duplicate', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.hostname === 'signal-k.test') return new Response('', { status: 404 });
      const layer = Number(url.pathname.split('/').at(-2));
      return new Response(
        JSON.stringify({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [-70.7, 41.5] },
              properties: {
                OBJECTID: layer,
                CATMOR: 'Mooring buoy',
                OBJNAM: `Layer ${layer}`,
                DSNM: `US${layer}`,
              },
            },
          ],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchMoorings('https://signal-k.test', undefined, [-71, 41, -70, 42]);

    expect(result).toHaveLength(1);
    expect(result?.[0]).toMatchObject({
      id: 'noaa-enc:berthing:US27:27',
      name: 'Layer 27',
      scaleBand: 'berthing',
    });
    const noaaRequests = fetchMock.mock.calls
      .map((call) => new URL(String(call[0])))
      .filter((url) => url.hostname === 'encdirect.noaa.gov');
    expect(noaaRequests).toHaveLength(6);
  });
});
