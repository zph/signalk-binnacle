import type { LayerSpecification, SymbolLayerSpecification } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import {
  BATHYMETRY_THEME_PAINT_KEY,
  type BathymetryThemePaintMap,
  bathymetryCellLayers,
  bathymetryThemePaint,
} from './bathymetry-cell-style';

const SOURCE_ID = 'chart-local-bathymetry';

function layer(layers: LayerSpecification[], suffix: string): LayerSpecification {
  const match = layers.find((candidate) => candidate.id === `${SOURCE_ID}-${suffix}`);
  if (!match) throw new Error(`Missing layer ${suffix}`);
  return match;
}

describe('bathymetry cell style', () => {
  it('draws translucent depth-colored hexes, outlines, and sounding labels', () => {
    const layers = bathymetryCellLayers(SOURCE_ID, ['DEPARE', 'SOUNDG'], {
      safetyDepth: 3,
      depthUnit: 'ft',
    });

    expect(layers.map((candidate) => candidate.id)).toEqual([
      `${SOURCE_ID}-depare-bathymetry-fill`,
      `${SOURCE_ID}-depare-bathymetry-outline`,
      `${SOURCE_ID}-soundg-bathymetry-label`,
    ]);
    expect(layer(layers, 'depare-bathymetry-fill').paint).toMatchObject({
      'fill-opacity': 0.78,
    });
    expect(layer(layers, 'depare-bathymetry-outline').paint).toMatchObject({
      'line-opacity': 0.9,
    });
    const label = layer(layers, 'soundg-bathymetry-label') as SymbolLayerSpecification;
    expect(label.minzoom).toBe(13);
    expect(label.filter).toEqual([
      'all',
      ['has', 'BATHY_LABEL'],
      ['==', ['get', 'BATHY_SHOW_DEPTH_LABELS'], true],
    ]);
    expect(label.layout?.['text-field']).toEqual(['get', 'BATHY_LABEL']);
    expect(label.layout?.['text-font']).toEqual(['Noto Sans Bold']);
    expect(label.layout?.['text-size']).toEqual([
      '*',
      ['interpolate', ['linear'], ['zoom'], 13, 17, 20, 20],
      ['get', 'BATHY_LABEL_RELATIVE_SIZE'],
    ]);
    expect(label.layout?.['text-offset']).toEqual([0, 1.35]);
    expect(label.layout?.['text-allow-overlap']).toBe(true);
    expect(label.layout?.['text-ignore-placement']).toBe(true);
    expect(label.paint?.['text-halo-width']).toBe(2.25);
  });

  it('varies day cell colors continuously across depths below the safety threshold', () => {
    const expression = bathymetryThemePaint('day', 'depth', 3) as unknown[];

    expect(expression.slice(0, 3)).toEqual([
      'interpolate',
      ['linear'],
      ['to-number', ['coalesce', ['get', 'BATHY_DEPTH_M'], ['get', 'DRVAL1']], -1],
    ]);
    expect(expression).toContain(1.5);
    expect(expression).toContain(3);
    expect(expression).toContain('#f57823');
    expect(expression).toContain('#f5d741');
  });

  it('uses red-band-only colors in night mode', () => {
    const expression = bathymetryThemePaint('night-red', 'depth', 3);
    const colors = JSON.stringify(expression).match(/#[0-9a-f]{6}/gi) ?? [];
    expect(colors.length).toBeGreaterThan(0);
    expect(colors.every((color) => color.endsWith('00'))).toBe(true);
    expect(bathymetryThemePaint('night-red', 'outline')).toMatch(/00$/);
    expect(bathymetryThemePaint('night-red', 'label')).toMatch(/00$/);
    expect(bathymetryThemePaint('night-red', 'labelHalo')).toMatch(/00$/);
  });

  it('stamps every themed paint for live recoloring', () => {
    for (const candidate of bathymetryCellLayers(SOURCE_ID, ['DEPARE', 'SOUNDG'])) {
      const metadata = candidate.metadata as Record<string, BathymetryThemePaintMap>;
      expect(Object.keys(metadata[BATHYMETRY_THEME_PAINT_KEY] ?? {})).not.toHaveLength(0);
    }
  });
});
