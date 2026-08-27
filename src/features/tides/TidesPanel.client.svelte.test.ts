import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type NearbyTideStation, TidesStore } from '$entities/tides';
import type { UnitsStore } from '$entities/units';
import { OwnVessel } from '$entities/vessel';
import { SignalKStore, SK_PATHS } from '$shared/signalk';
import TidesPanel from './TidesPanel.svelte';
import type { TidesController } from './tides-controller.svelte';

const tideStation = { id: 'T1', name: 'Harbor tide', latitude: 27.7, longitude: -82.7 };
const currentStation = {
  id: 'C1',
  name: 'Channel current',
  latitude: 27.71,
  longitude: -82.71,
};
const mounted: Array<() => void> = [];

function mountPanel(
  tideStations: NearbyTideStation[] = [{ station: tideStation, distanceMeters: 1000 }],
  currentStations: NearbyTideStation[] = [{ station: currentStation, distanceMeters: 2000 }],
) {
  const store = new TidesStore();
  store.setCatalogs(tideStations, currentStations);
  const controller: TidesController = {
    load: vi.fn(async () => undefined),
    loadCurrent: vi.fn(async () => undefined),
    selectStation: vi.fn(async () => undefined),
    useAutomatic: vi.fn(async () => undefined),
    useNearestStations: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
  };
  const target = document.createElement('div');
  document.body.append(target);
  const signalK = new SignalKStore();
  signalK.applyFrame({
    self: new Map([[SK_PATHS.depthBelowSurface, 4]]),
    connection: { phase: 'open', attempt: 0 },
    epoch: Date.now(),
  });
  let component!: ReturnType<typeof mount>;
  flushSync(() => {
    component = mount(TidesPanel, {
      target,
      props: {
        store,
        controller,
        units: { mode: 'metric' } as UnitsStore,
        vessel: new OwnVessel(signalK, { now: Date.now() }),
        onClose: vi.fn(),
      },
    });
  });
  mounted.push(() => {
    void unmount(component);
    target.remove();
  });
  const button = (text: string): HTMLButtonElement => {
    const found = [...target.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) => candidate.textContent?.replaceAll(/\s+/g, ' ').trim() === text,
    );
    if (!found) throw new Error(`no button labeled ${text}`);
    return found;
  };
  return { store, controller, target, button };
}

afterEach(() => {
  for (const dispose of mounted.splice(0).reverse()) dispose();
});

describe('TidesPanel interactions', () => {
  it('scrubs predicted tide and estimated depth with the keyboard', () => {
    const panel = mountPanel();
    const now = Date.now();
    panel.store.setReadings(
      {
        station: tideStation,
        distanceMeters: 1000,
        events: [
          { timeMs: now - 60 * 60 * 1000, heightMeters: 0.2, kind: 'low' },
          { timeMs: now + 60 * 60 * 1000, heightMeters: 1.2, kind: 'high' },
        ],
      },
      undefined,
      'noaa-coops',
    );
    flushSync();

    const chart = panel.target.querySelector<HTMLElement>('[role="slider"]');
    if (!chart) throw new Error('missing interactive tide chart');
    chart.focus();
    chart.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    flushSync();

    expect(panel.target.querySelector('.chart-tooltip')?.textContent).toContain('Tide');
    expect(panel.target.querySelector('.chart-tooltip')?.textContent).toContain('Estimated depth');
    expect(chart.getAttribute('aria-valuetext')).toContain('estimated depth');
  });

  it('routes native station, automatic, and global reset controls independently', () => {
    const panel = mountPanel();
    panel.button('Harbor tide 1 km straight-line').click();
    panel.button('Use nearest stations').click();
    const automaticButtons = [...panel.target.querySelectorAll<HTMLButtonElement>('button')].filter(
      (button) => button.textContent?.includes('Automatic, nearest available'),
    );
    automaticButtons[1]?.click();
    flushSync();

    expect(panel.controller.selectStation).toHaveBeenCalledWith('tide', tideStation);
    expect(panel.controller.useNearestStations).toHaveBeenCalledTimes(1);
    expect(panel.controller.useAutomatic).toHaveBeenCalledWith('current');
  });

  it('expands a minimized panel when the selection revision changes', () => {
    const panel = mountPanel();
    panel.target.querySelector<HTMLButtonElement>('button[aria-label="Minimize panel"]')?.click();
    flushSync();
    expect(panel.target.querySelector('.panel-body')?.classList).toContain('panel-body--collapsed');

    panel.store.requestManual('tide', tideStation, 1000);
    flushSync();

    expect(panel.target.querySelector('.panel-body')?.classList).not.toContain(
      'panel-body--collapsed',
    );
  });

  it('renders one station choice when a provider catalog repeats an id', () => {
    const panel = mountPanel(
      [
        { station: tideStation, distanceMeters: 1000 },
        { station: { ...tideStation, name: 'Duplicate tide' }, distanceMeters: 1100 },
      ],
      [
        { station: currentStation, distanceMeters: 2000 },
        { station: { ...currentStation, name: 'Duplicate current' }, distanceMeters: 2100 },
        { station: { ...currentStation, name: 'Third current row' }, distanceMeters: 2200 },
      ],
    );

    expect(panel.target.querySelectorAll('button.nav-row')).toHaveLength(4);
    expect(panel.target.textContent).not.toContain('Duplicate tide');
    expect(panel.target.textContent).not.toContain('Duplicate current');
    expect(panel.target.textContent).not.toContain('Third current row');
  });
});
