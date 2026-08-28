import type { TimeBracket, WeatherGrid } from '$entities/weather';
import { formatSpeedOr, lerp, type SpeedUnit, speedUnitLabel } from '$shared/lib';
import { featureCollection } from '$shared/map';

const MIN_SPEED = 0.5;
const TARGET_COLUMNS = 8;
const TARGET_ROWS = 6;
const ARROW_FRACTION = 0.3;
const HEAD_FRACTION = 0.3;

export interface WindVectorFeatures {
  arrows: GeoJSON.FeatureCollection;
  markers: GeoJSON.FeatureCollection;
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

function arrowLength(grid: WeatherGrid, columnCount: number, rowCount: number): number {
  const lonSpan = Math.abs((grid.lons.at(-1) ?? 0) - (grid.lons[0] ?? 0));
  const latSpan = Math.abs((grid.lats.at(-1) ?? 0) - (grid.lats[0] ?? 0));
  const spacings = [lonSpan / Math.max(1, columnCount), latSpan / Math.max(1, rowCount)].filter(
    (value) => value > 0,
  );
  return (spacings.length > 0 ? Math.min(...spacings) : 0.02) * ARROW_FRACTION;
}

// Build a sparse set of complete arrow glyphs and point labels. Each MultiLineString contains the
// shaft and two head strokes, so direction does not depend on a font glyph or device icon atlas.
export function windVectorFeatures(
  grid: WeatherGrid,
  bracket: TimeBracket,
  speedUnit: SpeedUnit,
): WindVectorFeatures {
  const u0 = grid.windU[bracket.lo] ?? [];
  const u1 = grid.windU[bracket.hi] ?? u0;
  const v0 = grid.windV[bracket.lo] ?? [];
  const v1 = grid.windV[bracket.hi] ?? v0;
  const columns = evenIndices(grid.lons.length, TARGET_COLUMNS);
  const rows = evenIndices(grid.lats.length, TARGET_ROWS);
  const length = arrowLength(grid, columns.length, rows.length);
  const head = length * HEAD_FRACTION;
  const arrows: GeoJSON.Feature[] = [];
  const markers: GeoJSON.Feature[] = [];

  for (const row of rows) {
    for (const column of columns) {
      const index = row * grid.lons.length + column;
      const u = lerp(u0[index], u1[index], bracket.frac);
      const v = lerp(v0[index], v1[index], bracket.frac);
      const speed = Math.hypot(u, v);
      if (!(speed >= MIN_SPEED)) continue;
      const east = u / speed;
      const north = v / speed;
      const lon = grid.lons[column];
      const lat = grid.lats[row];
      const start: GeoJSON.Position = [lon - east * length * 0.5, lat - north * length * 0.5];
      const end: GeoJSON.Position = [lon + east * length * 0.5, lat + north * length * 0.5];
      const left: GeoJSON.Position = [
        end[0] - east * head - north * head * 0.65,
        end[1] - north * head + east * head * 0.65,
      ];
      const right: GeoJSON.Position = [
        end[0] - east * head + north * head * 0.65,
        end[1] - north * head - east * head * 0.65,
      ];
      arrows.push({
        type: 'Feature',
        geometry: {
          type: 'MultiLineString',
          coordinates: [
            [start, end],
            [end, left],
            [end, right],
          ],
        },
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
