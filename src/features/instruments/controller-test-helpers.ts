import { vi } from 'vitest';
import { binnacleStorageKey } from '$shared/persistence';
import { PersistedValue } from '$shared/settings';
import { SignalKStore } from '$shared/signalk';
import { createFakeStorage } from '$shared/testing';
import { BINNACLE_INSTRUMENT_PLUGIN } from './builtin-instrument-plugin';
import { createInstrumentRegistry } from './instrument-registry.svelte';
import { DEFAULT_TILES, tileById } from './tile-catalog';

// Test-only fixtures shared by the instruments controller suites. Imported by *.test.ts files,
// never by production code.

export function mustTile(id: string) {
  const def = tileById(id);
  if (!def) throw new Error(`Unknown tile id: ${id}`);
  return def;
}

export function makeDeps(opts: { tiles?: string[] } = {}) {
  const registry = createInstrumentRegistry();
  registry.register(BINNACLE_INSTRUMENT_PLUGIN);
  return {
    store: new SignalKStore(),
    origin: 'http://sk',
    getToken: (): string | undefined => undefined,
    getHistoryProviders: () => undefined,
    getHistoryProviderState: () => 'absent' as const,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    tilesStore: new PersistedValue<string[]>(
      binnacleStorageKey('instrumentTiles'),
      opts.tiles ?? [...DEFAULT_TILES],
      createFakeStorage(),
    ),
    openStore: new PersistedValue<boolean>(
      binnacleStorageKey('instrumentsOpen'),
      false,
      createFakeStorage(),
    ),
    registry,
  };
}

// Advances past all pending microtasks (fetchPathMeta has several await hops).
export const flushPromises = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
