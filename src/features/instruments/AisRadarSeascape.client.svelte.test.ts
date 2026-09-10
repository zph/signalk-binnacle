import { type ComponentProps, flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createThemedMap } from '$shared/map';
import AisRadarSeascape from './AisRadarSeascape.svelte';

const mocks = vi.hoisted(() => {
  const map = {
    getStyle: vi.fn(() => ({
      layers: [
        { id: 'background', type: 'background' },
        { id: 'water', type: 'fill', 'source-layer': 'water' },
        { id: 'road', type: 'line', 'source-layer': 'transportation' },
      ],
    })),
    setLayoutProperty: vi.fn(),
    setPaintProperty: vi.fn(),
    setBearing: vi.fn(),
    setPitch: vi.fn(),
    fitBounds: vi.fn(),
  };
  const destroy = vi.fn();
  return { map, destroy };
});

vi.mock('$shared/map', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$shared/map')>();
  return {
    ...actual,
    createThemedMap: vi.fn((options: Parameters<typeof actual.createThemedMap>[0]) => {
      void options.onLoad({ map: mocks.map } as never);
      return { map: mocks.map, destroy: mocks.destroy } as never;
    }),
  };
});

const mounted: Array<() => void> = [];

afterEach(() => {
  for (const dispose of mounted.splice(0).reverse()) dispose();
  vi.clearAllMocks();
});

describe('AIS radar seascape component', () => {
  it('mounts a passive coastline map, styles it, fits the range, and tears it down', () => {
    const target = document.createElement('div');
    document.body.append(target);
    const props = $state<ComponentProps<typeof AisRadarSeascape>>({
      position: { latitude: 38.04, longitude: -122.19 },
      rangeNm: 6,
      theme: 'day',
      companionBase: 'http://localhost/plugins/signalk-chart-locker',
      getToken: () => 'token',
    });
    let component!: ReturnType<typeof mount>;
    flushSync(() => {
      component = mount(AisRadarSeascape, {
        target,
        props,
      });
    });
    mounted.push(() => {
      void unmount(component);
      target.remove();
    });

    expect(createThemedMap).toHaveBeenCalledWith(
      expect.objectContaining({
        interactive: false,
        showMapControls: false,
        attributionControl: false,
        pixelRatio: 1,
        companionBase: 'http://localhost/plugins/signalk-chart-locker',
        style: expect.objectContaining({ name: 'binnacle-ais-radar-seascape' }),
      }),
    );
    expect(mocks.map.setLayoutProperty).toHaveBeenCalledWith('road', 'visibility', 'none');
    expect(mocks.map.setBearing).toHaveBeenCalledWith(0);
    expect(mocks.map.fitBounds).toHaveBeenCalledWith(expect.any(Array), {
      padding: 0,
      duration: 0,
    });
    expect(target.querySelector('.seascape.ready')).not.toBeNull();

    const initialFits = mocks.map.fitBounds.mock.calls.length;
    for (let index = 0; index < 1_000; index += 1) {
      const sign = index % 2 === 0 ? 1 : -1;
      props.position = {
        latitude: 38.04 + sign * 0.000_001,
        longitude: -122.19 - sign * 0.000_001,
      };
      flushSync();
    }
    expect(mocks.map.fitBounds).toHaveBeenCalledTimes(initialFits);

    props.rangeNm = 12;
    flushSync();
    expect(mocks.map.fitBounds).toHaveBeenCalledTimes(initialFits + 1);

    flushSync(() => void unmount(component));
    mounted.pop();
    target.remove();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });
});
