import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const createPlugin = require('./index.cjs') as (app: AppStub) => PluginStub;

interface AppStub {
  error: ReturnType<typeof vi.fn>;
  getDataDirPath?: () => string;
  savePluginOptions: (
    options: object,
    callback: (error: NodeJS.ErrnoException | null) => void,
  ) => void;
  setPluginError: ReturnType<typeof vi.fn>;
  setPluginStatus: ReturnType<typeof vi.fn>;
}

interface ResponseStub {
  body?: unknown;
  code: number;
  headers: Record<string, string>;
  json: (value: unknown) => ResponseStub;
  set: (key: string, value: string) => ResponseStub;
  status: (code: number) => ResponseStub;
}

interface PluginStub {
  start: (options: object) => void;
  stop: () => void;
  registerWithRouter: (router: RouterStub) => void;
}

interface RouterStub {
  access: (level: string) => {
    get: (path: string, handler: RouteHandler) => void;
    put: (path: string, handler: RouteHandler) => void;
  };
}

type RouteHandler = (
  request: { body?: unknown; query?: Record<string, unknown> },
  response: ResponseStub,
) => void | Promise<void>;

const thresholds = {
  dangerCpaMeters: 463,
  dangerTcpaSeconds: 480,
  warningCpaMeters: 1_852,
  warningTcpaSeconds: 1_800,
};
const alarmLocation = 'center';

