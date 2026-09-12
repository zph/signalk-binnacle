// Approximate local solar elevation. Pure arithmetic keeps automatic display theming available
// offline. The six-degree threshold is civil twilight, which avoids changing themes immediately at
// geometric sunset or sunrise. The approximation can differ from an almanac by several minutes,
// which is well inside the twilight window and appropriate for a display preference.
const DEG_TO_RAD = Math.PI / 180;

export function isAfterDark(timeMs: number, latitude: number, longitude: number): boolean {
  if (Math.abs(latitude) > 90) return false;

  const day = timeMs / 86_400_000;
  const declination = -0.4091 * Math.cos((2 * Math.PI * (day + 10)) / 365.2422);
  const hourAngle = ((timeMs / 240_000 + longitude - 180) % 360) * DEG_TO_RAD;
  const latitudeRad = latitude * DEG_TO_RAD;
  const sinElevation =
    Math.sin(latitudeRad) * Math.sin(declination) +
    Math.cos(latitudeRad) * Math.cos(declination) * Math.cos(hourAngle);
  return sinElevation < -0.1045;
}
