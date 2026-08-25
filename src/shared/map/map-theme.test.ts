import { describe, expect, it } from 'vitest';
import TOKENS_CSS from '../../styles/tokens.css?raw';
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

  it('uses cobalt, amber, and red for day and dusk AIS grades', () => {
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
