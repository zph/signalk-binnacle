import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAlarmLocation } from '$shared/settings';
import { createFakeStorage } from '$shared/testing';
import { createAlarmLocationSettingsSync } from './alarm-location-settings-sync';

afterEach(() => vi.restoreAllMocks());

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('alarm location settings synchronization', () => {
  it('hydrates the server location into the persisted browser fallback', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ location: 'center' }));
    const alarmLocation = createAlarmLocation(createFakeStorage());
    const sync = createAlarmLocationSettingsSync({
      origin: 'http://boat',
      alarmLocation,
      getToken: () => '',
    });

    sync.observe(alarmLocation.value);
    await sync.hydrate();

    expect(alarmLocation.value).toBe('center');
    sync.dispose();
  });

  it('seeds an empty plugin from the browser fallback', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ location: null }))
      .mockResolvedValueOnce(response({ location: 'bottom' }));
    const alarmLocation = createAlarmLocation(createFakeStorage());
    const sync = createAlarmLocationSettingsSync({
      origin: 'http://boat',
      alarmLocation,
      getToken: () => 'token',
    });

    sync.observe(alarmLocation.value);
    await sync.hydrate();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'PUT',
      body: JSON.stringify({ location: 'bottom' }),
    });
    sync.dispose();
  });

  it('keeps and uploads a local edit made while hydration is in flight', async () => {
    let resolveLoad!: (value: Response) => void;
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => new Promise((resolve) => (resolveLoad = resolve)))
      .mockResolvedValueOnce(response({ location: 'top' }));
    const alarmLocation = createAlarmLocation(createFakeStorage());
    const sync = createAlarmLocationSettingsSync({
      origin: 'http://boat',
      alarmLocation,
      getToken: () => '',
    });

    sync.observe(alarmLocation.value);
    const hydration = sync.hydrate();
    alarmLocation.set('top');
    sync.observe(alarmLocation.value);
    resolveLoad(response({ location: 'center' }));
    await hydration;
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(alarmLocation.value).toBe('top');
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({ location: 'top' }));
    sync.dispose();
  });
});
