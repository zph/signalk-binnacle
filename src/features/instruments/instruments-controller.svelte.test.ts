import { afterEach, describe, expect, it, vi } from 'vitest';
import { PersistedValue } from '$shared/settings';
import { RETRY_DELAY_MS, SignalKStore, type SKFrame } from '$shared/signalk';
import { jsonResponse } from '$shared/testing';
import { flushPromises, makeDeps, mustTile } from './controller-test-helpers';
import {
  type FloatingInstrumentBox,
  floatingInstrumentBoxesCodec,
  MAX_FLOATING_INSTRUMENTS,
} from './floating-layout';
import { createInstrumentsController } from './instruments-controller.svelte';
import { ALL_CATALOG_PATHS, DEFAULT_TILES, minPeriodFor } from './tile-catalog';

// --- Helpers ---

function selfFrame(self: Record<string, unknown>): SKFrame {
  return {
    self: new Map(Object.entries(self)),
    connection: { phase: 'open', attempt: 0 },
    epoch: Date.now(),
  };
}

// --- Tests ---

describe('createInstrumentsController', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('registers external Signal K instrument plugins in the shared catalog', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/signalk/v2/api/resources/binnacleInstruments/_providers')) {
          return jsonResponse(200, ['engine-pack']);
        }
        if (url.endsWith('/signalk/v2/api/resources/binnacleInstruments')) {
          return jsonResponse(200, {
            engine: {
              apiVersion: 1,
              id: 'engine-pack',
              name: 'Engine instruments',
              instruments: [
                {
                  id: 'boost',
                  label: 'Boost pressure',
                  description: 'Main engine intake pressure.',
                  category: 'propulsion',
                  path: 'propulsion.main.intakeManifoldPressure',
                  format: 'pressure',
                },
              ],
            },
          });
        }
        return jsonResponse(404, {});
      }),
    );
    const deps = makeDeps();
    const ctrl = createInstrumentsController(deps);

    ctrl.setOpen(true);
    await flushPromises();
    await flushPromises();

    expect(ctrl.pluginStatus).toBe('ready');
    expect(ctrl.externalPluginCount).toBe(1);
    expect(ctrl.catalog.some((def) => def.id === 'plugin:engine-pack:boost')).toBe(true);
    expect(ctrl.pluginName('plugin:engine-pack:boost')).toBe('Engine instruments');

    ctrl.dispose();
  });

  // Step 1 tests (written before implementation: RED phase)

  it('calls ensureCells with ALL_CATALOG_PATHS at construction, does not subscribe', () => {
    const deps = makeDeps();
    const spy = vi.spyOn(deps.store, 'ensureCells');
    const ctrl = createInstrumentsController(deps);
    expect(spy).toHaveBeenCalledWith(ALL_CATALOG_PATHS);
    expect(deps.subscribe).not.toHaveBeenCalled();
    ctrl.dispose();
  });

  it('pre-creates cells for persisted dynamic battery ids at construction', () => {
    // A cell first created during a template read is untracked and never re-renders, so the
    // persisted selection's dynamic paths must be ensured before the first render.
    const deps = makeDeps({ tiles: ['sog', 'battery-soc:console'] });
    const spy = vi.spyOn(deps.store, 'ensureCells');
    const ctrl = createInstrumentsController(deps);
    const ensured = spy.mock.calls.flatMap((call) => call[0]);
    expect(ensured).toContain('electrical.batteries.console.capacity.stateOfCharge');
    ctrl.dispose();
  });

  it('toggleTile ensures the cells of the added tile before selecting it', () => {
    const deps = makeDeps();
    const ctrl = createInstrumentsController(deps);
    const spy = vi.spyOn(deps.store, 'ensureCells');
    ctrl.toggleTile('battery-time:console');
    const ensured = spy.mock.calls.flatMap((call) => call[0]);
    expect(ensured).toContain('electrical.batteries.console.capacity.timeRemaining');
    ctrl.dispose();
  });

  it('setOpen(true) subscribes selected deduped paths with policy instant and per-path minPeriod', () => {
    const deps = makeDeps();
    const ctrl = createInstrumentsController(deps);

    ctrl.setOpen(true);

    expect(deps.subscribe).toHaveBeenCalledTimes(1);
    const entries = deps.subscribe.mock.calls[0][0] as Array<{
      path: string;
      policy: string;
      minPeriod: number;
    }>;
    expect(entries.every((e) => e.policy === 'instant')).toBe(true);
    expect(entries.every((e) => e.minPeriod === minPeriodFor(e.path))).toBe(true);

    const expectedPaths = [...new Set(DEFAULT_TILES.flatMap((id) => mustTile(id).paths))].sort();
    expect(entries.map((e) => e.path).sort()).toEqual(expectedPaths);

    ctrl.dispose();
  });

  it('setOpen(false) after setOpen(true) unsubscribes the same paths', () => {
    const deps = makeDeps();
    const ctrl = createInstrumentsController(deps);

    ctrl.setOpen(true);
    const subscribed = (deps.subscribe.mock.calls[0][0] as Array<{ path: string }>)
      .map((e) => e.path)
      .sort();

    ctrl.setOpen(false);
    expect(deps.unsubscribe).toHaveBeenCalledTimes(1);
    expect((deps.unsubscribe.mock.calls[0][0] as string[]).sort()).toEqual(subscribed);

    ctrl.dispose();
  });

  it('toggleTile while open subscribes new tile paths; toggling it off unsubscribes them', () => {
    const deps = makeDeps();
    const ctrl = createInstrumentsController(deps);
    ctrl.setOpen(true);

    const subBefore = deps.subscribe.mock.calls.length;
    const unsubBefore = deps.unsubscribe.mock.calls.length;

    ctrl.toggleTile('stw');
    expect(deps.subscribe.mock.calls.length).toBe(subBefore + 1);
    const added = (deps.subscribe.mock.calls[subBefore][0] as Array<{ path: string }>).map(
      (e) => e.path,
    );
    expect(added).toEqual(mustTile('stw').paths);

    ctrl.toggleTile('stw');
    expect(deps.unsubscribe.mock.calls.length).toBe(unsubBefore + 1);
    expect(deps.unsubscribe.mock.calls[unsubBefore][0]).toEqual(mustTile('stw').paths);

    ctrl.dispose();
  });

  it('toggleTile while closed changes selection without subscribe or unsubscribe', () => {
    const deps = makeDeps();
    const ctrl = createInstrumentsController(deps);

    expect(ctrl.open).toBe(false);
    ctrl.toggleTile('stw');
    expect(deps.subscribe).not.toHaveBeenCalled();
    expect(deps.unsubscribe).not.toHaveBeenCalled();
    expect(ctrl.selectedIds).toContain('stw');

    ctrl.dispose();
  });

  it('removing one tile does not unsubscribe paths a remaining selected tile still needs', () => {
    const deps = makeDeps();
    // sog: navigation.speedOverGround; stw: navigation.speedThroughWater: disjoint paths.
    deps.tilesStore.set(['sog', 'stw']);
    const ctrl = createInstrumentsController(deps);

    ctrl.setOpen(true);

    const sogPaths = mustTile('sog').paths;
    const stwPaths = mustTile('stw').paths;
    const allSubscribed = (deps.subscribe.mock.calls[0][0] as Array<{ path: string }>).map(
      (e) => e.path,
    );
    expect(allSubscribed.sort()).toEqual([...sogPaths, ...stwPaths].sort());

    // Remove sog; stw is still selected, so stw's paths must stay subscribed.
    ctrl.toggleTile('sog');
    expect(deps.unsubscribe).toHaveBeenCalledTimes(1);
    const unsubbed = deps.unsubscribe.mock.calls[0][0] as string[];
    expect(unsubbed.sort()).toEqual([...sogPaths].sort());
    for (const p of stwPaths) {
      expect(unsubbed).not.toContain(p);
    }

    ctrl.dispose();
  });

  it('dispose after setOpen(true) unsubscribes all paths exactly once', () => {
    const deps = makeDeps();
    const ctrl = createInstrumentsController(deps);

    ctrl.setOpen(true);
    const subPaths = (deps.subscribe.mock.calls[0][0] as Array<{ path: string }>)
      .map((e) => e.path)
      .sort();

    ctrl.dispose();
    expect(deps.unsubscribe).toHaveBeenCalledTimes(1);
    expect((deps.unsubscribe.mock.calls[0][0] as string[]).sort()).toEqual(subPaths);
  });

  it('fetches zone meta once per zonesPath on open, caches on second open', async () => {
    const zones = [{ upper: 3, state: 'alarm', message: 'Shallow' }];
    const fetchMock = vi.fn(async (url: string) =>
      (url as string).includes('belowKeel') ? jsonResponse(200, { zones }) : jsonResponse(404, {}),
    );
    vi.stubGlobal('fetch', fetchMock);

    const deps = makeDeps();
    deps.tilesStore.set(['depth']);
    const ctrl = createInstrumentsController(deps);

    ctrl.setOpen(true);
    await flushPromises();

    const depthDef = mustTile('depth');
    // depth=2 < upper:3 → alarm zone
    expect(ctrl.zoneState(depthDef, 2)).toBe('alarm');
    // depth=10 outside zones → normal
    expect(ctrl.zoneState(depthDef, 10)).toBe('normal');

    expect(fetchMock.mock.calls.some(([u]: [string]) => u.includes('belowKeel'))).toBe(true);

    ctrl.dispose();
  });

  it('notification override: raised alarm notification returns alarm regardless of numeric band', () => {
    const deps = makeDeps();
    deps.tilesStore.set(['depth']);
    const ctrl = createInstrumentsController(deps);

    const depthDef = mustTile('depth');
    // No meta loaded and value well clear of any implicit zone → normal.
    expect(ctrl.zoneState(depthDef, 100)).toBe('normal');

    // Write a raised alarm under the depth zonesPath into the store mirror.
    deps.store.applyFrame(
      selfFrame({
        [`notifications.${depthDef.zonesPath}`]: { state: 'alarm', message: 'Shallow' },
      }),
    );

    // Notification override must fire even though no meta zones are loaded.
    expect(ctrl.zoneState(depthDef, 100)).toBe('alarm');

    ctrl.dispose();
  });

  it('maps raised depth warn and alert notifications to the warning display state', () => {
    const deps = makeDeps();
    deps.tilesStore.set(['depth']);
    const ctrl = createInstrumentsController(deps);
    const depthDef = mustTile('depth');

    for (const state of ['warn', 'alert']) {
      deps.store.applyFrame(
        selfFrame({
          [`notifications.${depthDef.zonesPath}`]: { state, message: 'Shallow' },
        }),
      );
      expect(ctrl.zoneState(depthDef, 100)).toBe('warning');
    }

    ctrl.dispose();
  });

  it('loads depth zones when the combined wind rose is selected', async () => {
    const serverZones = [{ upper: 1, state: 'alarm' }];
    const fetchMock = vi.fn(async (url: string) =>
      (url as string).includes('belowKeel')
        ? jsonResponse(200, { zones: serverZones })
        : jsonResponse(200, {}),
    );
    vi.stubGlobal('fetch', fetchMock);

    const deps = makeDeps();
    deps.tilesStore.set(['wind-rose']);
    const ctrl = createInstrumentsController(deps);
    ctrl.setOpen(true);
    await flushPromises();

    expect(fetchMock.mock.calls.some(([url]: [string]) => url.includes('belowKeel'))).toBe(true);
    expect(ctrl.zoneState(mustTile('depth'), 1.5)).toBe('normal');

    ctrl.dispose();
  });

  it('selection persists to tilesStore; malformed stored value falls back to DEFAULT_TILES', () => {
    const map = new Map<string, string>([['binnacle-custom:instrument-tiles', '"not-an-array"']]);
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
    };
    const tilesStore = new PersistedValue<string[]>(
      'binnacle-custom:instrument-tiles',
      [...DEFAULT_TILES],
      storage,
    );
    const openStore = new PersistedValue<boolean>('binnacle-custom:instruments-open', false, {
      getItem: () => null,
      setItem: () => {},
    });
    const floatingStore = new PersistedValue<FloatingInstrumentBox[]>(
      'binnacle-custom:instrument-screen-layout',
      [],
      { getItem: () => null, setItem: () => {} },
      floatingInstrumentBoxesCodec,
    );

    const ctrl = createInstrumentsController({
      store: new SignalKStore(),
      origin: 'http://sk',
      getToken: () => undefined,
      getHistoryProviders: () => undefined,
      getHistoryProviderState: () => 'absent',
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      tilesStore,
      openStore,
      floatingStore,
      registry: makeDeps().registry,
    });

    // Malformed JSON → falls back to DEFAULT_TILES.
    expect([...ctrl.selectedIds]).toEqual([...DEFAULT_TILES]);

    // A valid toggle persists the new selection.
    ctrl.toggleTile('stw');
    expect(ctrl.selectedIds).toContain('stw');
    const stored = JSON.parse(map.get('binnacle-custom:instrument-tiles') ?? '[]') as unknown;
    expect(stored).toContain('stw');

    ctrl.dispose();
  });

  it('tiles getter returns TileDef objects in the same order as selectedIds', () => {
    const deps = makeDeps();
    const ctrl = createInstrumentsController(deps);
    expect(ctrl.tiles.map((t) => t.id)).toEqual([...ctrl.selectedIds]);
    ctrl.dispose();
  });

  it('reorderTile moves a tile to the requested slot', () => {
    const deps = makeDeps();
    deps.tilesStore.set(['sog', 'depth', 'stw']);
    const ctrl = createInstrumentsController(deps);

    ctrl.reorderTile('sog', 2);
    expect([...ctrl.selectedIds]).toEqual(['depth', 'stw', 'sog']);

    ctrl.dispose();
  });

  it('construction with openStore true subscribes selected paths and fetches meta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(404, {})),
    );

    const deps = makeDeps();
    deps.openStore.set(true);
    const ctrl = createInstrumentsController(deps);

    expect(deps.subscribe).toHaveBeenCalledTimes(1);
    const entries = deps.subscribe.mock.calls[0][0] as Array<{ path: string }>;
    const expectedPaths = [...new Set(DEFAULT_TILES.flatMap((id) => mustTile(id).paths))].sort();
    expect(entries.map((e) => e.path).sort()).toEqual(expectedPaths);

    await flushPromises();
    expect(vi.mocked(fetch)).toHaveBeenCalled();

    ctrl.dispose();
  });

  it('a failed meta fetch retries on later opens up to the attempt cap', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(async (..._args: unknown[]) => jsonResponse(401, {}));
      vi.stubGlobal('fetch', fetchMock);
      const metaCalls = () =>
        fetchMock.mock.calls.filter((call) => String(call[0]).includes('/meta')).length;

      let token: string | undefined;
      const deps = { ...makeDeps(), getToken: () => token };
      deps.tilesStore.set(['depth']);
      const ctrl = createInstrumentsController(deps);

      ctrl.setOpen(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(metaCalls()).toBe(1);

      // A failure is transient (a restarting server, a dropped link), so later visits try again
      // once each paced retry window reopens; the changed token restores the tokenless attempt,
      // and the cache's per-path cap then stops a dead endpoint from being hammered on every open.
      token = 'valid-token';
      for (let round = 0; round < 5; round += 1) {
        ctrl.setOpen(false);
        ctrl.setOpen(true);
        await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
      }
      expect(metaCalls()).toBe(4);

      ctrl.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('battery discovery is called on first open, catalog includes discovered instances', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if ((url as string).includes('electrical/batteries')) {
          return jsonResponse(200, { house: { voltage: {} }, starter: { voltage: {} } });
        }
        return jsonResponse(404, {});
      }),
    );

    const deps = makeDeps();
    const ctrl = createInstrumentsController(deps);

    // Before open: static catalog only.
    const staticCount = ctrl.catalog.length;

    ctrl.setOpen(true);
    await flushPromises();

    // Only concrete live paths are offered, not every possible reading for the instance. The
    // battery face and the voltage tile both resolve because the voltage path is live; the soc,
    // time, and current readings stay out until their own paths report.
    expect(ctrl.catalog.length).toBe(staticCount + 4);
    expect(ctrl.catalog.some((d) => d.id === 'battery:house')).toBe(true);
    expect(ctrl.catalog.some((d) => d.id === 'battery-status:house')).toBe(true);
    expect(ctrl.catalog.some((d) => d.id === 'battery-soc:house')).toBe(false);
    expect(ctrl.catalog.some((d) => d.id === 'battery-time:house')).toBe(false);
    expect(ctrl.catalog.some((d) => d.id === 'battery-current:house')).toBe(false);
    expect(ctrl.catalog.some((d) => d.id === 'battery:starter')).toBe(true);
    expect(ctrl.catalog.some((d) => d.id === 'battery-status:starter')).toBe(true);

    ctrl.dispose();
  });

  it('keeps valid dynamic trend ids unavailable until discovery confirms the instrument', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/electrical/batteries')) {
          return jsonResponse(200, { house: { voltage: { value: 12.7 } } });
        }
        return jsonResponse(404, {});
      }),
    );

    const deps = makeDeps();
    const ctrl = createInstrumentsController(deps);
    expect(ctrl.trendDescriptor('battery:house')).toBeUndefined();
    expect(ctrl.trendDescriptor('battery:ghost')).toBeUndefined();

    ctrl.setOpen(true);
    await flushPromises();

    expect(ctrl.trendDescriptor('battery:house')).toMatchObject({
      id: 'battery:house',
      label: 'Voltage · House battery',
    });
    expect(ctrl.trendDescriptor('battery:ghost')).toBeUndefined();
    ctrl.dispose();
  });

  it('battery discovery runs only once per construction even across multiple opens', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if ((url as string).includes('electrical/batteries')) {
        return jsonResponse(200, { house: { voltage: {} } });
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal('fetch', fetchMock);

    const deps = makeDeps();
    const ctrl = createInstrumentsController(deps);

    ctrl.setOpen(true);
    await flushPromises();
    ctrl.setOpen(false);
    ctrl.setOpen(true);
    await flushPromises();

    const batteryCalls = fetchMock.mock.calls.filter(([u]: [string]) =>
      u.includes('electrical/batteries'),
    ).length;
    expect(batteryCalls).toBe(1);

    ctrl.dispose();
  });

  it('retains accepted live instances when a rescan has transport failures', async () => {
    let failing = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (failing) throw new TypeError('network down');
        if (url.includes('electrical/batteries')) {
          return jsonResponse(200, { house: { voltage: {} } });
        }
        return jsonResponse(404, {});
      }),
    );
    const deps = makeDeps();
    const ctrl = createInstrumentsController(deps);
    ctrl.setOpen(true);
    await flushPromises();
    expect(ctrl.catalog.some((def) => def.id === 'battery:house')).toBe(true);

    failing = true;
    ctrl.refreshCatalog();
    await flushPromises();
    expect(ctrl.catalog.some((def) => def.id === 'battery:house')).toBe(true);
    ctrl.dispose();
  });

  it('updates successful live families while retaining a failed family', async () => {
    let secondScan = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('electrical/batteries')) {
          return jsonResponse(200, {
            [secondScan ? 'starter' : 'house']: { voltage: {} },
          });
        }
        if (url.endsWith('/propulsion')) {
          if (secondScan) throw new TypeError('engine branch offline');
          return jsonResponse(200, { port: { revolutions: {} } });
        }
        return jsonResponse(404, {});
      }),
    );
    const ctrl = createInstrumentsController(makeDeps());
    ctrl.setOpen(true);
    await flushPromises();
    secondScan = true;
    ctrl.refreshLiveCatalog();
    await flushPromises();

    expect(ctrl.catalog.some((def) => def.id === 'battery:starter')).toBe(true);
    expect(ctrl.catalog.some((def) => def.id === 'battery:house')).toBe(false);
    expect(ctrl.catalog.some((def) => def.id === 'prop-rpm:port')).toBe(true);
    ctrl.dispose();
  });

  it('ensures store cells for discovered instance paths when discovery lands', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('electrical/batteries')) {
          return jsonResponse(200, { house: { voltage: {} } });
        }
        if (url.endsWith('/propulsion')) return jsonResponse(200, { port: { revolutions: {} } });
        if (url.endsWith('/tanks')) {
          return jsonResponse(200, { freshWater: { main: { currentLevel: {} } } });
        }
        if (url.endsWith('/electrical/solar')) {
          return jsonResponse(200, { arch: { panelPower: {} } });
        }
        if (url.endsWith('/environment/inside')) {
          return jsonResponse(200, { cabin: { temperature: {} } });
        }
        return jsonResponse(404, {});
      }),
    );

    const deps = makeDeps();
    const spy = vi.spyOn(deps.store, 'ensureCells');
    const ctrl = createInstrumentsController(deps);

    ctrl.setOpen(true);
    await flushPromises();

    const ensured = spy.mock.calls.flatMap((call) => call[0]);
    expect(ensured).toContain('electrical.batteries.house.voltage');
    expect(ensured).toContain('propulsion.port.revolutions');
    expect(ensured).toContain('tanks.freshWater.main.currentLevel');
    expect(ensured).toContain('electrical.solar.arch.panelPower');
    expect(ensured).toContain('environment.inside.cabin.temperature');
    expect(ctrl.catalog.some((def) => def.id === 'prop-rpm:port')).toBe(true);
    expect(ctrl.catalog.some((def) => def.id === 'tank-level:freshWater.main')).toBe(true);
    expect(ctrl.catalog.some((def) => def.id === 'solar-power:arch')).toBe(true);
    expect(ctrl.catalog.some((def) => def.id === 'inside-temp:cabin')).toBe(true);

    ctrl.dispose();
  });

  it('offers historically seen readings without treating them as live', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/history/paths?')) {
          return jsonResponse(200, ['propulsion.port.revolutions', 'propulsion.port.engineLoad']);
        }
        if (url.includes('/history/values?')) {
          return jsonResponse(200, {
            range: { from: '2026-07-01T00:00:00Z', to: '2026-07-01T01:00:00Z' },
            values: [
              { path: 'propulsion.port.revolutions' },
              { path: 'propulsion.port.engineLoad' },
            ],
            data: [['2026-07-01T00:00:00Z', 20, 0.4]],
          });
        }
        return jsonResponse(404, {});
      }),
    );

    const deps = {
      ...makeDeps(),
      getHistoryProviders: () => ({ ids: ['signalk-questdb'] }),
      getHistoryProviderState: () => 'available' as const,
    };
    const ctrl = createInstrumentsController(deps);
    ctrl.setOpen(true);
    await flushPromises();

    expect(ctrl.catalog.some((def) => def.id === 'prop-rpm:port')).toBe(true);
    expect(ctrl.catalog.some((def) => def.id === 'prop-load:port')).toBe(true);
    expect(ctrl.catalog.some((def) => def.id === 'prop-temp:port')).toBe(false);
    expect(ctrl.isHistoricalOnly('prop-rpm:port')).toBe(true);
    expect(deps.store.cell('propulsion.port.revolutions').epoch).toBe(0);

    ctrl.dispose();
  });

  it('keeps the newest catalog when an older anonymous history scan finishes later', async () => {
    let token: string | undefined;
    let anonymousSignal: AbortSignal | undefined;
    let resolveAnonymousPaths: (() => void) | undefined;
    const anonymousPathsReady = new Promise<void>((resolve) => {
      resolveAnonymousPaths = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/history/paths?')) {
          const authorization = (init?.headers as Record<string, string> | undefined)
            ?.Authorization;
          if (!authorization) {
            anonymousSignal = init?.signal ?? undefined;
            await anonymousPathsReady;
            return jsonResponse(200, ['propulsion.old.revolutions']);
          }
          return jsonResponse(200, ['propulsion.current.revolutions']);
        }
        if (url.includes('/history/values?')) {
          const authorization = (init?.headers as Record<string, string> | undefined)
            ?.Authorization;
          const path = authorization
            ? 'propulsion.current.revolutions'
            : 'propulsion.old.revolutions';
          return jsonResponse(200, {
            range: { from: '2026-07-01T00:00:00Z', to: '2026-07-01T01:00:00Z' },
            values: [{ path }],
            data: [['2026-07-01T00:00:00Z', 20]],
          });
        }
        return jsonResponse(404, {});
      }),
    );

    const deps = {
      ...makeDeps(),
      getToken: () => token,
      getHistoryProviders: () => ({ ids: ['signalk-questdb'] }),
      getHistoryProviderState: () => 'available' as const,
    };
    const ctrl = createInstrumentsController(deps);
    ctrl.setOpen(true);
    token = 'approved';
    ctrl.refreshCatalog();
    await flushPromises();

    expect(anonymousSignal?.aborted).toBe(true);
    expect(ctrl.catalog.some((def) => def.id === 'prop-rpm:current')).toBe(true);
    resolveAnonymousPaths?.();
    await flushPromises();
    expect(ctrl.catalog.some((def) => def.id === 'prop-rpm:current')).toBe(true);
    expect(ctrl.catalog.some((def) => def.id === 'prop-rpm:old')).toBe(false);

    ctrl.dispose();
  });

  it('merges new paths into accepted history when another provider fails', async () => {
    let secondScan = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/history/paths?') && url.includes('provider=kip')) {
          return jsonResponse(501, {});
        }
        if (url.includes('/history/paths?')) {
          return jsonResponse(200, [
            secondScan ? 'propulsion.starboard.revolutions' : 'propulsion.port.revolutions',
          ]);
        }
        if (url.includes('/history/values?')) {
          const path = secondScan
            ? 'propulsion.starboard.revolutions'
            : 'propulsion.port.revolutions';
          return jsonResponse(200, {
            range: { from: '2026-07-01T00:00:00Z', to: '2026-07-01T01:00:00Z' },
            values: [{ path }],
            data: [['2026-07-01T00:00:00Z', 20]],
          });
        }
        return jsonResponse(404, {});
      }),
    );
    const providers = () => ({
      ids: secondScan ? ['signalk-questdb', 'kip'] : ['signalk-questdb'],
    });
    const deps = {
      ...makeDeps(),
      getHistoryProviders: providers,
      getHistoryProviderState: () => 'available' as const,
    };
    const ctrl = createInstrumentsController(deps);
    ctrl.setOpen(true);
    await flushPromises();
    expect(ctrl.catalog.some((def) => def.id === 'prop-rpm:port')).toBe(true);

    secondScan = true;
    ctrl.refreshCatalog();
    await flushPromises();
    expect(ctrl.historyStatus).toBe('partial');
    expect(ctrl.catalog.some((def) => def.id === 'prop-rpm:port')).toBe(true);
    expect(ctrl.catalog.some((def) => def.id === 'prop-rpm:starboard')).toBe(true);
    ctrl.dispose();
  });

  it("a selected 'battery:house' tile subscribes its voltage path while open", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(404, {})),
    );

    const deps = makeDeps();
    deps.tilesStore.set(['battery:house']);
    const ctrl = createInstrumentsController(deps);

    ctrl.setOpen(true);
    await flushPromises();

    const entries = deps.subscribe.mock.calls.flat(2) as { path: string }[];
    expect(entries.some((e) => e.path === 'electrical.batteries.house.voltage')).toBe(true);

    ctrl.dispose();
  });

  it('zoneState falls back to CLIENT_DEFAULT_ZONES depth bands when the server meta has no zones', async () => {
    // Meta resolves (200) but carries no zones, the stock-server case.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/meta') ? jsonResponse(200, { units: 'm' }) : jsonResponse(404, {}),
      ),
    );

    const deps = makeDeps();
    deps.tilesStore.set(['depth']);
    const ctrl = createInstrumentsController(deps);

    ctrl.setOpen(true);
    await flushPromises();

    const depthDef = mustTile('depth');
    // depth 1.5 m < 2 m upper → alarm; depth 3 m inside [2, 5) warn → warning; 10 m outside → normal
    expect(ctrl.zoneState(depthDef, 1.5)).toBe('alarm');
    expect(ctrl.zoneState(depthDef, 3)).toBe('warning');
    expect(ctrl.zoneState(depthDef, 10)).toBe('normal');

    ctrl.dispose();
  });

  it('zoneState falls back to the client default bands while a failed fetch awaits retry', async () => {
    // A failed fetch removes the cache entry so a later open can retry; the client default depth
    // bands stand in meanwhile, so a transient blip never strips a depth tile of safety banding.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(404, {})),
    );

    const deps = makeDeps();
    deps.tilesStore.set(['depth']);
    const ctrl = createInstrumentsController(deps);

    ctrl.setOpen(true);
    await flushPromises();

    expect(ctrl.zoneState(mustTile('depth'), 1.5)).toBe('alarm');

    ctrl.dispose();
  });

  it('server meta zones override client default zones', async () => {
    // Server says: only warn above 10 m (atypical; just verifies server wins over client defaults).
    const serverZones = [{ lower: 10, upper: 20, state: 'warn' }];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if ((url as string).includes('belowKeel')) {
          return jsonResponse(200, { zones: serverZones });
        }
        return jsonResponse(404, {});
      }),
    );

    const deps = makeDeps();
    deps.tilesStore.set(['depth']);
    const ctrl = createInstrumentsController(deps);

    ctrl.setOpen(true);
    await flushPromises();

    const depthDef = mustTile('depth');
    // Client default would fire alarm at 1.5 m, but server zones say only warn above 10 m.
    expect(ctrl.zoneState(depthDef, 1.5)).toBe('normal');
    expect(ctrl.zoneState(depthDef, 15)).toBe('warning');

    ctrl.dispose();
  });

  describe('resolvedLabel', () => {
    async function openWith(displayName: unknown) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) =>
          (url as string).includes('belowKeel')
            ? jsonResponse(200, { displayName })
            : jsonResponse(404, {}),
        ),
      );
      const deps = makeDeps();
      deps.tilesStore.set(['depth']);
      const ctrl = createInstrumentsController(deps);
      ctrl.setOpen(true);
      await flushPromises();
      return ctrl;
    }

    it('falls back to the catalog label before any meta resolves', () => {
      const deps = makeDeps();
      deps.tilesStore.set(['depth']);
      const ctrl = createInstrumentsController(deps);
      const depthDef = mustTile('depth');

      expect(ctrl.resolvedLabel(depthDef)).toBe(depthDef.label);

      ctrl.dispose();
    });

    it("uses the server's display name once the path meta resolves", async () => {
      const ctrl = await openWith('Sounder');

      expect(ctrl.resolvedLabel(mustTile('depth'))).toBe('Sounder');

      ctrl.dispose();
    });

    it('keeps the catalog label for a blank, oversized, or control-character display name', async () => {
      const depthDef = mustTile('depth');

      const blank = await openWith('   ');
      expect(blank.resolvedLabel(depthDef)).toBe(depthDef.label);
      blank.dispose();

      const controlChars = await openWith('Depth\u0000sounder');
      expect(controlChars.resolvedLabel(depthDef)).toBe(depthDef.label);
      controlChars.dispose();

      const tooLong = await openWith('D'.repeat(81));
      expect(tooLong.resolvedLabel(depthDef)).toBe(depthDef.label);
      tooLong.dispose();

      const atCap = await openWith('D'.repeat(80));
      expect(atCap.resolvedLabel(depthDef)).toBe('D'.repeat(80));
      atCap.dispose();
    });
  });
});

