import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignalKStore, type SKFrame } from '$shared/signalk';
import { jsonResponse } from '$shared/testing';
import {
  discoverInstrumentPlugins,
  parseInstrumentPluginManifest,
  SIGNALK_INSTRUMENT_PLUGINS_PATH,
} from './instrument-plugin-manifest';
import type { TileDeps } from './tile-catalog';

const MANIFEST = {
  apiVersion: 1,
  id: 'engine-pack',
  name: 'Engine room instruments',
  instruments: [
    {
      id: 'boost',
      label: 'Boost pressure',
      description: 'Main engine intake pressure.',
      sensorGloss: 'No boost pressure',
      category: 'propulsion',
      path: 'propulsion.main.intakeManifoldPressure',
      format: 'pressure',
      presentation: 'numeric',
      visualization: 'spark',
      trend: true,
    },
  ],
};

function frame(path: string, value: unknown): SKFrame {
  return {
    self: new Map([[path, value]]),
    connection: { phase: 'open', attempt: 0 },
    epoch: 1_000,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('instrument plugin manifests', () => {
  it('compiles a JSON manifest into the same TileDef interface used by built-ins', () => {
    const plugin = parseInstrumentPluginManifest(MANIFEST);
    expect(plugin?.id).toBe('engine-pack');
    const def = plugin?.instruments[0];
    expect(def).toMatchObject({
      id: 'plugin:engine-pack:boost',
      kind: 'numeric',
      viz: 'spark',
      zonesPath: 'propulsion.main.intakeManifoldPressure',
    });

    const store = new SignalKStore();
    store.ensureCells(def?.paths ?? []);
    store.applyFrame(frame('propulsion.main.intakeManifoldPressure', 101_325));
    const reading = def?.read({
      store,
      clock: { now: 1_000 },
      units: { mode: 'metric' },
      vessel: {},
      course: {},
    } as TileDeps);
    expect(reading).toMatchObject({ state: 'live', value: '1013', unit: 'hPa', siValue: 101_325 });
    expect(def?.trend?.display).toBe('pressure');
  });

  it('rejects unsupported versions, unsafe ids, paths, and incomplete wind instruments', () => {
    expect(parseInstrumentPluginManifest({ ...MANIFEST, apiVersion: 2 })).toBeUndefined();
    expect(parseInstrumentPluginManifest({ ...MANIFEST, id: '../engine' })).toBeUndefined();
    expect(parseInstrumentPluginManifest({ ...MANIFEST, id: 'binnacle.builtins' })).toBeUndefined();
    expect(
      parseInstrumentPluginManifest({
        ...MANIFEST,
        instruments: [{ ...MANIFEST.instruments[0], path: 'bad/path' }],
      }),
    ).toBeUndefined();
    expect(
      parseInstrumentPluginManifest({
        ...MANIFEST,
        instruments: [{ ...MANIFEST.instruments[0], format: 'speed', presentation: 'wind' }],
      }),
    ).toBeUndefined();
  });

  it('discovers manifests through the provider-neutral Signal K Resources API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith(`${SIGNALK_INSTRUMENT_PLUGINS_PATH}/_providers`)) {
          return jsonResponse(200, ['engine-pack']);
        }
        if (url.endsWith(SIGNALK_INSTRUMENT_PLUGINS_PATH)) {
          return jsonResponse(200, { 'engine-pack': MANIFEST });
        }
        return jsonResponse(404, {});
      }),
    );

    const result = await discoverInstrumentPlugins('http://boat', undefined);
    expect(result).toMatchObject({ state: 'ready', rejected: 0 });
    expect(result.plugins[0]?.instruments[0]?.id).toBe('plugin:engine-pack:boost');
  });

  it('distinguishes no registered provider from a failed provider check', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, [])),
    );
    await expect(discoverInstrumentPlugins('http://boat', undefined)).resolves.toMatchObject({
      state: 'absent',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(503, {})),
    );
    await expect(discoverInstrumentPlugins('http://boat', undefined)).resolves.toMatchObject({
      state: 'failed',
    });
  });
});
