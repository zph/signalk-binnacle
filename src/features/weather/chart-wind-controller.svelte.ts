import { type Bbox, bboxContains, type WeatherStore } from '$entities/weather';
import type { WeatherSourceId } from '$shared/settings';
import type { WeatherLoader } from './weather-loader';

const FETCH_DEBOUNCE_MS = 400;
const VIEWPORT_PADDING = 0.5;
const MAX_WIND_CELLS = 120;
const VIEWPORT_REUSE_MS = 45 * 60 * 1000;

// Fetch beyond the visible bounds so ordinary nearby pans remain inside the loaded field and redraw
// immediately. A large relocation still replaces the grid after moveend, but requests only the two
// chart atmospheric variables rather than the full weather payload.
export function paddedWindBounds(bounds: Bbox): Bbox {
  const lonPadding = Math.max(0.05, (bounds.east - bounds.west) * VIEWPORT_PADDING);
  const latPadding = Math.max(0.05, (bounds.north - bounds.south) * VIEWPORT_PADDING);
  return {
    west: bounds.west - lonPadding,
    south: Math.max(-90, bounds.south - latPadding),
    east: bounds.east + lonPadding,
    north: Math.min(90, bounds.north + latPadding),
  };
}

interface ChartWindControllerDeps {
  store: WeatherStore;
  loader: WeatherLoader;
  getBounds: () => Bbox | undefined;
  getSource: () => WeatherSourceId;
  isVisible: () => boolean;
  wantsMarine: () => boolean;
}

// Loads the compact atmospheric grid required by the primary chart forecast overlays and adds the
// marine grid only for Conditions and ocean currents. View changes are debounced, and the shared loader handles
// source-specific caching, stale fallback, and cooldowns.
export function createChartWindController(deps: ChartWindControllerDeps) {
  let destroyed = false;
  let fetchTimer: ReturnType<typeof setTimeout> | undefined;
  let requestedSource = deps.getSource();

  function currentGridCovers(bounds: Bbox, source: WeatherSourceId): boolean {
    const grid = deps.store.grid;
    const fetchedAt = grid?.fetchedAt;
    if (
      !grid ||
      grid.forecastSource !== source ||
      fetchedAt === undefined ||
      Date.now() - fetchedAt >= VIEWPORT_REUSE_MS
    ) {
      return false;
    }
    // A fresh wind-only grid covers the same geography but not the data Conditions and ocean
    // currents need. Force the marine cache key when the user switches modes. A partialWaves grid
    // records an attempted marine fetch and remains eligible until Retry or normal expiry, avoiding
    // an automatic retry loop during a provider outage.
    if (
      deps.wantsMarine() &&
      !grid.marineSource &&
      !grid.partialWaves &&
      !grid.waveHeight &&
      !grid.oceanCurrentSpeed
    ) {
      return false;
    }
    const west = grid.lons[0];
    const east = grid.lons.at(-1);
    const south = grid.lats[0];
    const north = grid.lats.at(-1);
    if ([west, east, south, north].some((value) => !Number.isFinite(value))) return false;
    return bboxContains(
      {
        west: west as number,
        south: south as number,
        east: east as number,
        north: north as number,
      },
      bounds,
    );
  }

  function load(force = false): void {
    if (destroyed || !deps.isVisible()) return;
    const currentBounds = deps.getBounds();
    const source = deps.getSource();
    if (!force && currentBounds && currentGridCovers(currentBounds, source)) return;
    const bounds = currentBounds ? paddedWindBounds(currentBounds) : undefined;
    if (!bounds) return;
    void deps.loader.load(
      deps.store,
      bounds,
      {
        maxCells: MAX_WIND_CELLS,
        forecastDays: 10,
        source,
        atmosphericFields: 'chart',
      },
      { waves: deps.wantsMarine(), radar: false },
      force,
    );
  }

  function schedule(force = false): void {
    if (destroyed || !deps.isVisible()) return;
    if (fetchTimer) clearTimeout(fetchTimer);
    fetchTimer = setTimeout(() => {
      fetchTimer = undefined;
      load(force);
    }, FETCH_DEBOUNCE_MS);
  }

  function visibilityChanged(visible: boolean): void {
    if (visible) schedule();
    else if (fetchTimer) {
      clearTimeout(fetchTimer);
      fetchTimer = undefined;
    }
  }

  function sourceChanged(source: WeatherSourceId): void {
    if (source === requestedSource) return;
    requestedSource = source;
    schedule();
  }

  function destroy(): void {
    destroyed = true;
    if (fetchTimer) clearTimeout(fetchTimer);
    fetchTimer = undefined;
  }

  return { destroy, load, schedule, sourceChanged, visibilityChanged };
}
