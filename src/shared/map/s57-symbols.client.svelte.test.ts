import type { Map as MapLibreMap, StyleImageMetadata } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';
import { mapThemePaint } from './map-theme';
import { S57_SOUNDING_SLUG_IDS } from './s57-chart-style';
import { registerS57Symbols } from './s57-symbols';

interface RegisteredImage {
  image: ImageData;
  metadata?: Partial<StyleImageMetadata>;
}

function centerPixel(image: ImageData): number[] {
  const x = Math.floor(image.width / 2);
  const y = Math.floor(image.height / 2);
  const offset = (y * image.width + x) * 4;
  return [...image.data.slice(offset, offset + 4)];
}

describe('S-57 browser image registration', () => {
  it('rasterizes stretchable translucent sounding slugs and updates them for night mode', async () => {
    const images = new Map<string, RegisteredImage>();
    const map = {
      hasImage: (id: string) => images.has(id),
      addImage: vi.fn((id: string, image: ImageData, metadata?: Partial<StyleImageMetadata>) => {
        images.set(id, { image, metadata });
      }),
      updateImage: vi.fn((id: string, image: ImageData) => {
        images.set(id, { ...images.get(id), image });
      }),
    } as unknown as MapLibreMap;

    await registerS57Symbols(map, mapThemePaint('day'));

    const safe = images.get(S57_SOUNDING_SLUG_IDS.safe);
    const shallow = images.get(S57_SOUNDING_SLUG_IDS.shallow);
    expect(safe?.image).toMatchObject({ width: 48, height: 36 });
    expect(shallow?.image).toMatchObject({ width: 48, height: 36 });
    expect(safe?.metadata).toMatchObject({
      pixelRatio: 2,
      stretchX: [[12, 36]],
      stretchY: [[12, 24]],
      content: [8, 4, 40, 32],
    });
    expect(centerPixel(safe?.image as ImageData)).toEqual([246, 184, 178, 209]);
    expect(centerPixel(shallow?.image as ImageData)).toEqual([181, 35, 24, 209]);

    await registerS57Symbols(map, mapThemePaint('night-red'));

    expect(map.updateImage).toHaveBeenCalledWith(S57_SOUNDING_SLUG_IDS.safe, expect.any(ImageData));
    expect(centerPixel(images.get(S57_SOUNDING_SLUG_IDS.safe)?.image as ImageData)).toEqual([
      59, 13, 0, 209,
    ]);
  });
});
