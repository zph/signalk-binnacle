import type {
  FilterSpecification,
  LayerSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import { createExpression } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_S57_SAFETY_DEPTH_METERS,
  S57_SUPPORTED_SOURCE_LAYERS,
  S57_THEME_PAINT_KEY,
  type S57ThemeColorKey,
  type S57ThemePaintMap,
  s57ChartLayers,
  s57ThemeColor,
} from './s57-chart-style';

const SOURCE_ID = 'chart-california-enc';

type TestLayer = LayerSpecification & { filter?: FilterSpecification };

function layer(layers: LayerSpecification[], suffix: string): TestLayer {
  const match = layers.find((candidate) => candidate.id === `${SOURCE_ID}-${suffix}`);
  if (!match) throw new Error(`Missing layer ${suffix}`);
  return match as TestLayer;
}

function themePaint(layerSpecification: LayerSpecification): S57ThemePaintMap {
  const metadata = layerSpecification.metadata as Record<string, S57ThemePaintMap> | undefined;
  if (!metadata?.[S57_THEME_PAINT_KEY]) {
    throw new Error(`Missing S-57 theme metadata on ${layerSpecification.id}`);
  }
  return metadata[S57_THEME_PAINT_KEY];
}

function evaluateSounding(
  sounding: SymbolLayerSpecification,
  unit: 'm' | 'ft',
  depthMeters: number,
): unknown {
  const parsed = createExpression(sounding.layout?.['text-field'], 's57-sounding', null, { unit });
  if (parsed.result === 'error') {
    throw new Error(parsed.value.map(({ message }) => message).join('; '));
  }
  return parsed.value.evaluate({ zoom: 12 }, {
    type: 'Point',
    properties: { DEPTH: depthMeters },
  } as never);
}

