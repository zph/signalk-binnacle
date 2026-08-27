import { afterEach, describe, expect, it, vi } from 'vitest';
import { createThresholds, DEFAULT_THRESHOLDS } from '$shared/settings';
import { createFakeStorage } from '$shared/testing';
import { createCollisionSettingsSync } from './collision-settings-sync';

afterEach(() => vi.restoreAllMocks());

const serverThresholds = {
  dangerCpaMeters: 300,
  dangerTcpaSeconds: 420,
  warningCpaMeters: 1_400,
  warningTcpaSeconds: 1_500,
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('collision settings synchronization', () => {
  it('hydrates plugin thresholds into the persisted browser fallback', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ thresholds: serverThresholds }));
    const thresholds = createThresholds(createFakeStorage());
    const sync = createCollisionSettingsSync({
      origin: 'http://boat',
      thresholds,
      getToken: () => '',
    });
    sync.observe(thresholds.value);
    await sync.hydrate();
    expect(thresholds.value).toEqual({
      ...serverThresholds,
      shallowDepthMeters: DEFAULT_THRESHOLDS.shallowDepthMeters,
    });
    sync.dispose();
  });

  it('seeds an empty plugin from the current browser fallback', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ thresholds: null }))
      .mockResolvedValueOnce(response({ thresholds: serverThresholds }));
    const thresholds = createThresholds(createFakeStorage());
    const sync = createCollisionSettingsSync({
      origin: 'http://boat',
      thresholds,
      getToken: () => 'token',
    });
    sync.observe(thresholds.value);
    await sync.hydrate();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'PUT',
      body: JSON.stringify({
        thresholds: {
          dangerCpaMeters: DEFAULT_THRESHOLDS.dangerCpaMeters,
          dangerTcpaSeconds: DEFAULT_THRESHOLDS.dangerTcpaSeconds,
          warningCpaMeters: DEFAULT_THRESHOLDS.warningCpaMeters,
          warningTcpaSeconds: DEFAULT_THRESHOLDS.warningTcpaSeconds,
        },
      }),
    });
    sync.dispose();
  });

  it('keeps and uploads a local edit made while hydration is in flight', async () => {
    let resolveLoad!: (value: Response) => void;
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => new Promise((resolve) => (resolveLoad = resolve)))
      .mockResolvedValueOnce(response({ thresholds: serverThresholds }));
    const thresholds = createThresholds(createFakeStorage());
    const sync = createCollisionSettingsSync({
      origin: 'http://boat',
      thresholds,
      getToken: () => '',
    });
    sync.observe(thresholds.value);
    const hydration = sync.hydrate();
    thresholds.set({ ...thresholds.value, dangerTcpaSeconds: 900 });
    sync.observe(thresholds.value);
    resolveLoad(response({ thresholds: serverThresholds }));
    await hydration;
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(thresholds.value.dangerTcpaSeconds).toBe(900);
    expect(fetchMock.mock.calls[1]?.[1]?.body).toContain('"dangerTcpaSeconds":900');
    sync.dispose();
  });
});
