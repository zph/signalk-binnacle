import type { Map as MapLibreMap } from 'maplibre-gl';

const PROFILE_QUERY = 'profileMap';
const OUTSIDE_OVERLAY = 'outside-overlay-sync';
const PROFILE_DATASET_KEY = 'binnacleMapPerformance';
const PROFILE_PUBLISH_MS = 1_000;

type MutationKind =
  | 'set-data'
  | 'set-feature-state'
  | 'set-filter'
  | 'set-layout-property'
  | 'set-paint-property'
  | 'trigger-repaint';

interface MutableOverlayProfile {
  syncCount: number;
  totalSyncMs: number;
  maxSyncMs: number;
  mutations: Partial<Record<MutationKind, number>>;
}

interface MapOverlayPerformanceProfile {
  id: string;
  syncCount: number;
  totalSyncMs: number;
  maxSyncMs: number;
  mutations: Partial<Record<MutationKind, number>>;
}

interface MapPerformanceSnapshot {
  elapsedMs: number;
  renderCount: number;
  overlays: MapOverlayPerformanceProfile[];
}

interface MapPerformanceProfileHandle {
  snapshot(): MapPerformanceSnapshot;
  reset(): void;
}

interface MapPerformanceProfiler extends MapPerformanceProfileHandle {
  runOverlay<T>(id: string | undefined, callback: () => T): T;
  destroy(): void;
}

type ProfileWindow = Window & {
  __binnacleMapPerformanceProfiles?: MapPerformanceProfileHandle[];
};

function profileRequested(): boolean {
  try {
    return new URLSearchParams(window.location.search).get(PROFILE_QUERY) === '1';
  } catch {
    return false;
  }
}

function copyMutations(
  mutations: Partial<Record<MutationKind, number>>,
): Partial<Record<MutationKind, number>> {
  return { ...mutations };
}

// Developer-only instrumentation for finding the write that keeps an otherwise-idle MapLibre map
// rendering. Enable it with ?profileMap=1, then inspect window.__binnacleMapPerformanceProfiles.
// Only overlay ids, timings, and mutation counts are retained. Navigation and source payloads never
// enter the profile, which keeps the diagnostic safe to use on a real vessel display.
export function createMapPerformanceProfiler(map: MapLibreMap): MapPerformanceProfiler | undefined {
  if (!profileRequested()) return undefined;

  const profiles = new Map<string, MutableOverlayProfile>();
  const sourceRestorers: Array<() => void> = [];
  const patchedSources = new WeakSet<object>();
  let activeOverlay = OUTSIDE_OVERLAY;
  let renderCount = 0;
  let startedAt = performance.now();

  const profileFor = (id: string): MutableOverlayProfile => {
    const existing = profiles.get(id);
    if (existing) return existing;
    const created: MutableOverlayProfile = {
      syncCount: 0,
      totalSyncMs: 0,
      maxSyncMs: 0,
      mutations: {},
    };
    profiles.set(id, created);
    return created;
  };
  const recordMutation = (kind: MutationKind) => {
    const profile = profileFor(activeOverlay);
    profile.mutations[kind] = (profile.mutations[kind] ?? 0) + 1;
  };

  const mapRecord = map as unknown as Record<string, unknown>;
  const restorers: Array<() => void> = [];
  const wrapMapMutation = (method: Exclude<MutationKind, 'set-data'>) => {
    const methodName = camelCase(method);
    const original = mapRecord[methodName];
    if (typeof original !== 'function') return;
    mapRecord[methodName] = (...args: unknown[]) => {
      recordMutation(method);
      return original.apply(map, args);
    };
    restorers.push(() => {
      mapRecord[methodName] = original;
    });
  };

  for (const method of [
    'set-feature-state',
    'set-filter',
    'set-layout-property',
    'set-paint-property',
    'trigger-repaint',
  ] as const) {
    wrapMapMutation(method);
  }

  const originalGetSource = map.getSource;
  mapRecord.getSource = (id: string) => {
    const source = originalGetSource.call(map, id) as unknown as
      | Record<string, unknown>
      | undefined;
    if (!source || patchedSources.has(source)) return source;
    patchedSources.add(source);
    const originalSetData = source.setData;
    if (typeof originalSetData === 'function') {
      source.setData = (...args: unknown[]) => {
        recordMutation('set-data');
        return originalSetData.apply(source, args);
      };
      sourceRestorers.push(() => {
        source.setData = originalSetData;
      });
    }
    return source;
  };
  restorers.push(() => {
    mapRecord.getSource = originalGetSource;
  });

  const onRender = () => {
    renderCount += 1;
  };
  map.on('render', onRender);

  const handle: MapPerformanceProfiler = {
    runOverlay(id, callback) {
      const previousOverlay = activeOverlay;
      activeOverlay = id ?? 'unmanaged-overlay';
      const before = performance.now();
      try {
        return callback();
      } finally {
        const elapsed = performance.now() - before;
        const profile = profileFor(activeOverlay);
        profile.syncCount += 1;
        profile.totalSyncMs += elapsed;
        profile.maxSyncMs = Math.max(profile.maxSyncMs, elapsed);
        activeOverlay = previousOverlay;
      }
    },
    snapshot() {
      return {
        elapsedMs: performance.now() - startedAt,
        renderCount,
        overlays: [...profiles.entries()]
          .map(([id, profile]) => ({
            id,
            syncCount: profile.syncCount,
            totalSyncMs: profile.totalSyncMs,
            maxSyncMs: profile.maxSyncMs,
            mutations: copyMutations(profile.mutations),
          }))
          .sort((left, right) => {
            const leftMutations = Object.values(left.mutations).reduce(
              (sum, count) => sum + count,
              0,
            );
            const rightMutations = Object.values(right.mutations).reduce(
              (sum, count) => sum + count,
              0,
            );
            return rightMutations - leftMutations || right.totalSyncMs - left.totalSyncMs;
          }),
      };
    },
    reset() {
      profiles.clear();
      renderCount = 0;
      startedAt = performance.now();
    },
    destroy() {
      map.off('render', onRender);
      for (const restore of sourceRestorers) restore();
      for (const restore of restorers.reverse()) restore();
      const exposed = (window as ProfileWindow).__binnacleMapPerformanceProfiles;
      const index = exposed?.indexOf(handle) ?? -1;
      if (index >= 0) exposed?.splice(index, 1);
    },
  };

  const profileWindow = window as ProfileWindow;
  profileWindow.__binnacleMapPerformanceProfiles ??= [];
  profileWindow.__binnacleMapPerformanceProfiles.push(handle);
  const publish = () => {
    document.documentElement.dataset[PROFILE_DATASET_KEY] = JSON.stringify(
      profileWindow.__binnacleMapPerformanceProfiles?.map((profile) => profile.snapshot()) ?? [],
    );
  };
  const publishInterval = window.setInterval(publish, PROFILE_PUBLISH_MS);
  publish();
  const originalDestroy = handle.destroy;
  handle.destroy = () => {
    window.clearInterval(publishInterval);
    originalDestroy();
    publish();
  };
  return handle;
}

function camelCase(value: Exclude<MutationKind, 'set-data'>): string {
  return value.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}
