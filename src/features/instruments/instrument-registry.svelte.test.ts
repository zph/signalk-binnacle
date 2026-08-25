import { describe, expect, it } from 'vitest';
import { BINNACLE_INSTRUMENT_PLUGIN } from './builtin-instrument-plugin';
import {
  createInstrumentRegistry,
  INSTRUMENT_PLUGIN_API_VERSION,
  SIGNALK_INSTRUMENT_PLUGIN_SCOPE,
} from './instrument-registry.svelte';
import type { TileDef } from './tile-catalog';

function instrument(id: string): TileDef {
  return {
    id,
    label: id,
    description: `${id} reading.`,
    sensorGloss: `No ${id} data`,
    paths: [`environment.${id}`],
    zonesPath: `environment.${id}`,
    category: 'weather',
    kind: 'numeric',
    read: () => ({ state: 'never', value: '--', unit: '' }),
  };
}

describe('createInstrumentRegistry', () => {
  it('serves every baked-in instrument through a plugin registration', () => {
    const registry = createInstrumentRegistry();
    registry.register(BINNACLE_INSTRUMENT_PLUGIN);

    expect(registry.plugins).toEqual([
      {
        id: 'binnacle.builtins',
        name: 'Binnacle built-in instruments',
        instrumentCount: BINNACLE_INSTRUMENT_PLUGIN.instruments.length,
        external: false,
      },
    ]);
    expect(registry.resolve('wind-rose')?.kind).toBe('wind-rose');
    expect(registry.resolve('battery:house')?.id).toBe('battery:house');
  });

  it('replaces external registrations as one server-owned scope', () => {
    const registry = createInstrumentRegistry();
    registry.register(BINNACLE_INSTRUMENT_PLUGIN);
    registry.replaceScope(SIGNALK_INSTRUMENT_PLUGIN_SCOPE, [
      {
        apiVersion: INSTRUMENT_PLUGIN_API_VERSION,
        id: 'engine-pack',
        name: 'Engine pack',
        instruments: [instrument('plugin:engine-pack:boost')],
      },
    ]);

    expect(registry.resolve('plugin:engine-pack:boost')).toBeDefined();
    expect(registry.pluginFor('plugin:engine-pack:boost')).toMatchObject({
      name: 'Engine pack',
      external: true,
    });

    registry.replaceScope(SIGNALK_INSTRUMENT_PLUGIN_SCOPE, []);
    expect(registry.resolve('plugin:engine-pack:boost')).toBeUndefined();
    expect(registry.resolve('sog')).toBeDefined();
  });

  it('keeps the first instrument when plugin ids or instrument ids conflict', () => {
    const registry = createInstrumentRegistry();
    registry.register({
      apiVersion: INSTRUMENT_PLUGIN_API_VERSION,
      id: 'first',
      name: 'First',
      instruments: [instrument('shared')],
    });
    registry.register({
      apiVersion: INSTRUMENT_PLUGIN_API_VERSION,
      id: 'second',
      name: 'Second',
      instruments: [instrument('shared')],
    });
    registry.register({
      apiVersion: INSTRUMENT_PLUGIN_API_VERSION,
      id: 'second',
      name: 'Duplicate second',
      instruments: [instrument('another')],
    });

    expect(registry.catalog.map((entry) => entry.id)).toEqual(['shared']);
    expect(registry.issues).toHaveLength(2);
  });
});
