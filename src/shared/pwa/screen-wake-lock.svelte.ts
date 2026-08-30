export type ScreenWakeLockStatus = 'active' | 'off' | 'unavailable' | 'unsupported';

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: 'release', listener: () => void) => void;
}

interface WakeLockNavigator {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
}

interface VisibilityDocument {
  visibilityState: DocumentVisibilityState;
  addEventListener: (type: 'visibilitychange', listener: () => void) => void;
  removeEventListener: (type: 'visibilitychange', listener: () => void) => void;
}

export interface ScreenWakeLockController {
  readonly status: ScreenWakeLockStatus;
  start: () => void;
  refresh: () => void;
  dispose: () => void;
}

interface ScreenWakeLockOptions {
  isEnabled: () => boolean;
  navigator?: WakeLockNavigator;
  document?: VisibilityDocument;
}

// Screen wake locks are intentionally tied to a visible Binnacle window. The browser can revoke a
// lock for system reasons, and background pages cannot keep a display awake, so visibility changes
// are the reliable, polite place to release and reacquire it.
export function createScreenWakeLockController({
  isEnabled,
  navigator: navigatorValue = typeof navigator === 'undefined' ? undefined : navigator,
  document: documentValue = typeof document === 'undefined' ? undefined : document,
}: ScreenWakeLockOptions): ScreenWakeLockController {
  let sentinel: WakeLockSentinelLike | undefined;
  let started = false;
  let status = $state<ScreenWakeLockStatus>('off');

  const release = async (): Promise<void> => {
    const current = sentinel;
    sentinel = undefined;
    if (!current || current.released) return;
    try {
      await current.release();
    } catch {
      // A browser may have released it already. The preference remains intact for the next visit.
    }
  };

  const refresh = (): void => {
    void (async () => {
      if (!started || !documentValue) return;
      if (!isEnabled() || documentValue.visibilityState !== 'visible') {
        await release();
        status = 'off';
        return;
      }
      if (!navigatorValue?.wakeLock) {
        status = 'unsupported';
        return;
      }
      if (sentinel && !sentinel.released) {
        status = 'active';
        return;
      }
      try {
        const next = await navigatorValue.wakeLock.request('screen');
        // The tab could have been hidden or the preference disabled while the request was pending.
        if (!started || !isEnabled() || documentValue.visibilityState !== 'visible') {
          await next.release();
          return;
        }
        sentinel = next;
        status = 'active';
        next.addEventListener('release', () => {
          if (sentinel !== next) return;
          sentinel = undefined;
          // Do not spin attempting to defeat a system-initiated release. A visibility return or a
          // deliberate preference change will make the next request.
          status = isEnabled() ? 'unavailable' : 'off';
        });
      } catch {
        status = 'unavailable';
      }
    })();
  };

  const onVisibilityChange = (): void => refresh();

  return {
    get status() {
      return status;
    },
    start() {
      if (started || !documentValue) return;
      started = true;
      documentValue.addEventListener('visibilitychange', onVisibilityChange);
      refresh();
    },
    refresh,
    dispose() {
      if (documentValue) documentValue.removeEventListener('visibilitychange', onVisibilityChange);
      started = false;
      void release();
    },
  };
}
