import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIS_ICON_KINDS, aisVesselIconScale, loadAisIconArtwork } from './ais-icon';
import { aisIconImage } from './ais-icon-artwork';

class FakeImageData {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}

beforeEach(() => vi.stubGlobal('ImageData', FakeImageData));
afterEach(() => vi.unstubAllGlobals());

describe('AIS vessel icons', () => {
  it('loads the artwork through the lazy feature chunk', async () => {
    await expect(loadAisIconArtwork()).resolves.toHaveProperty('aisIconImage', aisIconImage);
  });

  it('draws a distinct high-density symbol for each supported vessel kind', () => {
    const color = { r: 210, g: 130, b: 20, a: 255 };
    const images = AIS_ICON_KINDS.map((kind) => aisIconImage(kind, color));

    for (const image of images) {
      expect(image.width).toBe(112);
      expect(image.height).toBe(112);
      expect(image.data.some((channel) => channel !== 0)).toBe(true);
    }
    expect(new Set(images.map((image) => image.data.join(','))).size).toBe(AIS_ICON_KINDS.length);
  });

  it('uses only the supplied target color and an opaque black border', () => {
    const target = { r: 176, g: 46, b: 0, a: 255 };
    const targetChannels = [target.r, target.g, target.b, target.a];
    const image = aisIconImage('sailboat', target);
    let borderPixels = 0;
    for (let index = 0; index < image.data.length; index += 4) {
      const alpha = image.data[index + 3];
      if (alpha === 0) continue;
      const color = Array.from(image.data.slice(index, index + 4));
      const isTarget = color.every(
        (channel, channelIndex) => channel === targetChannels[channelIndex],
      );
      const isBlackBorder = color[0] === 0 && color[1] === 0 && color[2] === 0 && color[3] === 255;
      expect(isTarget || isBlackBorder).toBe(true);
      if (isBlackBorder) borderPixels += 1;
    }
    expect(borderPixels).toBeGreaterThan(0);
  });
});

describe('aisVesselIconScale', () => {
  it('scales reported lengths monotonically and clamps extreme values', () => {
    expect(aisVesselIconScale(2)).toBe(0.7);
    expect(aisVesselIconScale(30)).toBe(1);
    expect(aisVesselIconScale(120)).toBe(1.35);
    expect(aisVesselIconScale(1_000)).toBe(1.8);
  });

  it('uses the standard scale when length is absent or invalid', () => {
    expect(aisVesselIconScale(undefined)).toBe(1);
    expect(aisVesselIconScale(0)).toBe(1);
    expect(aisVesselIconScale(Number.NaN)).toBe(1);
  });
});
