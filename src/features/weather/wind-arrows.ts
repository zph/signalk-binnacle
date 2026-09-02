import { bilinearAt, type TimeBracket, type WeatherGrid } from '$entities/weather';
import { formatSpeedOr, lerp, type SpeedUnit, speedUnitLabel } from '$shared/lib';
import { featureCollection } from '$shared/map';

const MIN_SPEED = 0.5;
const TARGET_COLUMNS = 16;
const TARGET_ROWS = 12;
const TARGET_SPACING_PX = 56;
const MAX_COLUMNS = 28;
const MAX_ROWS = 20;
const BARB_FRACTION = 0.38;
const KNOTS_PER_MPS = 1.94384;

export interface WindVectorFeatures {
  arrows: GeoJSON.FeatureCollection;
  markers: GeoJSON.FeatureCollection;
}

export interface WindVectorView {
  west: number;
  south: number;
  east: number;
  north: number;
  width?: number;
  height?: number;
}

// Select the centers of evenly sized bins rather than every Nth raw cell. This is retained for the
// arrow-only helper, while the chart-facing path below samples the continuous wind field in screen
// space so zooming into a cached forecast does not collapse to one or two source cells.
function evenIndices(length: number, target: number): number[] {
  if (length <= target) return Array.from({ length }, (_, index) => index);
  return Array.from({ length: target }, (_, index) =>
    Math.min(length - 1, Math.floor(((index + 0.5) * length) / target)),
  );
}

function targetCount(pixels: number | undefined, fallback: number, maximum: number): number {
  if (!(pixels && pixels > 0)) return fallback;
  return Math.max(2, Math.min(maximum, Math.round(pixels / TARGET_SPACING_PX)));
}

function sampleAxis(low: number, high: number, count: number): number[] {
  if (!(high > low)) return [];
  const step = (high - low) / count;
  return Array.from({ length: count }, (_, index) => low + (index + 0.5) * step);
}

function visibleSamples(grid: WeatherGrid, view: WindVectorView): Array<[number, number]> {
  const west = Math.max(view.west, grid.lons[0] ?? Number.POSITIVE_INFINITY);
  const east = Math.min(view.east, grid.lons.at(-1) ?? Number.NEGATIVE_INFINITY);
  const south = Math.max(view.south, grid.lats[0] ?? Number.POSITIVE_INFINITY);
  const north = Math.min(view.north, grid.lats.at(-1) ?? Number.NEGATIVE_INFINITY);
  const lons = sampleAxis(west, east, targetCount(view.width, TARGET_COLUMNS, MAX_COLUMNS));
  const lats = sampleAxis(south, north, targetCount(view.height, TARGET_ROWS, MAX_ROWS));
  return lats.flatMap((lat) => lons.map((lon) => [lon, lat] as [number, number]));
}

function barbLength(
  grid: WeatherGrid,
  columnCount: number,
  rowCount: number,
  view?: WindVectorView,
): number {
  const lonSpan = Math.abs(
    (view?.east ?? grid.lons.at(-1) ?? 0) - (view?.west ?? grid.lons[0] ?? 0),
  );
  const latSpan = Math.abs(
    (view?.north ?? grid.lats.at(-1) ?? 0) - (view?.south ?? grid.lats[0] ?? 0),
  );
  // Symbol scale follows the intended screen density, not the number of source cells that happen
  // to be visible. At high zoom a sparse forecast grid may contribute one or two cells; using that
  // count made each barb expand across half the display and left it looking stale after zooming.
  const spacings = [lonSpan / Math.max(1, columnCount), latSpan / Math.max(1, rowCount)].filter(
    (value) => value > 0,
  );
  return (spacings.length > 0 ? Math.min(...spacings) : 0.02) * BARB_FRACTION;
}

