import type { LatLon } from '$shared/geo';
import { withTimeout } from '$shared/lib';
import { geodesicDestination } from '$shared/nav';
import { authInit } from '$shared/signalk';
import {
  type SeascapeTileSource,
  SHALLOW_AHEAD_SAMPLE_STEP_M,
  SHALLOW_AHEAD_TILE_SIZE,
  SHALLOW_AHEAD_ZOOM,
} from './shallow-ahead-model';

export {
  draftFromSignalKValues,
  type SeascapeTileSource,
  SHALLOW_AHEAD_LOOKAHEAD_SECONDS,
  SHALLOW_AHEAD_MAX_DISTANCE_M,
  SHALLOW_AHEAD_MIN_SPEED_MPS,
  SHALLOW_AHEAD_SAMPLE_STEP_M,
  SHALLOW_AHEAD_TILE_SIZE,
  SHALLOW_AHEAD_ZOOM,
} from './shallow-ahead-model';

const MAX_TILE_BYTES = 4 * 1024 * 1024;

export interface DepthTilePixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface ShallowAheadProfile {
  distanceM: number;
  scannedDistanceM: number;
  samples: number;
  coveredSamples: number;
  coverageFraction: number;
  coverageComplete: boolean;
  hazard?: {
    distanceM: number;
    position: LatLon;
    depthM: number;
  };
}

export type DepthTileLoader = (
  zoom: number,
  x: number,
  y: number,
  signal: AbortSignal,
) => Promise<DepthTilePixels | undefined>;

interface TilePixel {
  x: number;
  y: number;
  pixelX: number;
  pixelY: number;
}

export function terrariumDepthMeters(red: number, green: number, blue: number): number {
  const elevationM = red * 256 + green + blue / 256 - 32_768;
  return -elevationM;
}

export function tilePixelAt(position: LatLon, zoom: number, tileSize: number): TilePixel {
  const tileCount = 2 ** zoom;
  const longitude = ((((position.longitude + 180) % 360) + 360) % 360) - 180;
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, position.latitude));
  const latitudeRad = (latitude * Math.PI) / 180;
  const worldX = ((longitude + 180) / 360) * tileCount;
  const worldY = ((1 - Math.asinh(Math.tan(latitudeRad)) / Math.PI) / 2) * tileCount;
  const x = Math.min(tileCount - 1, Math.max(0, Math.floor(worldX)));
  const y = Math.min(tileCount - 1, Math.max(0, Math.floor(worldY)));
  return {
    x,
    y,
    pixelX: Math.min(
      tileSize - 1,
      Math.max(0, Math.floor((worldX - Math.floor(worldX)) * tileSize)),
    ),
    pixelY: Math.min(
      tileSize - 1,
      Math.max(0, Math.floor((worldY - Math.floor(worldY)) * tileSize)),
    ),
  };
}

export async function scanSeascapeAhead(
  input: {
    position: LatLon;
    courseRad: number;
    distanceM: number;
    thresholdM: number;
    signal: AbortSignal;
  },
  loadTile: DepthTileLoader,
): Promise<ShallowAheadProfile> {
  const cache = new Map<string, Promise<DepthTilePixels | undefined>>();
  let samples = 0;
  let coveredSamples = 0;
  let scannedDistanceM = 0;

  for (
    let distanceM = 0;
    ;
    distanceM = Math.min(input.distanceM, distanceM + SHALLOW_AHEAD_SAMPLE_STEP_M)
  ) {
    if (input.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const [longitude, latitude] = geodesicDestination(
      input.position.latitude,
      input.position.longitude,
      input.courseRad,
      distanceM,
    );
    const position = { latitude, longitude };
    const pixel = tilePixelAt(position, SHALLOW_AHEAD_ZOOM, SHALLOW_AHEAD_TILE_SIZE);
    const key = `${pixel.x}:${pixel.y}`;
    let pending = cache.get(key);
    if (!pending) {
      pending = loadTile(SHALLOW_AHEAD_ZOOM, pixel.x, pixel.y, input.signal);
      cache.set(key, pending);
    }
    const tile = await pending;
    samples += 1;
    scannedDistanceM = distanceM;
    if (tile && pixel.pixelX < tile.width && pixel.pixelY < tile.height) {
      const offset = (pixel.pixelY * tile.width + pixel.pixelX) * 4;
      if (tile.data[offset + 3] !== 0) {
        coveredSamples += 1;
        const depthM = terrariumDepthMeters(
          tile.data[offset] ?? 0,
          tile.data[offset + 1] ?? 0,
          tile.data[offset + 2] ?? 0,
        );
        if (depthM < input.thresholdM) {
          return profileResult(input.distanceM, scannedDistanceM, samples, coveredSamples, {
            distanceM,
            position,
            depthM,
          });
        }
      }
    }
    if (distanceM >= input.distanceM) break;
  }

  return profileResult(input.distanceM, scannedDistanceM, samples, coveredSamples);
}

function profileResult(
  distanceM: number,
  scannedDistanceM: number,
  samples: number,
  coveredSamples: number,
  hazard?: ShallowAheadProfile['hazard'],
): ShallowAheadProfile {
  const coverageFraction = samples === 0 ? 0 : coveredSamples / samples;
  return {
    distanceM,
    scannedDistanceM,
    samples,
    coveredSamples,
    coverageFraction,
    coverageComplete: coveredSamples === samples,
    ...(hazard ? { hazard } : {}),
  };
}

export function createSeascapeTileLoader(source: SeascapeTileSource): DepthTileLoader {
  return async (zoom, x, y, signal) => {
    const url = source.template
      .replace('{z}', String(zoom))
      .replace('{x}', String(x))
      .replace('{y}', String(y));
    const headers =
      source.proxied && source.token ? { Authorization: `Bearer ${source.token}` } : undefined;
    const response = await fetch(
      url,
      withTimeout(
        authInit(undefined, {
          signal,
          credentials: 'omit',
          headers,
        }),
        10_000,
      ),
    );
    if (response.status === 404 || response.status === 204) return undefined;
    if (!response.ok) throw new Error(`Seascape tile request failed (${response.status})`);
    const declaredBytes = Number(response.headers.get('Content-Length'));
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_TILE_BYTES) {
      throw new Error('Seascape tile is too large');
    }
    const blob = await response.blob();
    if (blob.size > MAX_TILE_BYTES) throw new Error('Seascape tile is too large');
    const image = await createImageBitmap(blob);
    try {
      if (image.width !== SHALLOW_AHEAD_TILE_SIZE || image.height !== SHALLOW_AHEAD_TILE_SIZE) {
        throw new Error('Seascape tile has an unexpected size');
      }
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Depth tile decoding is unavailable');
      context.drawImage(image, 0, 0);
      return {
        width: image.width,
        height: image.height,
        data: context.getImageData(0, 0, image.width, image.height).data,
      };
    } finally {
      image.close();
    }
  };
}
