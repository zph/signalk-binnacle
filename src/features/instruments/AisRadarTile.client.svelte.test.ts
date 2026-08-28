import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AisTargets, AisTargetView } from '$entities/ais';
import type { CollisionAssessment } from '$entities/collision';
import type { OwnVessel } from '$entities/vessel';
import AisRadarTile from './AisRadarTile.svelte';

const mocks = vi.hoisted(() => ({
  map: {
    getStyle: vi.fn(() => ({
      layers: [
        { id: 'background', type: 'background' },
        { id: 'water', type: 'fill', 'source-layer': 'water' },
      ],
    })),
    setLayoutProperty: vi.fn(),
    setPaintProperty: vi.fn(),
    setBearing: vi.fn(),
    setPitch: vi.fn(),
    fitBounds: vi.fn(),
  },
}));

vi.mock('$shared/map', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$shared/map')>();
  return {
    ...actual,
    createThemedMap: vi.fn((options: Parameters<typeof actual.createThemedMap>[0]) => {
      void options.onLoad({ map: mocks.map } as never);
      return { map: mocks.map, destroy: vi.fn() } as never;
    }),
  };
});

const mounted: Array<() => void> = [];

afterEach(() => {
  for (const dispose of mounted.splice(0).reverse()) dispose();
  vi.clearAllMocks();
});

describe('AIS radar target details', () => {
  it('opens the same live detail overlay from a marker and its legend row', () => {
    const targetView: AisTargetView = {
      id: 'vessels.urn:mrn:imo:mmsi:123456789',
      name: 'TEST BOAT',
      position: { latitude: 38.07, longitude: -122.21 },
      cogRad: Math.PI / 2,
      headingRad: Math.PI,
      sogMps: 2,
      shipTypeId: 36,
      navigationState: 'underway',
      cpaMeters: 370.4,
      tcpaSeconds: 600,
    };
    const targets = {
      version: 1,
      list: () => [targetView],
      find: (id: string) => (id === targetView.id ? targetView : undefined),
    } as unknown as AisTargets;
    const collision = {
      assessment: { contacts: [], unassessed: [], worst: 'clear' },
    } as unknown as CollisionAssessment;
    const vessel = {
      position: { latitude: 38.0667, longitude: -122.2133 },
      headingRad: 0,
    } as OwnVessel;
    const onOpen = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    let component!: ReturnType<typeof mount>;
    flushSync(() => {
      component = mount(AisRadarTile, {
        target: host,
        props: {
          label: 'AIS radar',
          reading: { state: 'live', value: '1', unit: '' },
          vessel,
          targets,
          collision,
          rangeNm: 3,
          onRangeChange: () => {},
          theme: 'day',
          actionLabel: 'Expand instrument',
          onOpen,
        },
      });
    });
    mounted.push(() => {
      void unmount(component);
      host.remove();
    });

    const marker = host.querySelector<HTMLButtonElement>('.target-hit');
    expect(marker?.ariaLabel).toBe('Open details for target 1, TEST BOAT');
    flushSync(() => marker?.click());
    expect(onOpen).not.toHaveBeenCalled();
    expect(host.querySelector('.ais-target-popover')?.textContent).toContain('TEST BOAT');
    expect(host.querySelector('.ais-target-popover')?.textContent).toContain('123456789');
    expect(host.querySelector('.ais-target-popover')?.textContent).toContain('Sailing vessel');
    expect(host.querySelector('.ais-target-popover')?.textContent).toContain('Closest pass (CPA)');

    const close = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Close details for TEST BOAT"]',
    );
    flushSync(() => close?.click());
    expect(host.querySelector('.ais-target-popover')).toBeNull();

    const legend = host.querySelector<HTMLButtonElement>('.legend-row');
    flushSync(() => legend?.click());
    expect(host.querySelector('.ais-target-popover')?.textContent).toContain('TEST BOAT');
  });
});
