import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchBathymetrySoundings } from './bathymetry-soundings-client';

const fetchMock = vi.fn<typeof fetch>();

describe('fetchBathymetrySoundings', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  it('loads the selected cell, requests its raw records, and excludes bbox corner records', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            bounds: [-1, -1, 1, 1],
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-1, 0],
                  [0, -1],
                  [1, 0],
                  [0, 1],
                  [-1, 0],
                ],
              ],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            soundings: [sounding(1, 0, 0), sounding(2, 0.9, 0.9)],
          }),
          { status: 200 },
        ),
      );

    await expect(fetchBathymetrySoundings('http://boat.local', 'tok', 0, 0)).resolves.toEqual([
      expect.objectContaining({ id: 1, datumDepthM: 7.6, sampleCount: 30 }),
    ]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://boat.local/plugins/signalk-bathymetry/cells/lookup?latitude=0&longitude=0',
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'http://boat.local/plugins/signalk-bathymetry/soundings?bbox=-1%2C-1%2C1%2C1&limit=10000',
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({ Authorization: 'Bearer tok' });
  });

  it('rejects a malformed provider response', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ bounds: 'world', geometry: null }), { status: 200 }),
    );
    await expect(fetchBathymetrySoundings('http://boat.local', undefined, 1, 2)).resolves.toBe(
      undefined,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function sounding(id: number, latitude: number, longitude: number): Record<string, unknown> {
  return {
    id,
    observedAt: '2026-08-27T12:00:00.000Z',
    position: { latitude, longitude },
    rawDepthM: 8.1,
    datumDepthM: 7.6,
    tideHeightM: 0.5,
    verticalSigmaM: 0.45,
    sampleCount: 30,
    qcState: 'accepted',
    depthSource: 'environment.depth.belowKeel',
    passId: 'pass-1',
    aggregationKind: 'stationary_window',
  };
}
