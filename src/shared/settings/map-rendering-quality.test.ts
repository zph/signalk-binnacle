import { describe, expect, it } from 'vitest';
import { mapRenderingPixelRatio } from './map-rendering-quality';

describe('mapRenderingPixelRatio', () => {
  it('uses one device pixel per map pixel in performance mode', () => {
    expect(mapRenderingPixelRatio('performance', 3)).toBe(1);
  });

  it('caps balanced mode and preserves smaller native ratios', () => {
    expect(mapRenderingPixelRatio('balanced', 3)).toBe(1.5);
    expect(mapRenderingPixelRatio('balanced', 1.25)).toBe(1.25);
  });

  it('uses the device ratio in native mode and repairs invalid browser values', () => {
    expect(mapRenderingPixelRatio('native', 2)).toBe(2);
    expect(mapRenderingPixelRatio('native', Number.NaN)).toBe(1);
  });
});
