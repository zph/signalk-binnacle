import { describe, expect, it } from 'vitest';
import { mapThemePaint } from './map-theme';
import {
  S57_SYMBOL_KINDS,
  s57SymbolClass,
  s57SymbolIconExpression,
  s57SymbolIconId,
  s57SymbolLayers,
  s57SymbolSvg,
} from './s57-symbols';

describe('S-57 symbol classification', () => {
  it('uses CATLAM for shape and COLOUR for fill across buoyage systems', () => {
    expect(s57SymbolClass('BOYLAT', { CATLAM: 1, COLOUR: '["3"]' })).toBe('lateral-buoy-port-red');
    expect(s57SymbolClass('BOYLAT', { CATLAM: 1, COLOUR: '["4"]' })).toBe(
      'lateral-buoy-port-green',
    );
    expect(s57SymbolClass('BCNLAT', { CATLAM: 2, COLOUR: '["3"]' })).toBe(
      'lateral-beacon-starboard-red',
    );
    expect(s57SymbolClass('BOYLAT', { CATLAM: 2, COLOUR: '["4","3","4"]' })).toBe(
      'lateral-buoy-starboard-green',
    );
  });

  it('accepts numeric, array, and category fallback encodings', () => {
    expect(s57SymbolClass('BOYLAT', { COLOUR: 4 })).toBe('lateral-buoy-unknown-green');
    expect(s57SymbolClass('BCNLAT', { COLOUR: ['3'] })).toBe('lateral-beacon-unknown-red');
    expect(s57SymbolClass('BOYLAT', { CATLAM: '1' })).toBe('lateral-buoy-port-neutral');
    expect(s57SymbolClass('BCNLAT', { CATLAM: ['4'] })).toBe('lateral-beacon-starboard-neutral');
    expect(s57SymbolClass('BOYLAT')).toBe('lateral-buoy-unknown-neutral');
    expect(s57SymbolClass('BOYLAT', { CATLAM: 1, COLOUR: '["6"]' })).toBe(
      'lateral-buoy-port-neutral',
    );
  });

  it('classifies common fixed ENC object classes', () => {
    expect(s57SymbolClass('boysaw')).toBe('safe-water-buoy');
    expect(s57SymbolClass('BCNSAW')).toBe('safe-water-beacon');
    expect(s57SymbolClass('BOYSPP', { CATSPM: '["10"]' })).toBe('special-buoy');
    expect(s57SymbolClass('BCNSPP', { CATSPM: [] })).toBe('special-beacon');
    expect(s57SymbolClass('LIGHTS')).toBe('light');
    expect(s57SymbolClass('WRECKS')).toBe('wreck');
    expect(s57SymbolClass('UWTROC')).toBe('rock');
    expect(s57SymbolClass('OBSTRN')).toBe('obstruction');
    expect(s57SymbolClass('DEPARE')).toBeUndefined();
  });
});

describe('S-57 symbol image contract', () => {
  it('uses unique, stable MapLibre image ids', () => {
    const ids = S57_SYMBOL_KINDS.map(s57SymbolIconId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(s57SymbolIconId('safe-water-buoy')).toBe('binnacle-s57-safe-water-buoy');
    expect(s57SymbolIconId('obstruction')).toBe('binnacle-s57-obstruction');
  });

  it('returns declarative expressions for lateral attributes and fixed ids otherwise', () => {
    const buoyExpression = s57SymbolIconExpression('BOYLAT');
    expect(buoyExpression).toEqual(expect.arrayContaining(['match']));
    expect(JSON.stringify(buoyExpression)).toContain('CATLAM');
    expect(JSON.stringify(s57SymbolIconExpression('BCNLAT'))).toContain('COLOUR');
    expect(JSON.stringify(buoyExpression)).toContain('slice');
    expect(JSON.stringify(buoyExpression)).toContain('binnacle-s57-lateral-buoy-port-red');
    expect(JSON.stringify(buoyExpression)).toContain('binnacle-s57-lateral-buoy-port-green');
    const expression = JSON.stringify(buoyExpression);
    expect(expression.indexOf('CATLAM')).toBeLessThan(expression.indexOf('COLOUR'));
    const portColors = (buoyExpression as unknown[])[3] as unknown[];
    expect(portColors[0]).toBe('case');
    expect(portColors[2]).toBe('binnacle-s57-lateral-buoy-port-red');
    expect(portColors[4]).toBe('binnacle-s57-lateral-buoy-port-green');
    expect(portColors[5]).toBe('binnacle-s57-lateral-buoy-port-neutral');
    expect(s57SymbolIconExpression('BOYSPP')).toBe('binnacle-s57-special-buoy');
    expect(s57SymbolIconExpression('DEPARE')).toBeUndefined();
  });

  it('builds ordered point layers only for available ENC object classes', () => {
    const layers = s57SymbolLayers('chart-california', ['LIGHTS', 'BOYLAT', 'DEPARE']);
    expect(layers.map(({ id }) => id)).toEqual([
      'chart-california-s57-symbol-boylat',
      'chart-california-s57-symbol-lights',
    ]);
    expect(layers[0]).toMatchObject({
      source: 'chart-california',
      'source-layer': 'BOYLAT',
      minzoom: 11,
      filter: ['==', ['geometry-type'], 'Point'],
    });
    expect(layers[0]?.layout).toMatchObject({
      'icon-allow-overlap': false,
      'icon-ignore-placement': false,
      'icon-optional': false,
    });
    expect(layers[1]?.layout?.['icon-anchor']).toBe('bottom');
  });

  it('builds all supported symbol layers when source metadata is unavailable', () => {
    expect(s57SymbolLayers('chart-local', [])).toHaveLength(10);
  });

  it('uses each active theme palette', () => {
    for (const theme of ['day', 'dusk', 'night-red'] as const) {
      const paint = mapThemePaint(theme);
      expect(s57SymbolSvg('lateral-buoy-port-red', paint)).toContain(paint.navStarboard);
      expect(s57SymbolSvg('lateral-buoy-port-green', paint)).toContain(paint.navPort);
      expect(s57SymbolSvg('lateral-buoy-port-neutral', paint)).toContain(paint.markerGlyph);
      expect(s57SymbolSvg('special-beacon', paint)).toContain(paint.warning);
      expect(s57SymbolSvg('light', paint)).toContain(paint.navLight);
      expect(s57SymbolSvg('wreck', paint)).toContain(paint.danger);
    }
  });

  it('keeps night symbols in the red band', () => {
    const paint = mapThemePaint('night-red');
    for (const kind of S57_SYMBOL_KINDS) {
      const colors = [...s57SymbolSvg(kind, paint).matchAll(/#[0-9a-f]{6}/gi)].map(
        ([color]) => color,
      );
      expect(colors.length).toBeGreaterThan(0);
      for (const color of colors) expect(color.toLowerCase()).toMatch(/^#[0-9a-f]{4}00$/);
    }
  });
});
