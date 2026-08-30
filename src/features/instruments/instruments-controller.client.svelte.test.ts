import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HistoryProviders } from '$shared/signalk';
import { jsonResponse } from '$shared/testing';
import { flushPromises, makeDeps, mustTile } from './controller-test-helpers';
import { createInstrumentsController, type InstrumentsDeps } from './instruments-controller.svelte';

afterEach(() => vi.unstubAllGlobals());

describe('createInstrumentsController label reactivity', () => {
  it('wakes a reactive reader when the display name arrives', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('belowKeel')
          ? jsonResponse(200, { displayName: 'Sounder' })
          : jsonResponse(404, {}),
      ),
    );
    const deps = makeDeps({ tiles: ['depth'] });
    const depthDef = mustTile('depth');
    let controller!: ReturnType<typeof createInstrumentsController>;
    let label!: () => string;
    const disposeRoot = $effect.root(() => {
      controller = createInstrumentsController(deps);
      const current = $derived(controller.resolvedLabel(depthDef));
      label = () => current;
    });

    expect(label()).toBe(depthDef.label);
    controller.setOpen(true);
    await flushPromises();
    // The meta cache is a plain Map, so only the version counter can wake a reactive reader.
    expect(label()).toBe('Sounder');

    controller.dispose();
    disposeRoot();
  });
});

describe('createInstrumentsController history provider probe', () => {
  type ProbeState = ReturnType<InstrumentsDeps['getHistoryProviderState']>;

  function countingFetch() {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        return url.includes('/history/paths') ? jsonResponse(200, []) : jsonResponse(404, {});
      }),
    );
    return {
      live: () => calls.filter((url) => url.includes('electrical/batteries')).length,
      historyScans: () => calls.filter((url) => url.includes('/history/paths')).length,
    };
  }

  function probeDeps() {
    let state = $state<ProbeState>('checking');
    let providers = $state<HistoryProviders | undefined>(undefined);
    return {
      deps: {
        ...makeDeps(),
        getHistoryProviders: () => providers,
        getHistoryProviderState: () => state,
      },
      settle(next: ProbeState, ids?: readonly string[]) {
        providers = ids ? { ids } : undefined;
        state = next;
      },
    };
  }

  it('still runs a live rescan while the history probe is checking', async () => {
    const fetches = countingFetch();
    const { deps } = probeDeps();
    let controller!: ReturnType<typeof createInstrumentsController>;
    const disposeRoot = $effect.root(() => {
      controller = createInstrumentsController(deps);
    });

    controller.setOpen(true);
    await flushPromises();
    const before = fetches.live();
    expect(controller.historyStatus).toBe('checking');

    controller.refreshCatalog();
    await flushPromises();

    expect(fetches.live()).toBe(before + 1);

    controller.dispose();
    disposeRoot();
  });

  it('runs the armed history scan when the probe settles, with no second Rescan', async () => {
    const fetches = countingFetch();
    const { deps, settle } = probeDeps();
    let controller!: ReturnType<typeof createInstrumentsController>;
    const disposeRoot = $effect.root(() => {
      controller = createInstrumentsController(deps);
    });

    controller.setOpen(true);
    await flushPromises();
    expect(fetches.historyScans()).toBe(0);

    settle('available', ['questdb']);
    flushSync();
    await flushPromises();

    expect(fetches.historyScans()).toBeGreaterThan(0);
    expect(controller.historyStatus).not.toBe('checking');

    controller.dispose();
    disposeRoot();
  });

  it('leaves the checking state behind when the probe settles with no provider', async () => {
    countingFetch();
    const { deps, settle } = probeDeps();
    let controller!: ReturnType<typeof createInstrumentsController>;
    const disposeRoot = $effect.root(() => {
      controller = createInstrumentsController(deps);
    });

    controller.setOpen(true);
    await flushPromises();

    settle('absent');
    flushSync();
    await flushPromises();

    expect(controller.historyStatus).toBe('unavailable');

    controller.dispose();
    disposeRoot();
  });

  it('stops watching the probe once disposed', async () => {
    const fetches = countingFetch();
    const { deps, settle } = probeDeps();
    let controller!: ReturnType<typeof createInstrumentsController>;
    const disposeRoot = $effect.root(() => {
      controller = createInstrumentsController(deps);
    });

    controller.setOpen(true);
    await flushPromises();
    controller.dispose();

    settle('available', ['questdb']);
    flushSync();
    await flushPromises();

    expect(fetches.historyScans()).toBe(0);

    disposeRoot();
  });
});

