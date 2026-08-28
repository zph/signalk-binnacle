import type { Bbox, WeatherStore } from '$entities/weather';
import type { WeatherSourceId } from '$shared/settings';
import type { WeatherLoader } from './weather-loader';

const FETCH_DEBOUNCE_MS = 400;

interface ChartWindControllerDeps {
  store: WeatherStore;
  loader: WeatherLoader;
  getBounds: () => Bbox | undefined;
  getSource: () => WeatherSourceId;
  isVisible: () => boolean;
}

// Loads only the atmospheric grid required by the primary chart's wind overlay. View changes are
// debounced, and the shared loader handles source-specific caching, stale fallback, and cooldowns.
export function createChartWindController(deps: ChartWindControllerDeps) {
  let destroyed = false;
  let fetchTimer: ReturnType<typeof setTimeout> | undefined;
  let requestedSource = deps.getSource();

  function load(force = false): void {
    if (destroyed || !deps.isVisible()) return;
    const bounds = deps.getBounds();
    if (!bounds) return;
    void deps.loader.load(
      deps.store,
      bounds,
      {
        maxCells: 200,
        forecastDays: 5,
        source: deps.getSource(),
      },
      { waves: false, radar: false },
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