function harness(
  initial: object = {},
  savePluginOptions?: AppStub['savePluginOptions'],
  dataDirectory?: string,
) {
  const routes = new Map<string, RouteHandler>();
  const app: AppStub = {
    error: vi.fn(),
    getDataDirPath: dataDirectory ? () => dataDirectory : undefined,
    savePluginOptions: savePluginOptions ?? vi.fn((_options, callback) => callback(null)),
    setPluginError: vi.fn(),
    setPluginStatus: vi.fn(),
  };
  const plugin = createPlugin(app);
  const router: RouterStub = {
    access: (level) => ({
      get: (path, handler) => routes.set(`${level}:GET:${path}`, handler),
      put: (path, handler) => routes.set(`${level}:PUT:${path}`, handler),
    }),
  };
  plugin.start(initial);
  plugin.registerWithRouter(router);
  const response = (): ResponseStub => {
    const value: ResponseStub = {
      code: 200,
      headers: {},
      json(body) {
        value.body = body;
        return value;
      },
      set(key, header) {
        value.headers[key] = header;
        return value;
      },
      status(code) {
        value.code = code;
        return value;
      },
    };
    return value;
  };
  return { app, plugin, response, routes };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Binnacle server settings plugin', () => {
  it('serves stored thresholds to readonly clients without caching', async () => {
    const test = harness({ collisionThresholds: thresholds });
    const response = test.response();
    await test.routes.get('readonly:GET:/api/settings/collision')?.({}, response);
    expect(response.body).toEqual({ thresholds });
    expect(response.headers['Cache-Control']).toBe('no-store');
  });

  it('persists validated thresholds for readwrite clients', async () => {
    const test = harness();
    const response = test.response();
    await test.routes.get('readwrite:PUT:/api/settings/collision')?.(
      { body: { thresholds } },
      response,
    );
    expect(response.code).toBe(200);
    expect(test.app.savePluginOptions).toHaveBeenCalledWith(
      { collisionThresholds: thresholds },
      expect.any(Function),
    );

    const loaded = test.response();
    await test.routes.get('readonly:GET:/api/settings/collision')?.({}, loaded);
    expect(loaded.body).toEqual({ thresholds });
  });

  it('serves and persists the alarm location while preserving thresholds', async () => {
    const test = harness({
      collisionThresholds: thresholds,
      alarmLocation: 'top',
    });
    const response = test.response();
    await test.routes.get('readonly:GET:/api/settings/alarm-location')?.({}, response);
    expect(response.body).toEqual({ location: 'top' });
    expect(response.headers['Cache-Control']).toBe('no-store');

    const saved = test.response();
    await test.routes.get('readwrite:PUT:/api/settings/alarm-location')?.(
      { body: { location: alarmLocation } },
      saved,
    );
    expect(saved.code).toBe(200);
    expect(test.app.savePluginOptions).toHaveBeenCalledWith(
      { collisionThresholds: thresholds, alarmLocation },
      expect.any(Function),
    );

    const loaded = test.response();
    await test.routes.get('readonly:GET:/api/settings/alarm-location')?.({}, loaded);
    expect(loaded.body).toEqual({ location: alarmLocation });
  });

  it('serializes concurrent setting writes without losing either update', async () => {
    const callbacks: Array<(error: NodeJS.ErrnoException | null) => void> = [];
    const savePluginOptions = vi.fn(
      (_options: object, callback: (error: NodeJS.ErrnoException | null) => void) => {
        callbacks.push(callback);
      },
    );
    const test = harness(
      { collisionThresholds: thresholds, alarmLocation: 'bottom' },
      savePluginOptions,
    );
    const nextThresholds = { ...thresholds, dangerCpaMeters: 900 };

    const collisionWrite = test.routes.get('readwrite:PUT:/api/settings/collision')?.(
      { body: { thresholds: nextThresholds } },
      test.response(),
    );
    const locationWrite = test.routes.get('readwrite:PUT:/api/settings/alarm-location')?.(
      { body: { location: 'top' } },
      test.response(),
    );

    await vi.waitFor(() => expect(savePluginOptions).toHaveBeenCalledTimes(1));
    expect(savePluginOptions).toHaveBeenNthCalledWith(
      1,
      { collisionThresholds: nextThresholds, alarmLocation: 'bottom' },
      expect.any(Function),
    );
    callbacks[0]?.(null);
    await vi.waitFor(() => expect(savePluginOptions).toHaveBeenCalledTimes(2));
    expect(savePluginOptions).toHaveBeenNthCalledWith(
      2,
      { collisionThresholds: nextThresholds, alarmLocation: 'top' },
      expect.any(Function),
    );
    callbacks[1]?.(null);
    await Promise.all([collisionWrite, locationWrite]);
  });

  it('rejects an invalid threshold document without changing plugin storage', async () => {
    const test = harness({ collisionThresholds: thresholds });
    const response = test.response();
    await test.routes.get('readwrite:PUT:/api/settings/collision')?.(
      { body: { thresholds: { ...thresholds, dangerTcpaSeconds: -1 } } },
      response,
    );
    expect(response.code).toBe(400);
    expect(test.app.savePluginOptions).not.toHaveBeenCalled();
  });

  it('rejects an invalid alarm location without changing plugin storage', async () => {
    const test = harness({ alarmLocation: 'bottom' });
    const response = test.response();
    await test.routes.get('readwrite:PUT:/api/settings/alarm-location')?.(
      { body: { location: 'port' } },
      response,
    );
    expect(response.code).toBe(400);
    expect(test.app.savePluginOptions).not.toHaveBeenCalled();
  });

  it('proxies and bounds NOAA ENC moorings for readonly clients', async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request) =>
        new Response(
          JSON.stringify({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                id: 42,
                geometry: { type: 'Point', coordinates: [-70.7, 41.5] },
                properties: {
                  OBJECTID: 42,
                  CATMOR: 'mooring buoy',
                  OBJNAM: 'Harbor 42',
                  INFORM: 'Guest mooring',
                  SORDAT: '20260102',
                  DSNM: 'US5TEST.000',
                },
              },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const test = harness();
    const response = test.response();
    await test.routes.get('readonly:GET:/api/moorings')?.(
      { query: { bbox: '[-71,41,-70,42]' } },
      response,
    );

    expect(response.code).toBe(200);
    expect(response.headers['Cache-Control']).toBe('public, max-age=300');
    expect(response.body).toMatchObject({
      type: 'FeatureCollection',
      features: [
        {
          id: 42,
          properties: { OBJNAM: 'Harbor 42', BINNACLE_SCALE_BAND: 'berthing' },
        },
      ],
    });
    const requested = fetchMock.mock.calls.map((call) => new URL(String(call[0])));
    expect(requested).toHaveLength(6);
    expect(
      requested.map((url) => `${url.pathname.split('/')[5]}/${url.pathname.split('/')[7]}`),
    ).toEqual([
      'enc_overview/34',
      'enc_general/40',
      'enc_coastal/46',
      'enc_approach/60',
      'enc_harbour/56',
      'enc_berthing/27',
    ]);
    expect(requested.every((url) => url.hostname === 'encdirect.noaa.gov')).toBe(true);
    expect(requested.every((url) => url.searchParams.get('geometry') === '-71,41,-70,42')).toBe(
      true,
    );
    expect(requested.every((url) => url.searchParams.get('outFields') === '*')).toBe(true);
    expect(requested.every((url) => !url.searchParams.has('orderByFields'))).toBe(true);
    vi.unstubAllGlobals();
  });

  it('rejects an incomplete NOAA scale snapshot instead of caching it as empty', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.includes('/enc_general/')) return new Response('', { status: 503 });
      return new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }), {
        status: 200,
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const test = harness();
    const response = test.response();
    await test.routes.get('readonly:GET:/api/moorings')?.(
      { query: { bbox: '[-71,41,-70,42]' } },
      response,
    );

    expect(response.code).toBe(502);
    expect(response.body).toEqual({
      error: 'Unable to load NOAA ENC moorings.',
    });

    const retry = test.response();
    await test.routes.get('readonly:GET:/api/moorings')?.(
      { query: { bbox: '[-71,41,-70,42]' } },
      retry,
    );
    expect(retry.code).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    vi.unstubAllGlobals();
  });

  it('retains mooring snapshots in SQLite for 90 days across plugin restarts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T12:00:00Z'));
    const dataDirectory = mkdtempSync(join(tmpdir(), 'binnacle-moorings-'));
    const goodFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-70.7, 41.5] },
                properties: {
                  OBJECTID: 42,
                  OBJNAM: 'Persisted mooring',
                  DSNM: 'US5TEST.000',
                },
              },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', goodFetch);
    const first = harness({}, undefined, dataDirectory);
    const firstResponse = first.response();
    await first.routes.get('readonly:GET:/api/moorings')?.(
      { query: { bbox: '[-71,41,-70,42]' } },
      firstResponse,
    );
    first.plugin.stop();

    vi.setSystemTime(new Date('2026-09-04T12:16:00Z'));
    const failedFetch = vi.fn(async () => new Response('', { status: 503 }));
    vi.stubGlobal('fetch', failedFetch);
    const second = harness({}, undefined, dataDirectory);
    const cachedResponse = second.response();
    await second.routes.get('readonly:GET:/api/moorings')?.(
      { query: { bbox: '[-71,41,-70,42]' } },
      cachedResponse,
    );

    expect(cachedResponse.code).toBe(200);
    expect(cachedResponse.headers['X-Binnacle-Moorings-Source']).toBe('stored');
    expect(cachedResponse.body).toMatchObject({
      cachedAtMs: new Date('2026-09-04T12:00:00Z').getTime(),
      features: [{ properties: { OBJNAM: 'Persisted mooring' } }],
    });
    second.plugin.stop();
    rmSync(dataDirectory, { recursive: true, force: true });
  });

  it('rejects a NOAA request that spans an unbounded area', async () => {
    const test = harness();
    const response = test.response();
    await test.routes.get('readonly:GET:/api/moorings')?.(
      { query: { bbox: '[-180,-90,180,90]' } },
      response,
    );
    expect(response.code).toBe(400);
  });
});
