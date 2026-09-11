import { type ComponentProps, flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AisRadarSeascape from './AisRadarSeascape.svelte';

const mocks = vi.hoisted(() => ({
  createSource: vi.fn(),
  draw: vi.fn(),
  load: vi.fn(),
}));

vi.mock('./ais-radar-seascape', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ais-radar-seascape')>();
  return {
    ...actual,
    createAisRadarShorelineSource: mocks.createSource,
    drawAisRadarShoreline: mocks.draw,
  };
});

const mounted: Array<() => void> = [];

beforeEach(() => {
  mocks.createSource.mockImplementation(() => ({ load: mocks.load }));
  mocks.load.mockImplementation(async (planForZoom) => ({
    plan: planForZoom(0, 14),
    tiles: [],
  }));
});

afterEach(() => {
  for (const dispose of mounted.splice(0).reverse()) dispose();
  vi.clearAllMocks();
});

describe('AIS radar seascape component', () => {
  it('draws a cached Canvas shoreline without mounting another WebGL context', async () => {
    const target = document.createElement('div');
    document.body.append(target);
    const props = $state<ComponentProps<typeof AisRadarSeascape>>({
      position: { latitude: 0, longitude: 0 },
      rangeNm: 6,
      theme: 'day',
      companionBase: 'http://localhost/plugins/signalk-chart-locker',
      getToken: () => 'test-token',
    });
    let component!: ReturnType<typeof mount>;
    flushSync(() => {
      component = mount(AisRadarSeascape, { target, props });
    });
    mounted.push(() => {
      void unmount(component);
      target.remove();
    });

    await vi.waitFor(() => expect(mocks.load).toHaveBeenCalledOnce());
    expect(target.querySelector('canvas.seascape.ready')).not.toBeNull();
    expect(target.querySelector('.maplibregl-canvas')).toBeNull();
    expect(mocks.createSource).toHaveBeenCalledWith({
      companionBase: 'http://localhost/plugins/signalk-chart-locker',
      getToken: props.getToken,
    });

    const initialLoads = mocks.load.mock.calls.length;
    for (let index = 0; index < 1_000; index += 1) {
      const sign = index % 2 === 0 ? 1 : -1;
      props.position = {
        latitude: sign * 0.000_001,
        longitude: -sign * 0.000_001,
      };
      flushSync();
    }
    expect(mocks.load).toHaveBeenCalledTimes(initialLoads);

    props.position = { latitude: 0.001, longitude: 0 };
    flushSync();
    await vi.waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(initialLoads + 1));

    props.rangeNm = 12;
    flushSync();
    await vi.waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(initialLoads + 2));

    props.companionBase = 'http://localhost/plugins/alternate-chart-source';
    flushSync();
    await vi.waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(initialLoads + 3));
    expect(mocks.createSource).toHaveBeenCalledTimes(2);
    expect(mocks.draw).toHaveBeenCalled();

    flushSync(() => void unmount(component));
    mounted.pop();
    target.remove();
  });
});