describe('createInstrumentsController screen layout', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubSilentDiscovery(): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(404, {})),
    );
  }

  function subscribedPaths(deps: ReturnType<typeof makeDeps>): string[] {
    // Replay the subscribe/unsubscribe deltas to mirror the controller's live subscribed set.
    const live = new Set<string>();
    const subCalls = deps.subscribe.mock.calls.flatMap(
      (call) => call[0] as Array<{ path: string }>,
    );
    const unsubCalls = deps.unsubscribe.mock.calls.flatMap((call) => call[0] as string[]);
    for (const entry of subCalls) live.add(entry.path);
    for (const path of unsubCalls) live.delete(path);
    return [...live].sort();
  }

  it('addFloating persists a clamped default box and subscribes its paths', () => {
    stubSilentDiscovery();
    const deps = makeDeps();
    const ctrl = createInstrumentsController(deps);

    ctrl.addFloating('sog', { x: 0.9, y: 0.9 });

    expect(ctrl.isFloating('sog')).toBe(true);
    const added = ctrl.floating.find((box) => box.id === 'sog');
    expect(added).toEqual({ id: 'sog', x: 0.74, y: 0.8, width: 0.26, height: 0.2 });
    expect(deps.floatingStore.value).toEqual([added]);
    expect(subscribedPaths(deps)).toEqual(expect.arrayContaining([...mustTile('sog').paths]));
    const entries = deps.subscribe.mock.calls.at(-1)?.[0] as Array<{
      path: string;
      policy: string;
      minPeriod: number;
    }>;
    expect(entries.every((e) => e.policy === 'instant')).toBe(true);
    expect(entries.every((e) => e.minPeriod === minPeriodFor(e.path))).toBe(true);

    ctrl.dispose();
  });

  it('seeds an empty chart with only wind rose and AIS radar', () => {
    stubSilentDiscovery();
    const deps = makeDeps({ tiles: ['sog', 'depth', 'stw'] });
    const ctrl = createInstrumentsController(deps);

    ctrl.seedEmptyFloating();

    expect(ctrl.floating.map((box) => box.id)).toEqual(['wind-rose', 'ais-radar']);
    expect(new Set(ctrl.floating.map((box) => `${box.x}:${box.y}`)).size).toBe(2);
    expect(deps.floatingStore.value).toEqual(ctrl.floating);

    // A later edit session preserves the seeded layout instead of duplicating it.
    ctrl.seedEmptyFloating();
    expect(ctrl.floating).toHaveLength(2);
    ctrl.dispose();
  });

  it('does not add starter or dock instruments to an existing chart layout', () => {
    stubSilentDiscovery();
    const existing = { id: 'depth', x: 0.17, y: 0.23, width: 0.31, height: 0.28 };
    const deps = makeDeps({ tiles: ['sog', 'wind-rose'], floating: [existing] });
    const ctrl = createInstrumentsController(deps);

    ctrl.seedEmptyFloating();

    expect(ctrl.floating).toEqual([existing]);
    expect(deps.floatingStore.value).toEqual([existing]);
    ctrl.dispose();
  });

  it('addFloating is idempotent for a duplicate id', () => {
    stubSilentDiscovery();
    const deps = makeDeps();
    const ctrl = createInstrumentsController(deps);

    ctrl.addFloating('sog', { x: 0.2, y: 0.2 });
    const subscribeCount = deps.subscribe.mock.calls.length;
    ctrl.addFloating('sog', { x: 0.6, y: 0.6 });

    expect(ctrl.floating).toHaveLength(1);
    expect(ctrl.floating[0].x).toBe(0.2);
    expect(deps.subscribe.mock.calls.length).toBe(subscribeCount);

    ctrl.dispose();
  });

  it('addFloating refuses placements beyond the cap and unknown ids', () => {
    stubSilentDiscovery();
    const deps = makeDeps({
      floating: Array.from({ length: MAX_FLOATING_INSTRUMENTS }, (_, i) => ({
        id: `tile-${i}`,
        x: 0,
        y: 0,
        width: 0.26,
        height: 0.2,
      })),
    });
    const ctrl = createInstrumentsController(deps);

    ctrl.addFloating('sog');
    expect(ctrl.isFloating('sog')).toBe(false);
    expect(deps.floatingStore.value).toHaveLength(MAX_FLOATING_INSTRUMENTS);

    const other = makeDeps();
    const emptyCtrl = createInstrumentsController(other);
    emptyCtrl.addFloating('no-such-tile');
    expect(emptyCtrl.floating).toHaveLength(0);
    emptyCtrl.dispose();

    ctrl.dispose();
  });

  it('removeFloating unsubscribes paths that no dock tile shares', () => {
    stubSilentDiscovery();
    const deps = makeDeps();
    const ctrl = createInstrumentsController(deps);
    ctrl.setScreenEditing(true);
    ctrl.addFloating('sog');
    ctrl.addFloating('depth');

    ctrl.removeFloating('depth');

    expect(ctrl.isFloating('depth')).toBe(false);
    const removed = (deps.unsubscribe.mock.calls.at(-1)?.[0] ?? []) as string[];
    for (const path of mustTile('depth').paths) {
      expect(removed).toContain(path);
      expect(subscribedPaths(deps)).not.toContain(path);
    }

    ctrl.dispose();
  });

  it('setFloatingBox clamps through the codec and ignores unknown ids', () => {
    stubSilentDiscovery();
    const deps = makeDeps();
    const ctrl = createInstrumentsController(deps);
    ctrl.addFloating('sog');

    ctrl.setFloatingBox('sog', { id: 'sog', x: 0.95, y: 0.9, width: 0.26, height: 0.2 });
    expect(ctrl.floating[0]).toEqual({ id: 'sog', x: 0.74, y: 0.8, width: 0.26, height: 0.2 });

    ctrl.setFloatingBox('no-such-tile', {
      id: 'no-such-tile',
      x: 0,
      y: 0,
      width: 0.26,
      height: 0.2,
    });
    expect(ctrl.floating).toHaveLength(1);

    ctrl.dispose();
  });

  it('setScreenEditing(true) subscribes floating demand and runs discovery with the dock closed', async () => {
    stubSilentDiscovery();
    const deps = makeDeps();
    const ctrl = createInstrumentsController(deps);
    expect(deps.openStore.value).toBe(false);

    ctrl.setScreenEditing(true);

    expect(ctrl.screenEditing).toBe(true);
    expect(subscribedPaths(deps)).toEqual([]);
    ctrl.addFloating('sog');
    expect(subscribedPaths(deps)).toEqual(expect.arrayContaining([...mustTile('sog').paths]));
    await flushPromises();
    // Discovery ran despite the dock never opening: history status leaves 'idle' (the provider
    // probe answers 'absent', so the scan settles at 'unavailable').
    expect(ctrl.historyStatus).toBe('unavailable');

    ctrl.dispose();
  });

  it('construction with a saved floating layout restores subscriptions with the dock closed', () => {
    stubSilentDiscovery();
    const deps = makeDeps({ floating: [{ id: 'sog', x: 0.1, y: 0.1, width: 0.26, height: 0.2 }] });
    const ctrl = createInstrumentsController(deps);

    expect(deps.openStore.value).toBe(false);
    expect(subscribedPaths(deps)).toEqual([...mustTile('sog').paths].sort());
    expect(ctrl.floatingTiles.map(({ def }) => def.id)).toEqual(['sog']);

    ctrl.dispose();
  });

  it('construction drops unknown floating ids without subscribing them', () => {
    stubSilentDiscovery();
    const deps = makeDeps({
      floating: [
        { id: 'gone-tile', x: 0.1, y: 0.1, width: 0.26, height: 0.2 },
        { id: 'depth', x: 0.2, y: 0.2, width: 0.26, height: 0.2 },
      ],
    });
    const ctrl = createInstrumentsController(deps);

    expect(ctrl.floating.map((box) => box.id)).toEqual(['depth']);
    const paths = subscribedPaths(deps);
    for (const path of mustTile('depth').paths) {
      expect(paths).toContain(path);
    }

    ctrl.dispose();
  });

  it('a closed dock with no floating layout subscribes nothing at construction', () => {
    const deps = makeDeps();
    const ctrl = createInstrumentsController(deps);

    expect(deps.openStore.value).toBe(false);
    expect(deps.subscribe).not.toHaveBeenCalled();

    ctrl.dispose();
  });
});
