import type { AisVesselKind } from '$entities/ais';
import { type Rgba, rasterIconColored } from '$shared/map';

const DESIGN_SIZE = 56;
const RASTER_SCALE = 2;
const SIZE = DESIGN_SIZE * RASTER_SCALE;
const STROKE_RADIUS = 2.1;
const BORDER_RADIUS = 2 * RASTER_SCALE;
const BLACK_BORDER: Rgba = { r: 0, g: 0, b: 0, a: 0xff };

type Segment = readonly [x1: number, y1: number, x2: number, y2: number];

const LONG_HULL: readonly Segment[] = [
  [28, 3, 38, 10],
  [38, 10, 40, 46],
  [40, 46, 35, 52],
  [35, 52, 21, 52],
  [21, 52, 16, 46],
  [16, 46, 18, 10],
  [18, 10, 28, 3],
];

const UTILITY_HULL: readonly Segment[] = [
  [28, 5, 40, 19],
  [40, 19, 39, 43],
  [39, 43, 34, 51],
  [34, 51, 22, 51],
  [22, 51, 17, 43],
  [17, 43, 16, 19],
  [16, 19, 28, 5],
];

const SHAPE_SEGMENTS: Readonly<Record<AisVesselKind, readonly Segment[]>> = {
  ship: [
    ...LONG_HULL,
    [20, 38, 36, 38],
    [20, 38, 21, 47],
    [36, 38, 35, 47],
    [21, 47, 35, 47],
    [28, 9, 28, 33],
  ],
  cargo: [
    ...LONG_HULL,
    [20, 13, 36, 13],
    [20, 23, 36, 23],
    [20, 33, 36, 33],
    [20, 13, 20, 33],
    [36, 13, 36, 33],
    [20, 38, 36, 38],
    [20, 38, 21, 48],
    [36, 38, 35, 48],
    [21, 48, 35, 48],
  ],
  tanker: [
    ...LONG_HULL,
    [20, 39, 36, 39],
    [20, 39, 21, 48],
    [36, 39, 35, 48],
    [21, 48, 35, 48],
    [22, 14, 34, 14],
    [34, 14, 34, 23],
    [34, 23, 22, 23],
    [22, 23, 22, 14],
    [22, 27, 34, 27],
    [34, 27, 34, 36],
    [34, 36, 22, 36],
    [22, 36, 22, 27],
  ],
  passenger: [
    ...LONG_HULL,
    [21, 15, 35, 15],
    [21, 15, 21, 44],
    [35, 15, 35, 44],
    [21, 44, 35, 44],
    [25, 18, 25, 41],
    [31, 18, 31, 41],
    [21, 28, 35, 28],
  ],
  fishing: [
    ...UTILITY_HULL,
    [20, 29, 36, 29],
    [36, 29, 35, 43],
    [35, 43, 21, 43],
    [21, 43, 20, 29],
    [28, 12, 28, 27],
    [19, 19, 37, 19],
    [19, 19, 13, 28],
    [37, 19, 43, 28],
  ],
  service: [
    ...UTILITY_HULL,
    [21, 23, 35, 23],
    [35, 23, 35, 40],
    [35, 40, 21, 40],
    [21, 40, 21, 23],
    [24, 28, 32, 28],
    [24, 35, 32, 35],
    [28, 14, 28, 23],
  ],
  tug: [
    ...UTILITY_HULL,
    [20, 27, 36, 27],
    [36, 27, 35, 43],
    [35, 43, 21, 43],
    [21, 43, 20, 27],
    [22, 32, 34, 32],
    [23, 18, 33, 18],
    [28, 13, 28, 22],
  ],
  motorboat: [
    [28, 4, 37, 15],
    [37, 15, 39, 41],
    [39, 41, 32, 51],
    [32, 51, 24, 51],
    [24, 51, 17, 41],
    [17, 41, 19, 15],
    [19, 15, 28, 4],
    [22, 29, 28, 23],
    [28, 23, 34, 29],
    [22, 29, 24, 43],
    [34, 29, 32, 43],
    [24, 43, 32, 43],
  ],
  sailboat: [
    [28, 4, 36, 43],
    [36, 43, 32, 52],
    [32, 52, 24, 52],
    [24, 52, 20, 43],
    [20, 43, 28, 4],
    [28, 9, 28, 47],
    [26, 13, 12, 38],
    [12, 38, 26, 38],
    [30, 19, 41, 38],
    [41, 38, 30, 38],
  ],
};

function distanceToSegment(x: number, y: number, segment: Segment): number {
  const [x1, y1, x2, y2] = segment;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  const projection = lengthSquared === 0 ? 0 : ((x - x1) * dx + (y - y1) * dy) / lengthSquared;
  const t = Math.max(0, Math.min(1, projection));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

function onShape(kind: AisVesselKind, x: number, y: number): boolean {
  return SHAPE_SEGMENTS[kind].some((segment) => distanceToSegment(x, y, segment) <= STROKE_RADIUS);
}

export function aisIconImage(kind: AisVesselKind, color: Rgba): ImageData {
  const shape = new Uint8Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if (onShape(kind, x / RASTER_SCALE, y / RASTER_SCALE)) shape[y * SIZE + x] = 1;
    }
  }
  return rasterIconColored(SIZE, (x, y) => {
    if (shape[y * SIZE + x] === 1) return color;
    for (let dy = -BORDER_RADIUS; dy <= BORDER_RADIUS; dy += 1) {
      for (let dx = -BORDER_RADIUS; dx <= BORDER_RADIUS; dx += 1) {
        const neighborX = x + dx;
        const neighborY = y + dy;
        if (
          neighborX >= 0 &&
          neighborX < SIZE &&
          neighborY >= 0 &&
          neighborY < SIZE &&
          dx * dx + dy * dy <= BORDER_RADIUS * BORDER_RADIUS &&
          shape[neighborY * SIZE + neighborX] === 1
        ) {
          return BLACK_BORDER;
        }
      }
    }
    return null;
  });
}
