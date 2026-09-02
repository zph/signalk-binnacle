import type { TimeBracket, WeatherGrid } from '$entities/weather';
import { formatSpeedOr, lerp, lerpAngle, type SpeedUnit, speedUnitLabel } from '$shared/lib';
import { emptyFeatureCollection, featureCollection } from '$shared/map';

const STRIDE = 2;
const ARROW_FRACTION = 0.56;

export interface CurrentVectorFeatures {
  arrows: GeoJSON.FeatureCollection;
  markers: GeoJSON.FeatureCollection;
}

export function currentVectorFeatures(
  grid: WeatherGrid,
  bracket: TimeBracket,
  speedUnit: SpeedUnit,
): CurrentVectorFeatures {
  const directions = grid.oceanCurrentDirection;
  const speeds = grid.oceanCurrentSpeed;
  if (!directions || !speeds) {
    return { arrows: emptyFeatureCollection(), markers: emptyFeatureCollection() };
  }
  const directionLo = directions[bracket.lo] ?? [];
  const directionHi = directions[bracket.hi] ?? directionLo;
  const speedLo = speeds[bracket.lo] ?? [];
  const speedHi = speeds[bracket.hi] ?? speedLo;
  const columns = grid.lons.length;
  const lonStep = columns > 1 ? Math.abs(grid.lons[1] - grid.lons[0]) : 1;
  const latStep = grid.lats.length > 1 ? Math.abs(grid.lats[1] - grid.lats[0]) : 1;
  const length = Math.min(lonStep, latStep) * ARROW_FRACTION;
  const arrows: GeoJSON.Feature[] = [];
  const markers: GeoJSON.Feature[] = [];

  for (let row = 0; row < grid.lats.length; row += STRIDE) {
    for (let column = 0; column < columns; column += STRIDE) {
      const index = row * columns + column;
      const direction = lerpAngle(directionLo[index], directionHi[index], bracket.frac);
      const speed = lerp(speedLo[index], speedHi[index], bracket.frac);
      if (!Number.isFinite(direction) || !Number.isFinite(speed)) continue;
      const lon = grid.lons[column];
      const lat = grid.lats[row];
      const east = Math.sin(direction);
      const north = Math.cos(direction);
      const tip: GeoJSON.Position = [lon + east * length * 0.5, lat + north * length * 0.5];
      const tail: GeoJSON.Position = [lon - east * length * 0.5, lat - north * length * 0.5];
      const head = length * 0.26;
      const left: GeoJSON.Position = [
        tip[0] - east * head - north * head * 0.65,
        tip[1] - north * head + east * head * 0.65,
      ];
      const right: GeoJSON.Position = [
        tip[0] - east * head + north * head * 0.65,
        tip[1] - north * head - east * head * 0.65,
      ];
      arrows.push({
        type: 'Feature',
        geometry: {
          type: 'MultiLineString',
          coordinates: [
            [tail, tip],
            [left, tip],
            [right, tip],
          ],
        },
        properties: { speed },
      });
      markers.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: { label: `${formatSpeedOr(speed, speedUnit, 1)} ${speedUnitLabel(speedUnit)}` },
      });
    }
  }
  return { arrows: featureCollection(arrows), markers: featureCollection(markers) };
}
