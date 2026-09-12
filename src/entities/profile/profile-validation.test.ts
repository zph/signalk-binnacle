import { describe, expect, it } from 'vitest';
import type { LayerSettings } from '$shared/map';
import type { ProfileSettings } from './profile-types';
import { isProfileSettings } from './profile-validation';

const settings = (overrides: Partial<ProfileSettings> = {}): ProfileSettings => ({
  theme: 'day',
  layers: {},
  layerOrder: [],
  layerCategories: {},
  weatherLayers: {},
  thresholds: {
    dangerCpaMeters: 926,
    dangerTcpaSeconds: 600,
    warningCpaMeters: 1852,
    warningTcpaSeconds: 1200,
  },
  trackSettings: { intervalSeconds: 10, minMeters: 10, colorMode: 'speed' },
  planningSpeedMps: 6,
  arrivalMuted: false,
  ...overrides,
});

describe('isProfileSettings layer settings', () => {
  it('accepts boolean display preferences and rejects wrong types', () => {
    expect(isProfileSettings(settings({ displayAutoTheme: true, displaySunMode: false }))).toBe(
      true,
    );
    expect(isProfileSettings(settings({ displayAutoTheme: 'yes' as unknown as boolean }))).toBe(
      false,
    );
    expect(isProfileSettings(settings({ displaySunMode: 1 as unknown as boolean }))).toBe(false);
  });

  it('accepts valid instrument tile layouts and rejects invalid sizes', () => {
    expect(
      isProfileSettings(settings({ instrumentTileLayouts: { sog: 'wide', depth: 'tall' } })),
    ).toBe(true);
    expect(isProfileSettings(settings({ instrumentTileLayouts: { sog: 'huge' as never } }))).toBe(
      false,
    );
  });

  it('accepts bounded floating chart layouts and opacity', () => {
    expect(
      isProfileSettings(
        settings({
          instrumentScreenLayout: [
            { id: 'wind-rose-following', x: 0.7, y: 0.1, width: 0.2, height: 0.3 },
          ],
          instrumentOverlayOpacity: 0.65,
        }),
      ),
    ).toBe(true);
  });

  it('rejects floating chart instruments outside the chart and duplicate ids', () => {
    expect(
      isProfileSettings(
        settings({
          instrumentScreenLayout: [{ id: 'wind', x: 0.9, y: 0.1, width: 0.2, height: 0.2 }],
        }),
      ),
    ).toBe(false);
    expect(
      isProfileSettings(
        settings({
          instrumentScreenLayout: [
            { id: 'wind', x: 0, y: 0, width: 0.2, height: 0.2 },
            { id: 'wind', x: 0.3, y: 0, width: 0.2, height: 0.2 },
          ],
        }),
      ),
    ).toBe(false);
    expect(isProfileSettings(settings({ instrumentOverlayOpacity: 0.1 }))).toBe(false);
  });
  it('accepts layer entries carrying displayDepth and cellPortrayal', () => {
    const layers: LayerSettings = {
      cells: {
        visible: true,
        opacity: 0.8,
        displayDepth: 'predicted',
        cellPortrayal: 'text',
      },
    };
    expect(isProfileSettings(settings({ layers }))).toBe(true);
  });

  it('accepts the default depth-display choices too', () => {
    const layers: LayerSettings = {
      cells: {
        visible: true,
        opacity: 1,
        displayDepth: 'conservative',
        cellPortrayal: 'shaded',
      },
    };
    expect(isProfileSettings(settings({ layers }))).toBe(true);
  });

  it('round-trips the depth-display choices with the other optional scales', () => {
    const layers: LayerSettings = {
      'chart:server:enc': { visible: false, opacity: 0.8, cellSizeScale: 2 },
      cells: {
        visible: true,
        opacity: 1,
        labelSizeScale: 1.5,
        displayDepth: 'predicted',
        cellPortrayal: 'shaded',
      },
    };
    expect(isProfileSettings(settings({ layers }))).toBe(true);
    expect(settings({ layers }).layers).toEqual(layers);
  });
  it('rejects an unknown displayDepth value', () => {
    const layers = {
      cells: { visible: true, opacity: 1, displayDepth: 'instantaneous' },
    } as never;
    expect(isProfileSettings(settings({ layers }))).toBe(false);
  });

  it('rejects an unknown cellPortrayal value', () => {
    const layers = {
      cells: { visible: true, opacity: 1, cellPortrayal: 'wireframe' },
    } as never;
    expect(isProfileSettings(settings({ layers }))).toBe(false);
  });

  it('rejects a wrong-typed displayDepth or cellPortrayal', () => {
    expect(
      isProfileSettings(
        settings({
          layers: { cells: { visible: true, opacity: 1, displayDepth: 1 } as never },
        }),
      ),
    ).toBe(false);
    expect(
      isProfileSettings(
        settings({
          layers: { cells: { visible: true, opacity: 1, cellPortrayal: true } as never },
        }),
      ),
    ).toBe(false);
  });

  it('rejects a layer entry with an unknown key', () => {
    expect(
      isProfileSettings(
        settings({
          layers: { cells: { visible: true, opacity: 1, tint: 'blue' } as never },
        }),
      ),
    ).toBe(false);
  });
});
