import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { TileReading } from './tile-catalog';
import WindRoseTile from './WindRoseTile.svelte';

const mounted: Array<() => void> = [];

afterEach(() => {
  for (const dispose of mounted.splice(0).reverse()) dispose();
});

describe('WindRoseTile sectors', () => {
  it('runs the client filter and centers the sectors on true wind', () => {
    const reading: TileReading = {
      state: 'live',
      value: '12.0',
      unit: 'kn',
      windRose: {
        apparent: {
          state: 'live',
          value: '12.0',
          unit: 'kn',
          angleRad: -0.5,
          angleEpoch: 1_000,
        },
        trueWind: {
          state: 'live',
          value: '10.0',
          unit: 'kn',
          angleRad: 0.7,
          angleEpoch: 1_000,
        },
        heading: { state: 'live', value: '057°', unit: '', siValue: 1 },
        speedOverGround: { state: 'live', value: '6.4', unit: 'kn', siValue: 3.3 },
        depth: { state: 'live', value: '1.8', unit: 'm', siValue: 1.8 },
      },
    };
    const target = document.createElement('div');
    document.body.append(target);
    let component!: ReturnType<typeof mount>;
    flushSync(() => {
      component = mount(WindRoseTile, {
        target,
        props: {
          label: 'Wind rose',
          reading,
          zone: 'normal',
          depthZone: 'normal',
          sensorGloss: 'No wind data',
        },
      });
    });
    mounted.push(() => {
      void unmount(component);
      target.remove();
    });

    const sectors = target.querySelector('.wind-sectors');
    expect(sectors?.getAttribute('data-reference')).toBe('true');
    expect(sectors?.getAttribute('transform')).toContain('rotate(40.107');
  });
});
