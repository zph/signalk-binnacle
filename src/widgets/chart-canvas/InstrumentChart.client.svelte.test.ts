import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createThemedMap } from '$shared/map';
import InstrumentChart from './InstrumentChart.svelte';

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, () => void>();
  const map = {
    easeTo: vi.fn(),
    getCenter: vi.fn(() => ({ lat: 38.04, lng: -122.19 })),
    getZoom: vi.fn(() => 12),
    on: vi.fn((event: string, handler: () => void) => handlers.set(event, handler)),
    setCenter: vi.fn(),
    setGlobalStateProperty: vi.fn(),
  };
  const manager = {
    registerBatch: vi.fn(async (overlays: Array<{ id: string }>) =>
      overlays.map((overlay) => ({ id: overlay.id, status: 'registered' as const })),
    ),
  };
  const destroy = vi.fn();
  let options: Parameters<typeof import('$shared/map').createThemedMap>[0] | undefined;
  return {
    destroy,
    handlers,
    manager,
    map,
    get options() {
      return options;
    },
    set options(value) {
      options = value;
    },
  };
});

vi.mock('$features/charts', () => ({ fetchCharts: vi.fn(async () => []) }));
vi.mock('$features/vessel-layer', () => ({
  OWN_VESSEL_OVERLAY_ID: 'own-vessel',
  createVesselOverlay: vi.fn(() => ({ id: 'own-vessel' })),
}));
vi.mock('./build-reference-overlays', () => ({
  buildReferenceOverlays: vi.fn(() => [{ id: 'basemap' }]),
}));
vi.mock('$shared/map', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$shared/map')>();
  return {
    ...actual,
    createThemedMap: vi.fn((options: Parameters<typeof actual.createThemedMap>[0]) => {
      mocks.options = options;
      void options.onLoad({
        map: mocks.map,
        manager: mocks.manager,
        recolor: vi.fn(),
        isDestroyed: () => false,
        runTick: vi.fn(),
      } as never);
      return { map: mocks.map, destroy: mocks.destroy } as never;
    }),
  };
});

const mounted: Array<() => void> = [];

afterEach(() => {
  for (const dispose of mounted.splice(0).reverse()) dispose();
  mocks.handlers.clear();
  vi.clearAllMocks();
});

describe('map instrument chart', () => {
  it('owns an independent camera and exposes zoom, follow, pan release, and expansion', async () => {
    const onFollowingChange = vi.fn();
    const onViewChange = vi.fn();
    const onOpen = vi.fn();
    const vessel = {
      position: { latitude: 38.0667, longitude: -122.2133 },
      positionStale: false,
    };
    const target = document.createElement('div');
    document.body.append(target);
    let component!: ReturnType<typeof mount>;
    flushSync(() => {
      component = mount(InstrumentChart, {
        target,
        props: {
          origin: 'http://localhost:3000',
          vessel: vessel as never,
          units: { depthUnit: 'm' } as never,
          thresholds: { value: { shallowDepthMeters: 2 } } as never,
          userCharts: { sources: [] } as never,
          theme: 'day',
          companionBase: null,
          companionTiles: () => null,
          initialView: { lat: 38, lon: -122, zoom: 9 },
          savedLayers: {},
          savedOrder: [],
          mapRenderingQuality: 'balanced',
          following: false,
          onFollowingChange,
          onViewChange,
          actionLabel: 'Expand instrument',
          onOpen,
        },
      });
    });
    mounted.push(() => {
      void unmount(component);
      target.remove();
    });
    await vi.waitFor(() => expect(target.querySelector('.map-surface.ready')).not.toBeNull());

    expect(createThemedMap).toHaveBeenCalledWith(
      expect.objectContaining({
        view: { lat: 38, lon: -122, zoom: 9 },
        defaultCenter: [-122.2133, 38.0667],
        showMapControls: false,
        onUserPan: expect.any(Function),
      }),
    );

    flushSync(() => target.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')?.click());
    expect(mocks.map.easeTo).toHaveBeenCalledWith({ zoom: 13, duration: 180 });

    flushSync(() => target.querySelector<HTMLButtonElement>('[aria-label="Follow boat"]')?.click());
    expect(onFollowingChange).toHaveBeenCalledWith(true);

    mocks.options?.onUserPan?.();
    expect(onFollowingChange).toHaveBeenLastCalledWith(false);

    flushSync(() =>
      target.querySelector<HTMLButtonElement>('[aria-label="Expand instrument"]')?.click(),
    );
    expect(onOpen).toHaveBeenCalledOnce();

    mocks.handlers.get('moveend')?.();
    expect(onViewChange).toHaveBeenCalledWith({ lat: 38.04, lon: -122.19, zoom: 12 });

    flushSync(() => void unmount(component));
    mounted.pop();
    target.remove();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });
});
