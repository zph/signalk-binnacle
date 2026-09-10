import { describe, expect, it } from 'vitest';
import {
  type DepthTilePixels,
  draftFromSignalKValues,
  scanSeascapeAhead,
  terrariumDepthMeters,
  tilePixelAt,
} from './shallow-ahead';

function encodedDepthTile(depthM: number): DepthTilePixels {
  const elevation = -depthM + 32_768;
  const red = Math.floor(elevation / 256);
  const green = Math.floor(elevation - red * 256);
  const blue = Math.round((elevation - Math.floor(elevation)) * 256);
  const data = new Uint8ClampedArray(512 * 512 * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = red;
    data[offset + 1] = green;
    data[offset + 2] = blue;
    data[offset + 3] = 255;
  }
  return { width: 512, height: 512, data };
}

describe('Seascape shallow-ahead profile', () => {
  it('resolves current, maximum, then minimum Signal K draft values', () => {
    expect(draftFromSignalKValues([1.8, 2, 1.5])).toBe(1.8);
    expect(draftFromSignalKValues([undefined, { value: 2.1 }, 1.5])).toBe(2.1);
    expect(draftFromSignalKValues([0, Number.NaN, -1])).toBeUndefined();
  });

  it('decodes Terrarium elevation as water depth', () => {
    expect(terrariumDepthMeters(127, 252, 128)).toBeCloseTo(3.5);
  });

  it('maps positions to bounded pixels in a Web Mercator tile', () => {
    expect(tilePixelAt({ latitude: 0, longitude: 0 }, 1, 512)).toEqual({
      x: 1,
      y: 1,
      pixelX: 0,
      pixelY: 0,
    });
  });

  it('reports the first depth strictly below twice draft', async () => {
    const signal = new AbortController().signal;
    const shallow = encodedDepthTile(3.9);
    const profile = await scanSeascapeAhead(
      {
        position: { latitude: 10, longitude: 20 },
        courseRad: Math.PI / 2,
        distanceM: 25,
        thresholdM: 4,
        signal,
      },
      async () => shallow,
    );
    expect(profile.hazard?.distanceM).toBe(0);
    expect(profile.hazard?.depthM).toBeCloseTo(3.9, 2);
    expect(profile.coverageComplete).toBe(true);

    const equal = await scanSeascapeAhead(
      {
        position: { latitude: 10, longitude: 20 },
        courseRad: 0,
        distanceM: 10,
        thresholdM: 4,
        signal,
      },
      async () => encodedDepthTile(4),
    );
    expect(equal.hazard).toBeUndefined();
  });

  it('reports transparent or absent tile samples as a coverage gap', async () => {
    const profile = await scanSeascapeAhead(
      {
        position: { latitude: 10, longitude: 20 },
        courseRad: 0,
        distanceM: 10,
        thresholdM: 4,
        signal: new AbortController().signal,
      },
      async () => undefined,
    );
    expect(profile.coverageComplete).toBe(false);
    expect(profile.coverageFraction).toBe(0);
    expect(profile.hazard).toBeUndefined();
  });
});
