import type { CurrentEvent, CurrentReading } from '$entities/tides';
import type { TimeBracket, WeatherGrid } from '$entities/weather';
import { formatSpeedOr, lerp, lerpAngle, type SpeedUnit, speedUnitLabel } from '$shared/lib';
import { emptyFeatureCollection, featureCollection } from '$shared/map';

const STRIDE = 1;

export interface CurrentVectorFeatures {
  arrows: GeoJSON.FeatureCollection;
  markers: GeoJSON.FeatureCollection;
}

function currentAt(events: CurrentEvent[], timeMs: number): CurrentEvent | undefined {
  if (events.length === 0) return undefined;
  if (timeMs <= events[0].timeMs) return events[0];
  for (let index = 1; index < events.length; index += 1) {
    const before = events[index - 1];
    const after = events[index];
    if (timeMs > after.timeMs) continue;
    const fraction = (timeMs - before.timeMs) / (after.timeMs - before.timeMs || 1);
    const beforeDirection = before.directionRad ?? after.directionRad;
    const afterDirection = after.directionRad ?? before.directionRad;
    const kind =
      fraction >= 1
        ? after.kind
        : before.kind === 'slack'
          ? after.kind
          : after.kind === 'slack'
            ? before.kind
            : fraction < 0.5
              ? before.kind
              : after.kind;
    return {
      timeMs,
      velocityMps: lerp(before.velocityMps, after.velocityMps, fraction),
      directionRad:
        beforeDirection === undefined || afterDirection === undefined
          ? undefined
          : lerpAngle(beforeDirection, afterDirection, fraction),
      kind,
    };
  }
  return events.at(-1);
}

export function noaaCurrentVectorFeatures(
  reading: CurrentReading | undefined,
  timeMs: number,
  speedUnit: SpeedUnit,
): CurrentVectorFeatures {
  const prediction = reading ? currentAt(reading.events, timeMs) : undefined;
  if (!reading || !prediction || prediction.directionRad === undefined) {
    return { arrows: emptyFeatureCollection(), markers: emptyFeatureCollection() };
  }
  const coordinates: GeoJSON.Position = [reading.station.longitude, reading.station.latitude];
  const properties = {
    bearing: (prediction.directionRad * 180) / Math.PI,
    speed: prediction.velocityMps,
    station: reading.station.name,
    phase: prediction.kind,
  };
  const phaseLabel =
    prediction.kind === 'flood' ? 'Flood' : prediction.kind === 'ebb' ? 'Ebb' : 'Slack';
  return {
    arrows: featureCollection([
      { type: 'Feature', geometry: { type: 'Point', coordinates }, properties },
    ]),
    markers: featureCollection([
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates },
        properties: {
          ...properties,
          label: `${phaseLabel} · ${formatSpeedOr(prediction.velocityMps, speedUnit, 1)} ${speedUnitLabel(speedUnit)}\n${reading.station.name}`,
        },
      },
    ]),
  };
}

export function currentVectorFeatures(
  grid: WeatherGrid,
  bracket: TimeBracket,
  speedUnit: SpeedUnit,
  includeLabels = true,
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
      arrows.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: { speed, bearing: (direction * 180) / Math.PI, phase: 'modeled' },
      });
      if (includeLabels) {
        markers.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lon, lat] },
          properties: {
            label: `${formatSpeedOr(speed, speedUnit, 1)} ${speedUnitLabel(speedUnit)}`,
          },
        });
      }
    }
  }
  return { arrows: featureCollection(arrows), markers: featureCollection(markers) };
}
