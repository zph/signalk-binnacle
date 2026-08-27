import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadAlarmLocationSettings,
  saveAlarmLocationSettings,
} from './alarm-location-settings-client';

const BASE = 'http://boat';

afterEach(() => vi.restoreAllMocks());

describe('alarm location settings client', () => {
  it('loads a configured location with bearer authentication', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ location: 'center' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(loadAlarmLocationSettings(BASE, 'token')).resolves.toEqual({
      state: 'configured',
      location: 'center',
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://boat/plugins/binnacle-custom/api/settings/alarm-location',
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({ Authorization: 'Bearer token' });
  });

  it('rejects malformed locations and distinguishes empty from unavailable', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ location: 'port' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ location: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response('', { status: 404 }));

    await expect(loadAlarmLocationSettings(BASE, undefined)).resolves.toEqual({ state: 'failed' });
    await expect(loadAlarmLocationSettings(BASE, undefined)).resolves.toEqual({ state: 'empty' });
    await expect(loadAlarmLocationSettings(BASE, undefined)).resolves.toEqual({
      state: 'unavailable',
    });
  });

  it('writes a validated location', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ location: 'top' }), { status: 200 }));

    await expect(saveAlarmLocationSettings(BASE, 'token', 'top')).resolves.toBe('ok');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'PUT',
      body: JSON.stringify({ location: 'top' }),
    });
  });
});
