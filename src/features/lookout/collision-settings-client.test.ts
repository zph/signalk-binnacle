import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_THRESHOLDS } from '$shared/settings';
import {
  collisionThresholdSettings,
  loadCollisionSettings,
  mergeCollisionThresholdSettings,
  saveCollisionSettings,
} from './collision-settings-client';

const BASE = 'http://boat';
const stored = collisionThresholdSettings(DEFAULT_THRESHOLDS);

afterEach(() => vi.restoreAllMocks());

describe('collision settings client', () => {
  it('loads a configured server document with bearer authentication', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ thresholds: stored }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(loadCollisionSettings(BASE, 'token')).resolves.toEqual({
      state: 'configured',
      thresholds: stored,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://boat/plugins/binnacle-custom/api/settings/collision',
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({ Authorization: 'Bearer token' });
  });

  it('distinguishes an unconfigured plugin from an absent plugin', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ thresholds: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response('', { status: 404 }));
    await expect(loadCollisionSettings(BASE, undefined)).resolves.toEqual({ state: 'empty' });
    await expect(loadCollisionSettings(BASE, undefined)).resolves.toEqual({
      state: 'unavailable',
    });
  });

  it('writes the full collision document and preserves local shallow depth when merging', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ thresholds: stored }), { status: 200 }));
    await expect(saveCollisionSettings(BASE, 'token', stored)).resolves.toBe('ok');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'PUT',
      body: JSON.stringify({ thresholds: stored }),
    });
    expect(
      mergeCollisionThresholdSettings({ ...DEFAULT_THRESHOLDS, shallowDepthMeters: 7 }, stored),
    ).toMatchObject({ ...stored, shallowDepthMeters: 7 });
  });
});
