import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { TileReading } from './tile-catalog';
import WindRoseTile from './WindRoseTile.svelte';

const mounted: Array<() => void> = [];

afterEach(() => {
  for (const dispose of mounted.splice(0).reverse()) dispose();
  delete document.documentElement.dataset.theme;
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
        heading: { state: 'live', value: '057°', unit: '', siValue: 1, angleEpoch: 1_000 },
        speedOverGround: { state: 'live', value: '6.4', unit: 'kn', siValue: 3.3 },
        depth: { state: 'live', value: '1.8', unit: 'm', siValue: 1.8 },
        current: {
          state: 'live',
          value: '1.4',
          unit: 'kn',
          siValue: 0.72,
          angleRad: 2,
          angleEpoch: 1_000,
        },
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
          noGoAngleRad: Math.PI / 3,
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
    expect(target.querySelectorAll('.wind-sector-lines path')).toHaveLength(2);
    expect(target.querySelector('.port-sector-line')?.getAttribute('d')).toBe(
      'M500 500 L278 115.485',
    );
    expect(target.querySelector('.wind-sector-lines')?.getAttribute('transform')).toContain(
      'rotate(40.107',
    );
    const sectorFill = target.querySelector('.wind-sector-fill');
    expect(sectorFill?.getAttribute('transform')).toContain('rotate(40.107');
    expect(getComputedStyle(sectorFill as Element).fillOpacity).toBe('0.2');
    const portSector = target.querySelector('.port-sector');
    expect(getComputedStyle(portSector as Element).strokeWidth).toBe('82px');
    const fixedDial = target.querySelector('.fixed-dial');
    expect(getComputedStyle(portSector as Element).strokeWidth).toBe(
      getComputedStyle(fixedDial as Element).strokeWidth,
    );

    const roseTile = target.querySelector('.tile--wind-rose');
    expect(roseTile).not.toBeNull();
    expect(
      getComputedStyle(roseTile as Element)
        .getPropertyValue('--wind-true')
        .trim(),
    ).toBe('#ffe135');
    const current = target.querySelector('.current-vector');
    expect(current?.getAttribute('transform')).toContain('rotate(57.295');
    expect(current?.getAttribute('data-set-true-degrees')).toBe('114.6');
    expect(Number.parseFloat(getComputedStyle(current as Element).opacity)).toBeGreaterThan(0.6);
    expect(
      getComputedStyle(roseTile as Element)
        .getPropertyValue('--current-vector')
        .trim(),
    ).toBe('#148bd2');
    document.documentElement.dataset.theme = 'dusk';
    expect(
      getComputedStyle(roseTile as Element)
        .getPropertyValue('--wind-true')
        .trim(),
    ).toBe('#ffe135');
    expect(
      getComputedStyle(roseTile as Element)
        .getPropertyValue('--current-vector')
        .trim(),
    ).toBe('#36a9e8');
  });
});
