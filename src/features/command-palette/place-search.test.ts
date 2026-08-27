import { describe, expect, it, vi } from 'vitest';
import type { PlaceSearchItem } from './place-search';
import { searchPlaces } from './place-search';

const local: PlaceSearchItem = {
  id: 'waypoint:1',
  name: 'Quiet Cove',
  position: { latitude: 38.1, longitude: -122.2 },
  source: 'Waypoint',
};

describe('searchPlaces', () => {
  it('returns local layer matches without a network request for a short query', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const result = await searchPlaces('co', {
      localItems: [local],
      signal: new AbortController().signal,
      fetcher,
    });
    expect(result).toEqual({ items: [local], onlineUnavailable: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps local matches when online search is unavailable', async () => {
    const result = await searchPlaces('quiet', {
      localItems: [local],
      signal: new AbortController().signal,
      fetcher: vi.fn().mockRejectedValue(new TypeError('offline')),
    });
    expect(result).toEqual({ items: [local], onlineUnavailable: true });
  });

  it('validates Photon results and merges them after local matches', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          features: [
            {
              geometry: { type: 'Point', coordinates: [-122.42, 37.77] },
              properties: { name: 'San Francisco', state: 'California', country: 'United States' },
            },
            {
              geometry: { type: 'Point', coordinates: [999, 37.77] },
              properties: { name: 'Invalid' },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const result = await searchPlaces('quiet san', {
      localItems: [local],
      signal: new AbortController().signal,
      bias: local.position,
      fetcher,
    });
    expect(result.onlineUnavailable).toBe(false);
    expect(result.items.map((item) => item.name)).toEqual(['San Francisco']);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('lat=38.1');
  });
});