// Build conventional wind barbs and point labels. The staff points into the wind, as it does on a
// paper weather chart; each short feather denotes five knots. Geometry, rather than a font glyph,
// keeps the symbol crisp and consistent across devices.
export function windVectorFeatures(
  grid: WeatherGrid,
  bracket: TimeBracket,
  speedUnit: SpeedUnit,
  view?: WindVectorView,
): WindVectorFeatures {
  const u0 = grid.windU[bracket.lo] ?? [];
  const u1 = grid.windU[bracket.hi] ?? u0;
  const v0 = grid.windV[bracket.lo] ?? [];
  const v1 = grid.windV[bracket.hi] ?? v0;
  const gust0 = grid.windGust?.[bracket.lo];
  const gust1 = grid.windGust?.[bracket.hi] ?? gust0;
  const columns = evenIndices(grid.lons.length, TARGET_COLUMNS);
  const rows = evenIndices(grid.lats.length, TARGET_ROWS);
  const samples = view
    ? visibleSamples(grid, view)
    : rows.flatMap((row) =>
        columns.map((column) => [grid.lons[column], grid.lats[row], row, column] as const),
      );
  const columnCount = view ? targetCount(view.width, TARGET_COLUMNS, MAX_COLUMNS) : columns.length;
  const rowCount = view ? targetCount(view.height, TARGET_ROWS, MAX_ROWS) : rows.length;
  const length = barbLength(grid, columnCount, rowCount, view);
  const arrows: GeoJSON.Feature[] = [];
  const markers: GeoJSON.Feature[] = [];

  for (const sample of samples) {
    const [lon, lat] = sample;
    const row = sample[2];
    const column = sample[3];
    const index =
      row === undefined || column === undefined ? undefined : row * grid.lons.length + column;
    const uLo = index === undefined ? bilinearAt(grid, u0, lon, lat) : u0[index];
    const uHi = index === undefined ? bilinearAt(grid, u1, lon, lat) : u1[index];
    const vLo = index === undefined ? bilinearAt(grid, v0, lon, lat) : v0[index];
    const vHi = index === undefined ? bilinearAt(grid, v1, lon, lat) : v1[index];
    if (uLo === undefined || uHi === undefined || vLo === undefined || vHi === undefined) continue;
    const u = lerp(uLo, uHi, bracket.frac);
    const v = lerp(vLo, vHi, bracket.frac);
    const gustLo = gust0
      ? index === undefined
        ? bilinearAt(grid, gust0, lon, lat)
        : gust0[index]
      : undefined;
    const gustHi = gust1
      ? index === undefined
        ? bilinearAt(grid, gust1, lon, lat)
        : gust1[index]
      : undefined;
    const gust =
      gustLo === undefined || gustHi === undefined ? undefined : lerp(gustLo, gustHi, bracket.frac);
    const speed = Math.hypot(u, v);
    if (!(speed >= MIN_SPEED)) continue;
    // u/v point where the wind is going. A meteorological barb staff points where it comes from.
    const east = -u / speed;
    const north = -v / speed;
    const start: GeoJSON.Position = [lon - east * length * 0.5, lat - north * length * 0.5];
    const end: GeoJSON.Position = [lon + east * length * 0.5, lat + north * length * 0.5];
    const featherLength = length * 0.34;
    const feathers = Math.max(0, Math.round((speed * KNOTS_PER_MPS) / 5));
    const coordinates: GeoJSON.Position[][] = [[start, end]];
    for (let feather = 0; feather < feathers; feather += 1) {
      const along = Math.min(0.88, 0.18 + feather * 0.14);
      const shaft: GeoJSON.Position = [
        end[0] - east * length * along,
        end[1] - north * length * along,
      ];
      coordinates.push([
        shaft,
        [shaft[0] - north * featherLength, shaft[1] + east * featherLength],
      ]);
    }
    arrows.push({
      type: 'Feature',
      geometry: { type: 'MultiLineString', coordinates },
      properties: { speed },
    });
    markers.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: {
        label:
          gust === undefined
            ? `${formatSpeedOr(speed, speedUnit, 0)} ${speedUnitLabel(speedUnit)}`
            : `${formatSpeedOr(speed, speedUnit, 0)} | ${formatSpeedOr(gust, speedUnit, 0)} ${speedUnitLabel(speedUnit)}`,
        speed,
        gust,
      },
    });
  }
  return { arrows: featureCollection(arrows), markers: featureCollection(markers) };
}

// Retain the arrow-only helper for focused geometry tests and consumers that do not need labels.
export function windArrowFeatures(
  grid: WeatherGrid,
  bracket: TimeBracket,
): GeoJSON.FeatureCollection {
  return windVectorFeatures(grid, bracket, 'm/s').arrows;
}
