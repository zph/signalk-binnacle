import type { TimeBracket, WeatherGrid } from '$entities/weather';
import { formatSpeedOr, lerp, type SpeedUnit, speedUnitLabel } from '$shared/lib';
import { featureCollection } from '$shared/map';

const MIN_SPEED = 0.5;
const TARGET_COLUMNS = 16;
const TARGET_ROWS = 12;
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
}

// Select the centers of evenly sized bins rather than every Nth raw cell. The result stays balanced
// across the padded field and yields about 48 vectors regardless of the provider grid's resolution.
// Roughly a quarter of that padded field is visible, which keeps about a dozen vectors on-screen.
function evenIndices(length: number, target: number): number[] {
  if (length <= target) return Array.from({ length }, (_, index) => index);
  return Array.from({ length: target }, (_, index) =>
    Math.min(length - 1, Math.floor(((index + 0.5) * length) / target)),
  );
}

function visibleIndices(values: number[], low: number, high: number, target: number): number[] {
  const eligible = values
    .map((value, index) => ({ value, index }))
    .filter(({ value }) => value >= low && value <= high);
  const indices =
    eligible.length > 0 ? eligible.map(({ index }) => index) : values.map((_, index) => index);
  return evenIndices(indices.length, target).map((index) => indices[index]!);
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
  const columns = view
    ? visibleIndices(grid.lons, view.west, view.east, TARGET_COLUMNS)
    : evenIndices(grid.lons.length, TARGET_COLUMNS);
  const rows = view
    ? visibleIndices(grid.lats, view.south, view.north, TARGET_ROWS)
    : evenIndices(grid.lats.length, TARGET_ROWS);
  const length = barbLength(grid, columns.length, rows.length, view);
  const arrows: GeoJSON.Feature[] = [];
  const markers: GeoJSON.Feature[] = [];

  for (const row of rows) {
    for (const column of columns) {
      const index = row * grid.lons.length + column;
      const u = lerp(u0[index], u1[index], bracket.frac);
      const v = lerp(v0[index], v1[index], bracket.frac);
      const speed = Math.hypot(u, v);
      if (!(speed >= MIN_SPEED)) continue;
      // u/v point where the wind is going. A meteorological barb staff points where it comes from.
      const east = -u / speed;
      const north = -v / speed;
      const lon = grid.lons[column];
      const lat = grid.lats[row];
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
          label: `${formatSpeedOr(speed, speedUnit, 0)} ${speedUnitLabel(speedUnit)}`,
          speed,
        },
      });
    }
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
