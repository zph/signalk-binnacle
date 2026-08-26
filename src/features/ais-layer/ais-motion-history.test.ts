import { describe, expect, it, vi } from 'vitest';
import { SK_PATHS } from '$shared/signalk';
import { fetchAisMotionHistory } from './ais-motion-history';

const NOW = Date.parse('2026-08-26T12:01:00Z');

describe('fetchAisMotionHistory', () => {
  it('queries the selected vessel context and returns recent ordered positions', async () => {
    const mock = vi.fn(
      async (_request: RequestInfo | URL) =>
        new Response(
          JSON.stringify({
            range: { from: '2026-08-26T11:59:45Z', to: '2026-08-26T12:01:00Z' },
            values: [{ path: SK_PATHS.position }],
            data: [
              ['2026-08-26T12:00:55Z', { latitude: 42.001, longitude: -83 }],
              ['2026-08-26T12:00:00Z', { latitude: 42, longitude: -83 }],
              ['2026-08-26T11:59:55Z', { latitude: 41, longitude: -82 }],
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', mock);

    await expect(
      fetchAisMotionHistory(
        'http://boat.local',
        'token',
        { ids: ['signalk-questdb'] },
        'vessels.urn:mrn:imo:mmsi:111111111',
        NOW,
      ),
    ).resolves.toEqual([
      { at: Date.parse('2026-08-26T12:00:00Z'), latitude: 42, longitude: -83 },
      { at: Date.parse('2026-08-26T12:00:55Z'), latitude: 42.001, longitude: -83 },
    ]);
    const url = new URL(String(mock.mock.calls[0]?.[0]));
    expect(url.searchParams.get('context')).toBe('vessels.urn:mrn:imo:mmsi:111111111');
    expect(url.searchParams.get('duration')).toBe('75');
    expect(url.searchParams.get('resolution')).toBe('5');
    expect(url.searchParams.get('provider')).toBe('signalk-questdb');
  });

  it('does not query a non-vessel context or an empty provider list', async () => {
    const mock = vi.fn();
    vi.stubGlobal('fetch', mock);
    await expect(
      fetchAisMotionHistory('http://boat.local', undefined, { ids: ['provider'] }, 'self', NOW),
    ).resolves.toEqual([]);
    await expect(
      fetchAisMotionHistory('http://boat.local', undefined, { ids: [] }, 'vessels.target', NOW),
    ).resolves.toEqual([]);
    expect(mock).not.toHaveBeenCalled();
  });
});
