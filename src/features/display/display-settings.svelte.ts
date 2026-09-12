import { untrack } from 'svelte';
import type { LatLon } from '$shared/geo';
import type { ReactiveClock } from '$shared/lib';
import { isAfterDark } from '$shared/nav';
import { binnacleStorageKey } from '$shared/persistence';
import { booleanPersistedCodec, PersistedValue, type StorageLike } from '$shared/settings';
import type { Theme } from '$shared/ui';

export interface DisplaySettingsDeps {
  getEnvironmentMode: () => unknown;
  getPosition: () => LatLon | undefined;
  clock: ReactiveClock;
  getTheme: () => Theme;
  setTheme: (theme: Theme) => void;
  storage?: StorageLike;
}

export interface DisplaySettingsController {
  readonly autoTheme: boolean;
  setAutoTheme(on: boolean): void;
  // A direct theme choice holds automatic switching until the next day-night edge.
  readonly autoThemeSuspended: boolean;
  // Daytime-only high-contrast chart paint. App chrome and dark themes are unchanged.
  readonly sunMode: boolean;
  setSunMode(on: boolean): void;
}

export function createDisplaySettingsController(
  deps: DisplaySettingsDeps,
): DisplaySettingsController {
  const autoTheme = new PersistedValue(
    binnacleStorageKey('displayAutoTheme'),
    false,
    deps.storage,
    booleanPersistedCodec,
  );
  const sunMode = new PersistedValue(
    binnacleStorageKey('displaySunMode'),
    false,
    deps.storage,
    booleanPersistedCodec,
  );

  // Signal K is authoritative when it publishes environment.mode. Otherwise, solar position at
  // the live vessel fix supplies the same two-state answer. Dusk remains an explicit manual theme.
  const recommendation = $derived.by<Theme | undefined>(() => {
    if (!autoTheme.value) return undefined;
    const mode = deps.getEnvironmentMode();
    if (mode === 'night') return 'night-red';
    if (mode === 'day') return 'day';
    const position = deps.getPosition();
    if (position === undefined) return undefined;
    return isAfterDark(deps.clock.now, position.latitude, position.longitude) ? 'night-red' : 'day';
  });

  let suspended = $state(false);
  let lastRecommendation: Theme | undefined;

  $effect(() => {
    const next = recommendation;
    const current = deps.getTheme();
    if (next === undefined) {
      lastRecommendation = undefined;
      if (untrack(() => suspended)) suspended = false;
      return;
    }
    if (next !== lastRecommendation) {
      lastRecommendation = next;
      if (untrack(() => suspended)) suspended = false;
      if (current !== next) deps.setTheme(next);
      return;
    }
    if (current !== next && !untrack(() => suspended)) suspended = true;
  });

  return {
    get autoTheme(): boolean {
      return autoTheme.value;
    },
    setAutoTheme(on: boolean): void {
      autoTheme.set(on);
    },
    get autoThemeSuspended(): boolean {
      return suspended;
    },
    get sunMode(): boolean {
      return sunMode.value;
    },
    setSunMode(on: boolean): void {
      sunMode.set(on);
    },
  };
}