describe('s57ChartLayers', () => {
  it('emits the supported schema when chart metadata omits its source-layer list', () => {
    const layers = s57ChartLayers(SOURCE_ID, []);
    const emittedSourceLayers = new Set(
      layers.map((candidate) => (candidate as { 'source-layer': string })['source-layer']),
    );

    expect(layers.length).toBeGreaterThan(S57_SUPPORTED_SOURCE_LAYERS.length);
    expect(emittedSourceLayers).toEqual(new Set(S57_SUPPORTED_SOURCE_LAYERS));
  });

  it('emits nothing when nonempty metadata has no supported source layers', () => {
    expect(s57ChartLayers(SOURCE_ID, ['DSID', 'M_COVR'])).toEqual([]);
  });

  it('skips absent source layers and preserves cruising draw order', () => {
    const layers = s57ChartLayers(SOURCE_ID, [
      'BOYLAT',
      'WRECKS',
      'SOUNDG',
      'DEPCNT',
      'COALNE',
      'LNDARE',
      'ACHARE',
      'DEPARE',
      'UNKNOWN',
    ]);
    const ids = layers.map((candidate) => candidate.id);

    expect(ids[0]).toBe(`${SOURCE_ID}-depare-deep`);
    expect(ids.indexOf(`${SOURCE_ID}-achare-fill`)).toBeLessThan(
      ids.indexOf(`${SOURCE_ID}-lndare-outline`),
    );
    expect(ids.indexOf(`${SOURCE_ID}-lndare-outline`)).toBeLessThan(
      ids.indexOf(`${SOURCE_ID}-coalne-line`),
    );
    expect(ids.indexOf(`${SOURCE_ID}-coalne-line`)).toBeLessThan(
      ids.indexOf(`${SOURCE_ID}-depcnt-line`),
    );
    expect(ids.indexOf(`${SOURCE_ID}-depcnt-safety`)).toBeLessThan(
      ids.indexOf(`${SOURCE_ID}-soundg-label`),
    );
    expect(ids.indexOf(`${SOURCE_ID}-soundg-label`)).toBeLessThan(
      ids.indexOf(`${SOURCE_ID}-wrecks-area`),
    );
    expect(ids.indexOf(`${SOURCE_ID}-wrecks-label`)).toBeLessThan(
      ids.indexOf(`${SOURCE_ID}-boylat-label`),
    );
    expect(ids.some((id) => id.includes('unknown'))).toBe(false);
  });

  it('builds nonoverlapping depth-area bands from DRVAL1 and DRVAL2', () => {
    const layers = s57ChartLayers(SOURCE_ID, ['DEPARE']);

    expect(layers.map((candidate) => candidate.id)).toEqual([
      `${SOURCE_ID}-depare-deep`,
      `${SOURCE_ID}-depare-safe`,
      `${SOURCE_ID}-depare-shallow`,
      `${SOURCE_ID}-depare-drying`,
    ]);
    expect(layer(layers, 'depare-safe').filter).toEqual([
      'all',
      ['>=', ['to-number', ['get', 'DRVAL1'], -9999], DEFAULT_S57_SAFETY_DEPTH_METERS],
      ['<', ['to-number', ['get', 'DRVAL1'], -9999], 10],
    ]);
    expect(layer(layers, 'depare-shallow').filter).toEqual([
      'all',
      ['<', ['to-number', ['get', 'DRVAL1'], -9999], DEFAULT_S57_SAFETY_DEPTH_METERS],
      ['>', ['to-number', ['get', 'DRVAL2'], -9999], 0],
    ]);
    expect(layer(layers, 'depare-drying').filter).toEqual([
      'all',
      ['has', 'DRVAL2'],
      ['<=', ['to-number', ['get', 'DRVAL2'], -9999], 0],
    ]);
  });

  it('uses a custom safety depth for comparisons without converting source meters', () => {
    const layers = s57ChartLayers(SOURCE_ID, ['DEPARE', 'DEPCNT', 'SOUNDG'], {
      safetyDepth: 4.5,
      depthUnit: 'ft',
    });

    expect(JSON.stringify(layer(layers, 'depare-safe').filter)).toContain('4.5');
    expect(layer(layers, 'depcnt-safety').filter).toEqual([
      'all',
      ['>=', ['to-number', ['get', 'VALDCO'], -9999], 4.5],
      ['<', ['to-number', ['get', 'VALDCO'], -9999], 7.5],
    ]);
    expect(layer(layers, 'soundg-label').filter).toEqual([
      'any',
      ['has', 'DEPTH'],
      ['has', 'VALSOU'],
    ]);
  });

  it('portrays the safety contour as a thin medium-gray line', () => {
    const safety = layer(s57ChartLayers(SOURCE_ID, ['DEPCNT']), 'depcnt-safety');

    expect(safety.paint).toMatchObject({
      'line-color': '#747474',
      'line-width': 1.4,
    });
    expect(themePaint(safety)).toEqual({ 'line-color': 'safetyContour' });
    expect(s57ThemeColor('dusk', 'safetyContour')).toBe('#8a8a8a');
    expect(s57ThemeColor('night-red', 'safetyContour')).toBe('#6a2000');
  });

  it('converts sounding text live from map unit state without appending a unit', () => {
    const meters = layer(
      s57ChartLayers(SOURCE_ID, ['SOUNDG']),
      'soundg-label',
    ) as SymbolLayerSpecification;
    const feet = layer(
      s57ChartLayers(SOURCE_ID, ['SOUNDG'], { depthUnit: 'ft' }),
      'soundg-label',
    ) as SymbolLayerSpecification;
    const fathoms = layer(
      s57ChartLayers(SOURCE_ID, ['SOUNDG'], { depthUnit: 'fm' }),
      'soundg-label',
    ) as SymbolLayerSpecification;

    for (const sounding of [meters, feet, fathoms]) {
      const text = sounding.layout?.['text-field'];
      expect(JSON.stringify(text)).toContain('["global-state","unit"]');
      expect(JSON.stringify(text)).toContain('3.28084');
      expect(JSON.stringify(text)).toContain('1.8288');
      expect(JSON.stringify(text)).toContain('"floor"');
      expect(JSON.stringify(text)).not.toContain('"concat"');
    }
    // The configured option is only the expression's fallback for a host that does not seed global
    // state. Once Binnacle sets `unit`, every chart follows the live preference without rebuilding.
    expect(meters.layout?.['text-field']).not.toEqual(feet.layout?.['text-field']);
    expect(feet.layout?.['text-field']).not.toEqual(fathoms.layout?.['text-field']);
    expect(feet.filter).toEqual(meters.filter);
    expect(fathoms.filter).toEqual(meters.filter);
  });

  it('keeps tenths through 20 ft and floors deeper sounding labels after unit conversion', () => {
    const feet = layer(
      s57ChartLayers(SOURCE_ID, ['SOUNDG'], { depthUnit: 'ft' }),
      'soundg-label',
    ) as SymbolLayerSpecification;
    const value = ['to-number', ['coalesce', ['get', 'DEPTH'], ['get', 'VALSOU']], -9999];
    const converted = ['*', value, 3.28084];

    const feetDisplay = [
      'case',
      ['>', converted, 20],
      [
        'number-format',
        ['floor', converted],
        { 'max-fraction-digits': 0, 'min-fraction-digits': 0 },
      ],
      ['number-format', converted, { 'max-fraction-digits': 1, 'min-fraction-digits': 0 }],
    ];
    const text = feet.layout?.['text-field'];
    expect((text as unknown[]).slice(0, 4)).toEqual([
      'match',
      ['global-state', 'unit'],
      'ft',
      feetDisplay,
    ]);
    expect((text as unknown[]).at(-1)).toEqual(feetDisplay);
  });

  it('evaluates meter-native source depths in the live selected unit', () => {
    const sounding = layer(
      s57ChartLayers(SOURCE_ID, ['SOUNDG']),
      'soundg-label',
    ) as SymbolLayerSpecification;

    expect(evaluateSounding(sounding, 'm', 3)).toBe('3');
    expect(evaluateSounding(sounding, 'ft', 3)).toBe('9.8');
    expect(evaluateSounding(sounding, 'ft', 10)).toBe('32');
  });

  it('renders every sounding as the same plain black text without a background or halo', () => {
    const sounding = layer(s57ChartLayers(SOURCE_ID, ['SOUNDG']), 'soundg-label');

    expect(sounding.layout).not.toHaveProperty('icon-image');
    expect(sounding.layout).not.toHaveProperty('icon-text-fit');
    expect(sounding.paint).toEqual({ 'text-color': '#000000' });
    expect(sounding.paint).not.toHaveProperty('text-halo-color');
    expect(sounding.paint).not.toHaveProperty('text-halo-width');
    expect(themePaint(sounding)).toEqual({ 'text-color': 'soundingText' });
    for (const theme of ['day', 'dusk', 'night-red'] as const) {
      expect(s57ThemeColor(theme, 'soundingText')).toBe('#000000');
    }
  });

  it('falls back to the default safety depth for invalid values', () => {
    const negative = s57ChartLayers(SOURCE_ID, ['DEPCNT'], { safetyDepth: -1 });
    const nonfinite = s57ChartLayers(SOURCE_ID, ['DEPCNT'], { safetyDepth: Number.NaN });

    expect(layer(negative, 'depcnt-safety').filter).toEqual(
      layer(nonfinite, 'depcnt-safety').filter,
    );
    expect(JSON.stringify(layer(negative, 'depcnt-safety').filter)).toContain(
      String(DEFAULT_S57_SAFETY_DEPTH_METERS),
    );
  });

  it('fills anchorage areas but keeps regulated areas outline-only to prevent stacked washes', () => {
    const layers = s57ChartLayers(SOURCE_ID, ['DRGARE', 'ACHARE', 'RESARE', 'MIPARE', 'CTNARE']);

    expect(layer(layers, 'drgare-fill').type).toBe('fill');
    expect(layer(layers, 'drgare-outline').type).toBe('line');
    expect(layer(layers, 'achare-fill').type).toBe('fill');
    expect(layer(layers, 'achare-outline').type).toBe('line');
    expect(layer(layers, 'achare-label').type).toBe('symbol');
    for (const sourceLayer of ['resare', 'mipare', 'ctnare']) {
      expect(layers.some((candidate) => candidate.id === `${SOURCE_ID}-${sourceLayer}-fill`)).toBe(
        false,
      );
      const edgeShade = layer(layers, `${sourceLayer}-edge-shade`);
      expect(edgeShade.type).toBe('line');
      expect(edgeShade.paint).toMatchObject({ 'line-opacity': 0.09, 'line-width': 8 });
      expect(layer(layers, `${sourceLayer}-outline`).type).toBe('line');
      expect(layer(layers, `${sourceLayer}-label`).type).toBe('symbol');
    }
  });

  it('leaves ENC land transparent while retaining hydrographic coastline linework', () => {
    const layers = s57ChartLayers(SOURCE_ID, ['LNDARE', 'COALNE', 'SLCONS']);

    expect(layers.some((candidate) => candidate.id === `${SOURCE_ID}-lndare-fill`)).toBe(false);
    expect(layer(layers, 'lndare-outline').type).toBe('line');
    expect(layer(layers, 'coalne-line').type).toBe('line');
    expect(layer(layers, 'slcons-line').type).toBe('line');
  });

  it('draws routing areas, traffic lines, utilities, bridges, canals, and unsurveyed water', () => {
    const layers = s57ChartLayers(SOURCE_ID, [
      'FAIRWY',
      'CANALS',
      'NAVLNE',
      'TSSLPT',
      'TSSBND',
      'TSEZNE',
      'CBLSUB',
      'PIPSOL',
      'BRIDGE',
      'UNSARE',
    ]);

    for (const sourceLayer of ['fairwy', 'tsslpt']) {
      expect(layer(layers, `${sourceLayer}-fill`).type).toBe('fill');
      expect(layer(layers, `${sourceLayer}-outline`).type).toBe('line');
      expect(layer(layers, `${sourceLayer}-label`).type).toBe('symbol');
    }
    expect(layers.some((candidate) => candidate.id === `${SOURCE_ID}-tsezne-fill`)).toBe(false);
    expect(layer(layers, 'tsezne-edge-shade').paint).toMatchObject({
      'line-opacity': 0.09,
      'line-width': 8,
    });
    expect(layer(layers, 'tsezne-outline').type).toBe('line');
    expect(layer(layers, 'tsezne-label').type).toBe('symbol');
    expect(layer(layers, 'canals-fill').type).toBe('fill');
    expect(layer(layers, 'canals-outline').type).toBe('line');
    expect(layer(layers, 'unsare-fill').type).toBe('fill');
    expect(themePaint(layer(layers, 'unsare-fill'))['fill-color']).toBe('danger');

    for (const sourceLayer of ['navlne', 'tssbnd', 'cblsub', 'pipsol', 'bridge']) {
      expect(layer(layers, `${sourceLayer}-line`).type).toBe('line');
      const labelSpecification = layer(layers, `${sourceLayer}-label`);
      expect(labelSpecification.type).toBe('symbol');
      expect((labelSpecification as SymbolLayerSpecification).layout?.['symbol-placement']).toBe(
        'line',
      );
    }
    expect(themePaint(layer(layers, 'navlne-line'))['line-color']).toBe('anchorage');
    expect(themePaint(layer(layers, 'tssbnd-line'))['line-color']).toBe('restricted');
    expect(themePaint(layer(layers, 'bridge-line'))['line-color']).toBe('coastline');
  });

  it('leaves symbolized hazard points to the icon layer while retaining areas and labels', () => {
    const layers = s57ChartLayers(SOURCE_ID, ['WRECKS', 'UWTROC', 'OBSTRN', 'FOULGND']);

    for (const sourceLayer of ['wrecks', 'uwtroc', 'obstrn']) {
      expect(layer(layers, `${sourceLayer}-area`).type).toBe('fill');
      expect(layer(layers, `${sourceLayer}-outline`).type).toBe('line');
      expect(layer(layers, `${sourceLayer}-label`).type).toBe('symbol');
      expect(layers.some((candidate) => candidate.id === `${SOURCE_ID}-${sourceLayer}-point`)).toBe(
        false,
      );
    }
    expect(layer(layers, 'foulgnd-point').filter).toEqual(['==', ['geometry-type'], 'Point']);
    expect(themePaint(layer(layers, 'foulgnd-point'))).toEqual({
      'circle-color': 'danger',
      'circle-stroke-color': 'label',
    });
  });

  it('styles lateral marks by CATLAM and includes other marks, lights, and names', () => {
    const layers = s57ChartLayers(SOURCE_ID, [
      'BOYLAT',
      'BCNLAT',
      'BOYSAW',
      'BCNSPP',
      'DAYMAR',
      'LNDMRK',
      'LIGHTS',
    ]);

    expect(layer(layers, 'boylat-label').type).toBe('symbol');
    expect(layer(layers, 'bcnlat-label').type).toBe('symbol');
    expect(layers.some((candidate) => candidate.id.includes('boylat-port'))).toBe(false);
    expect(layers.some((candidate) => candidate.id === `${SOURCE_ID}-boysaw-mark`)).toBe(false);
    expect(layers.some((candidate) => candidate.id === `${SOURCE_ID}-bcnspp-mark`)).toBe(false);
    expect(layer(layers, 'daymar-mark').type).toBe('circle');
    expect(layer(layers, 'lndmrk-mark').type).toBe('circle');
    expect(layers.some((candidate) => candidate.id === `${SOURCE_ID}-lights-flare`)).toBe(false);
    expect(layer(layers, 'lights-label').type).toBe('symbol');
  });

  it('stamps every color paint with typed semantic theme metadata', () => {
    const layers = s57ChartLayers(SOURCE_ID, [
      'DEPARE',
      'DRGARE',
      'ACHARE',
      'RESARE',
      'LNDARE',
      'COALNE',
      'DEPCNT',
      'SOUNDG',
      'WRECKS',
      'BOYLAT',
      'LIGHTS',
    ]);

    for (const candidate of layers) {
      const mappings = Object.entries(themePaint(candidate));
      expect(mappings.length).toBeGreaterThan(0);
      for (const [property, colorKey] of mappings) {
        const paint = candidate.paint as Record<string, unknown>;
        expect(paint[property]).toBe(s57ThemeColor('day', colorKey as S57ThemeColorKey));
      }
    }
  });

  it('keeps every night palette color out of the blue channel', () => {
    const keys: S57ThemeColorKey[] = [
      'anchorage',
      'coastline',
      'contour',
      'danger',
      'depthDeep',
      'depthSafe',
      'depthShallow',
      'dredged',
      'drying',
      'label',
      'land',
      'navLight',
      'navPort',
      'navStarboard',
      'navaid',
      'restricted',
      'safetyContour',
      'soundingText',
    ];

    for (const key of keys) {
      expect(s57ThemeColor('night-red', key).slice(5, 7)).toBe('00');
    }
  });
});
