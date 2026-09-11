import type * as maplibregl from 'maplibre-gl';
import { createMapPerformanceProfiler } from './map-performance-profiler';
import type { OverlayContext } from './types';

// How often store-driven overlays (AIS prune, tides, radar advance, collision) are synced while the
// camera is idle. Active gestures pause this work so MapLibre owns the interaction frame budget;
// existing map layers follow its GPU camera transform without needing their sources rebuilt.
const STORE_SYNC_MS = 250;

// Anything the overlay sync can drive: the overlay modules all expose sync(ctx).
export interface Syncable {
  sync(ctx: OverlayContext): void;
}

export type OverlaySyncStatus = (overlayId: string | undefined, error: unknown | undefined) => void;

function syncableId(overlay: Syncable): string | undefined {
  return 'id' in overlay && typeof overlay.id === 'string' ? overlay.id : undefined;
}

export interface OverlayTick {
  // Start syncing overlays on a low-frequency interval while the camera is idle. A pan, zoom,
  // bearing, or pitch gesture pauses the interval and gets one catch-up sync at moveend. The timer
  // also stops while the document is hidden. Per-overlay dirty checks still gate real work.
  runTick: (overlays: ReadonlyArray<Syncable>, onStatus?: OverlaySyncStatus) => void;
  // Teardown for the sync wiring runTick installs (camera listeners, interval, and visibilitychange
  // listener). A no-op until runTick is called; invoked once on destroy.
  stopTick: () => void;
}

export function createOverlayTick(
  map: maplibregl.Map,
  ctx: OverlayContext,
  isDestroyed: () => boolean,
): OverlayTick {
  // The live teardown for the current runTick wiring. A no-op until runTick is called, then the real
  // teardown, then a no-op again once it has run. runTick reassigns this, so the returned stopTick
  // delegates through it rather than capturing a stale value.
  let teardown = () => {};
  const profiler = createMapPerformanceProfiler(map);

  const runTick = (overlays: ReadonlyArray<Syncable>, onStatus?: OverlaySyncStatus) => {
    // A second call must not orphan the first camera listeners, interval, and visibilitychange
    // listener, so tear down any prior wiring first.
    teardown();
    // An async widget initializer can reach runTick after the map owner has already torn down. Do
    // not reinstall listeners or timers on the dead map in that case.
    if (isDestroyed()) return;
    // Calling this once replaces the old unconditional rAF loop, which synced ~60x/sec for the life
    // of the map even at anchor. Do not synchronize on either render or move: source-backed layers
    // already follow MapLibre's camera transform, and rebuilding their data during a gesture steals
    // the same main-thread budget that drag and pinch handling need.
    const failedOverlays = new WeakSet<Syncable>();
    const syncAll = () => {
      if (isDestroyed()) return;
      for (const overlay of overlays) {
        if (isDestroyed()) return;
        try {
          if (profiler) profiler.runOverlay(syncableId(overlay), () => overlay.sync(ctx));
          else overlay.sync(ctx);
          if (failedOverlays.delete(overlay)) onStatus?.(syncableId(overlay), undefined);
        } catch (error) {
          // A broken optional overlay must never prevent later navigation overlays from updating.
          // Warn once per continuous failure so the 250 ms safety tick does not flood the console.
          if (!failedOverlays.has(overlay)) {
            const id = syncableId(overlay);
            console.warn(`Overlay "${id ?? 'unmanaged'}" failed to synchronize.`, error);
            failedOverlays.add(overlay);
            onStatus?.(id, error);
          }
        }
      }
    };

    let interval = 0;
    let moving = map.isMoving();
    const startInterval = () => {
      if (interval || moving || document.hidden) return;
      interval = window.setInterval(syncAll, STORE_SYNC_MS);
    };
    const stopInterval = () => {
      if (!interval) return;
      clearInterval(interval);
      interval = 0;
    };

    const onMoveStart = () => {
      moving = true;
      stopInterval();
    };
    const onMoveEnd = () => {
      moving = false;
      // Viewport-sensitive overlays see the final camera once, and their normal interval can handle
      // any settle delay. One batch here replaces potentially thousands during a sustained drag.
      syncAll();
      startInterval();
    };
    map.on('movestart', onMoveStart);
    map.on('moveend', onMoveEnd);

    // Pause the interval while hidden; resume and sync once on return so a hidden-tab change shows
    // immediately. If a camera transition is still active, moveend owns that catch-up instead.
    const onVisibility = () => {
      if (document.hidden) {
        stopInterval();
      } else {
        if (!moving) syncAll();
        startInterval();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    if (!document.hidden) startInterval();
    syncAll();

    teardown = () => {
      map.off('movestart', onMoveStart);
      map.off('moveend', onMoveEnd);
      stopInterval();
      document.removeEventListener('visibilitychange', onVisibility);
      teardown = () => {};
    };
  };

  return {
    runTick,
    stopTick: () => {
      teardown();
      profiler?.destroy();
    },
  };
}
