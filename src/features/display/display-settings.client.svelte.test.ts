import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LatLon } from '$shared/geo';
import { binnacleStorageKey } from '$shared/persistence';
import type { Theme } from '$shared/ui';
import {
  createDisplaySettingsController,
  type DisplaySettingsController,
} from './display-settings.svelte';

const EQUATOR: LatLon = { latitude: 0, longitude: 0 };
const NOON_UTC = Date.UTC(2026, 2, 1, 12);
const MIDNIGHT_UTC = Date.UTC(2026, 2, 1, 0);

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

interface SetupOptions {
  storage?: ReturnType<typeof memoryStorage>;
  mode?: unknown;
  position?: LatLon;
  now?: number;
  theme?: Theme;
}

function setup(options: SetupOptions = {}) {
  const state = $state({
    mode: options.mode as unknown,
    position: options.position,
    now: options.now ?? NOON_UTC,
    theme: options.theme ?? ('day' as Theme),
  });
  const setTheme = vi.fn((theme: Theme) => {
    state.theme = theme;
  });
  const storage = options.storage ?? memoryStorage();
  let controller!: DisplaySettingsController;
  let dispose!: () => void;
  flushSync(() => {
    dispose = $effect.root(() => {
      controller = createDisplaySettingsController({
        getEnvironmentMode: () => state.mode,
        getPosition: () => state.position,
        clock: {
          get now() {
            return state.now;
          },
        },
        getTheme: () => state.theme,
        setTheme,
        storage,
      });
    });
  });
  cleanups.push(dispose);
  return { state, setTheme, storage, controller };
}

describe('createDisplaySettingsController', () => {
  it('is opt-in and persists automatic theme and bright-sun choices', () => {
    const { controller, setTheme, storage } = setup({ mode: 'night' });
    expect(setTheme).not.toHaveBeenCalled();

    controller.setAutoTheme(true);
    controller.setSunMode(true);
    flushSync();
    expect(setTheme).toHaveBeenLastCalledWith('night-red');
    expect(storage.map.get(binnacleStorageKey('displayAutoTheme'))).toBe('true');
    expect(storage.map.get(binnacleStorageKey('displaySunMode'))).toBe('true');
  });

  it('uses environment.mode before the solar fallback', () => {
    const { controller, setTheme, state } = setup({
      mode: 'night',
      position: EQUATOR,
      now: NOON_UTC,
    });
    controller.setAutoTheme(true);
    flushSync();
    expect(setTheme).toHaveBeenLastCalledWith('night-red');

    state.mode = 'day';
    flushSync();
    expect(setTheme).toHaveBeenLastCalledWith('day');
  });

  it('uses local sun position when Signal K supplies no recognized mode', () => {
    const { controller, setTheme, state } = setup({
      mode: 'restricted visibility',
      position: EQUATOR,
      now: MIDNIGHT_UTC,
    });
    controller.setAutoTheme(true);
    flushSync();
    expect(setTheme).toHaveBeenLastCalledWith('night-red');

    state.now = NOON_UTC;
    flushSync();
    expect(setTheme).toHaveBeenLastCalledWith('day');
  });

  it('stays silent without a recognized mode or a position', () => {
    const { controller, setTheme } = setup({ mode: 'restricted visibility' });
    controller.setAutoTheme(true);
    flushSync();
    expect(setTheme).not.toHaveBeenCalled();
  });

  it('holds a manual theme until the next day-night edge', () => {
    const { controller, setTheme, state } = setup({ mode: 'day', theme: 'dusk' });
    controller.setAutoTheme(true);
    flushSync();
    expect(setTheme).toHaveBeenLastCalledWith('day');

    state.theme = 'dusk';
    flushSync();
    expect(controller.autoThemeSuspended).toBe(true);
    expect(setTheme).toHaveBeenCalledTimes(1);

    state.mode = 'night';
    flushSync();
    expect(controller.autoThemeSuspended).toBe(false);
    expect(setTheme).toHaveBeenLastCalledWith('night-red');
  });

  it('clears a manual hold while off and reapplies when enabled again', () => {
    const { controller, setTheme, state } = setup({ mode: 'day', theme: 'dusk' });
    controller.setAutoTheme(true);
    flushSync();
    state.theme = 'dusk';
    flushSync();
    expect(controller.autoThemeSuspended).toBe(true);

    controller.setAutoTheme(false);
    flushSync();
    expect(controller.autoThemeSuspended).toBe(false);

    controller.setAutoTheme(true);
    flushSync();
    expect(setTheme).toHaveBeenLastCalledWith('day');
  });
});
