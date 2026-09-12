import { describe, expect, it } from 'vitest';
import TOKENS_CSS from '../../styles/tokens.css?raw';
import type { Rgba } from './icon-raster';
import { colorProperty, mapThemePaint } from './map-theme';

const THEME_SELECTOR = {
  day: /:root\s*\{([^}]*)\}/,
  dusk: /:root\[data-theme="dusk"\]\s*\{([^}]*)\}/,
  'night-red': /:root\[data-theme="night-red"\]\s*\{([^}]*)\}/,
} as const;

function tokenValue(theme: keyof typeof THEME_SELECTOR, token: string): string {
  const block = TOKENS_CSS.match(THEME_SELECTOR[theme])?.[1] ?? '';
  const value = block.match(new RegExp(`--${token}:\\s*(#[0-9a-fA-F]+)`))?.[1];
  if (!value) throw new Error(`--${token} not found for theme "${theme}" in tokens.css`);
  return value.toLowerCase();
}

describe('mapThemePaint', () => {
  // MapLibre paint properties cannot read a CSS custom property, so map-theme.ts hand-copies
  // --alarm and --select from tokens.css per theme. This guards the two from drifting apart
  // silently, since nothing else catches a retune of one without the other.
  it('mirrors --alarm and --select from tokens.css for each theme', () => {
    for (const theme of ['day', 'dusk', 'night-red'] as const) {
      const paint = mapThemePaint(theme);
      expect(paint.danger.toLowerCase()).toBe(tokenValue(theme, 'alarm'));
      expect(paint.select.toLowerCase()).toBe(tokenValue(theme, 'select'));
    }
  });

  it('returns a background and water color for each theme', () => {
    for (const theme of ['day', 'dusk', 'night-red'] as const) {
      const paint = mapThemePaint(theme);
      expect(typeof paint.background).toBe('string');
      expect(typeof paint.water).toBe('string');
    }
  });

  it('night-red uses a black background', () => {
    expect(mapThemePaint('night-red').background).toBe('#000000');
  });

  it('carries opaque symbol colors for the own vessel and AIS in each theme', () => {
    for (const theme of ['day', 'dusk', 'night-red'] as const) {
      const paint = mapThemePaint(theme);
      expect(paint.ownVessel.a).toBe(0xff);
      expect(paint.aisTarget.a).toBe(0xff);
      expect(paint.aisWarning.a).toBe(0xff);
      expect(paint.aisDanger.a).toBe(0xff);
    }
  });

  it('uses zero blue for the night-red own vessel', () => {
    // The loose b < 0x40 tolerance is what let a pink vessel (b = 0x3a) ship; the contract is a
    // pure red-family tone, so blue is exactly zero.
    const { ownVessel } = mapThemePaint('night-red');
    expect(ownVessel.r).toBeGreaterThan(ownVessel.g);
    expect(ownVessel.b).toBe(0);
  });

  it('keeps every night-red AIS grade in the red band, with zero blue', () => {
    const { aisTarget, aisWarning, aisDanger } = mapThemePaint('night-red');
    for (const color of [aisTarget, aisWarning, aisDanger]) {
      expect(color.r).toBeGreaterThan(color.g);
      expect(color.b).toBe(0);
    }
    expect(aisDanger.r).toBeGreaterThan(aisWarning.r);
    expect(aisWarning.g).toBeGreaterThan(aisTarget.g);
  });

  it('uses bright blue, amber, and red for day and dusk AIS grades', () => {
    for (const theme of ['day', 'dusk'] as const) {
      const { aisTarget, aisWarning, aisDanger } = mapThemePaint(theme);
      expect(aisTarget.b).toBeGreaterThan(aisTarget.r);
      expect(aisWarning.r).toBeGreaterThan(aisWarning.b);
      expect(aisWarning.g).toBeGreaterThan(aisWarning.b);
      expect(aisDanger.r).toBeGreaterThan(aisDanger.g);
      expect(aisDanger.r).toBeGreaterThan(aisDanger.b);
    }
  });
});

function luminance(hex: string): number {
  const channel = (index: number) => {
    const value = Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

function rgbaHex(color: Rgba): string {
  const pair = (value: number) => value.toString(16).padStart(2, '0');
  return `#${pair(color.r)}${pair(color.g)}${pair(color.b)}`;
}

describe('mapThemePaint sun variant', () => {
  const day = mapThemePaint('day');
  const sun = mapThemePaint('day', true);

  it('keeps day semantics and leaves dusk and night-red unchanged', () => {
    expect(sun.theme).toBe('day');
    expect(mapThemePaint('day', false)).toEqual(day);
    expect(mapThemePaint('dusk', true)).toEqual(mapThemePaint('dusk'));
    expect(mapThemePaint('night-red', true)).toEqual(mapThemePaint('night-red'));
  });

  it('keeps alarm, selection, and raster behavior aligned with standard day', () => {
    expect(sun.danger.toLowerCase()).toBe(tokenValue('day', 'alarm'));
    expect(sun.select.toLowerCase()).toBe(tokenValue('day', 'select'));
    expect(sun.rasterSaturation).toBe(day.rasterSaturation);
    expect(sun.rasterBrightnessMax).toBe(day.rasterBrightnessMax);
  });

  it('increases chart contrast for labels, strokes, markers, land, and water', () => {
    expect(luminance(sun.background)).toBeGreaterThan(luminance(day.background));
    expect(luminance(sun.label)).toBeLessThan(luminance(day.label));
    for (const key of [
      'label',
      'road',
      'boundary',
      'warning',
      'note',
      'tide',
      'waypoint',
      'routeHighlight',
      'navStarboard',
      'navPort',
      'navLight',
      'trackSolid',
      'scrubMarker',
    ] as const) {
      expect(contrast(sun[key], sun.background)).toBeGreaterThan(
        contrast(day[key], day.background),
      );
    }
    expect(contrast(sun.water, sun.land)).toBeGreaterThan(contrast(day.water, day.land));
    expect(contrast(rgbaHex(sun.ownVessel), sun.water)).toBeGreaterThan(
      contrast(rgbaHex(day.ownVessel), day.water),
    );
    expect(contrast(rgbaHex(sun.aisTarget), sun.water)).toBeGreaterThan(
      contrast(rgbaHex(day.aisTarget), day.water),
    );
  });

  it('keeps the own-track speed ramp dark to light', () => {
    expect(luminance(sun.trackSlow)).toBeLessThan(luminance(sun.trackMid));
    expect(luminance(sun.trackMid)).toBeLessThan(luminance(sun.trackFast));
  });
});

describe('colorProperty', () => {
  it('maps line to line-color', () => {
    expect(colorProperty('line')).toBe('line-color');
  });

  it('maps symbol to text-color', () => {
    expect(colorProperty('symbol')).toBe('text-color');
  });

  it('defaults everything else to fill-color', () => {
    expect(colorProperty('fill')).toBe('fill-color');
    expect(colorProperty('raster')).toBe('fill-color');
  });
});