describe('createInstrumentsController webview discovery', () => {
  function stubLauncher(options: { fail?: boolean } = {}) {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url.includes('/api/apps')) {
          return options.fail
            ? jsonResponse(500, {})
            : jsonResponse(200, {
                apps: [{ name: 'signalk-tides', title: 'Tides', url: '/signalk-tides/' }],
              });
        }
        if (url.includes('/api/config')) {
          return options.fail
            ? jsonResponse(500, {})
            : jsonResponse(200, { pinned: [], links: [] });
        }
        return jsonResponse(404, {});
      }),
    );
    return calls;
  }

  async function mountedController(deps = makeDeps({ tiles: [] })) {
    let controller!: ReturnType<typeof createInstrumentsController>;
    const disposeRoot = $effect.root(() => {
      controller = createInstrumentsController(deps);
    });
    return { controller, disposeRoot };
  }

  it('answers a missing launcher with an absent status and no web view tiles', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(404, {})),
    );
    const { controller, disposeRoot } = await mountedController();
    controller.setOpen(true);
    await flushPromises();
    expect(controller.webviewStatus).toBe('absent');
    expect(controller.catalog.some((def) => def.kind === 'webview')).toBe(false);
    controller.dispose();
    disposeRoot();
  });

  it('adds launcher tiles to the catalog and persists a chosen web view id', async () => {
    stubLauncher();
    const deps = makeDeps({ tiles: [] });
    const { controller, disposeRoot } = await mountedController(deps);

    controller.setOpen(true);
    await flushPromises();
    const def = controller.catalog.find((tile) => tile.kind === 'webview');
    expect(def?.id).toBe('webview:app:signalk-tides');
    controller.toggleTile('webview:app:signalk-tides');
    expect(deps.tilesStore.value).toContain('webview:app:signalk-tides');

    controller.dispose();
    disposeRoot();
  });

  it('issues no meta fetch for a webview tile with an empty zonesPath', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url.includes('/api/apps')) {
          return jsonResponse(200, {
            apps: [{ name: 'signalk-tides', title: 'Tides', url: '/signalk-tides/' }],
          });
        }
        if (url.includes('/api/config')) return jsonResponse(200, { pinned: [], links: [] });
        return jsonResponse(404, {});
      }),
    );
    const deps = makeDeps({ tiles: ['webview:app:signalk-tides'] });
    let controller!: ReturnType<typeof createInstrumentsController>;
    const disposeRoot = $effect.root(() => {
      controller = createInstrumentsController(deps);
    });
    controller.setOpen(true);
    await flushPromises();
    // The web view tile has zonesPath '' and no paths, so its selection must never ask the server
    // for meta on an empty path, nor subscribe anything.
    for (const url of calls) {
      expect(url).not.toContain('vessels/self//meta');
    }
    controller.dispose();
    disposeRoot();
  });

  it('retains previously accepted tiles when the launcher check fails on rescan', async () => {
    stubLauncher();
    const { controller, disposeRoot } = await mountedController();
    controller.setOpen(true);
    await flushPromises();
    expect(controller.webviewStatus).toBe('ready');

    stubLauncher({ fail: true });
    controller.refreshCatalog();
    await flushPromises();
    expect(controller.webviewStatus).toBe('failed');
    expect(controller.catalog.some((def) => def.id === 'webview:app:signalk-tides')).toBe(true);

    controller.dispose();
    disposeRoot();
  });

  it('refetches the launcher endpoints on Rescan', async () => {
    const calls = stubLauncher();
    const { controller, disposeRoot } = await mountedController();
    controller.setOpen(true);
    await flushPromises();
    const before = calls.filter((url) => url.includes('/api/')).length;
    expect(before).toBeGreaterThan(0);

    controller.refreshCatalog();
    await flushPromises();
    expect(calls.filter((url) => url.includes('/api/')).length).toBeGreaterThan(before);

    controller.dispose();
    disposeRoot();
  });
});
