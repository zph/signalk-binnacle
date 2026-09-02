# Observed Wind Stations: Completion Task

## Outcome

Show live, measured wind observations from weather moorings, buoys, and coastal stations on the Binnacle chart. This is a separate layer from the projected wind field. A navigator can display forecast wind, observed stations, or both.

## Architecture

1. `signalk-weather-stations` runs on Signal K and owns NOAA NDBC acquisition, source health, refreshes, and caching.
2. The plugin exposes a read-only, authenticated endpoint at `/plugins/signalk-weather-stations/stations`.
3. Binnacle fetches the endpoint using its existing authenticated Signal K fetch helper, never directly from NOAA.
4. Binnacle renders the normalized observations as a sibling MapLibre overlay in the weather band.

## Station API Contract

`GET /plugins/signalk-weather-stations/stations` returns:

```json
{
  "provider": "NOAA NDBC",
  "refreshedAt": "2026-09-01T00:00:00.000Z",
  "stations": [
    {
      "id": "46042",
      "name": "Monterey Bay",
      "latitude": 36.785,
      "longitude": -122.396,
      "observedAt": "2026-09-01T00:00:00.000Z",
      "speedMps": 6.2,
      "directionDeg": 315,
      "gustMps": 8.1
    }
  ]
}
```

All values remain SI through storage and transport. `directionDeg` is the meteorological direction the wind comes from. The renderer must rotate the displayed arrow 180 degrees so it points where the wind is going.

## Binnacle Work

- Add `weather-observed-wind` to `WEATHER_LAYER_IDS` and default it off.
- Add `observed-wind-client.ts` with response validation, an authenticated request, timeout, and a short memory cache.
- Add `observed-wind-overlay.ts`:
  - GeoJSON point source, arrow symbol or line, speed label, and station-name label at close zoom.
  - Cluster at distant zoom levels.
  - Use preferred speed units only at the display edge.
  - Fade observations based on `observedAt`; mark data older than two hours stale, and do not present it as live.
  - Preserve source and observed timestamp for the chart feature popup.
  - Degrade quietly when the plugin is unavailable, with a clear actionable unavailable note in Layers and Command K.
- Register the overlay in `build-overlays.ts` and ensure map destroy removes all sources and layers.
- Add a Weather control with three explicit states: `Forecast`, `Observed`, and `Both`. It must map to the two independently persisted layer visibilities.
- Add matching Command K actions for show/hide observed stations and show both wind sources.
- Support desktop click, iPad touch, and phone touch targets, safe areas, clustering, and landscape layouts.

## Signal K Plugin Work

- Persist enabled state and refresh interval through Signal K plugin configuration.
- Verify NOAA NDBC parsing against fixture data and reject malformed coordinates, timestamps, directions, and speeds.
- Cache the last successful response across transient upstream failures, carrying `refreshedAt` and an upstream error state.
- Add optional bounding-box filtering to reduce chart payload size.
- Add status endpoint fields for enabled state, last successful refresh, station count, and upstream error.
- Add unit tests for NDBC parsing, SI conversion, stale-age classification, cache fallback, and endpoint filtering.

## Acceptance Criteria

1. A fresh Binnacle install with the plugin unavailable remains fully usable and explains how to enable observed stations.
2. With the enabled plugin, Binnacle displays live NDBC station arrows at their real positions.
3. A station arrow and label identify measured speed, direction, source, observation time, and stale state.
4. Forecast-only, observed-only, and both modes persist across reloads.
5. Forecast time scrubbing does not present current observations as historical or future observations.
6. The feature works on desktop, iPad portrait and landscape, phone portrait and landscape, day, dusk, and night-red.
7. Plugin unit tests, Binnacle unit tests, browser tests, production builds, and boat-pi deployment health checks pass.
8. Live validation records a nonzero station count from boat-pi and confirms at least one rendered station in Binnacle.

## Validation Record

Current state: plugin package compiles and is installed on boat-pi. Signal K is active, and the plugin configuration is enabled. The authenticated station endpoint and Binnacle renderer still require end-to-end validation before this task is complete.
