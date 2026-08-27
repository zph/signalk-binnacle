import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const createPlugin = require('./index.cjs') as (app: AppStub) => PluginStub;

interface AppStub {
  error: ReturnType<typeof vi.fn>;
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
  registerWithRouter: (router: RouterStub) => void;
}

interface RouterStub {
  access: (level: string) => {
    get: (path: string, handler: RouteHandler) => void;
    put: (path: string, handler: RouteHandler) => void;
  };
}

type RouteHandler = (request: { body?: unknown }, response: ResponseStub) => void | Promise<void>;

const thresholds = {
  dangerCpaMeters: 463,
  dangerTcpaSeconds: 480,
  warningCpaMeters: 1_852,
  warningTcpaSeconds: 1_800,
};

function harness(initial: object = {}) {
  const routes = new Map<string, RouteHandler>();
  const app: AppStub = {
    error: vi.fn(),
    savePluginOptions: vi.fn((_options, callback) => callback(null)),
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
  return { app, response, routes };
}

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
});
