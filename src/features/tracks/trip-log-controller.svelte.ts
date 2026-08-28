import type { PersistedValue, TrackSettings } from '$shared/settings';
import { trackStopDurationMinutes, trackStopSpeedKnots, tripLogEnabled } from '$shared/settings';
import {
  fetchHistoryValuesAcrossProviders,
  type HistoryProviders,
  SK_PATHS,
} from '$shared/signalk';
import { buildTripDay, type TripDay } from './trip-log';

const DAY_SCAN_SECONDS = 366 * 24 * 60 * 60;
const DAY_SCAN_RESOLUTION_SECONDS = 15 * 60;
const DAY_RESOLUTION_SECONDS = 60;

function localDate(ms: number): string {
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateRange(date: string): { from: string; to: string } | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const from = new Date(`${date}T00:00:00`);
  if (!Number.isFinite(from.getTime()) || localDate(from.getTime()) !== date) return undefined;
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from: from.toISOString(), to: new Date(to.getTime() - 1).toISOString() };
}

export type TripLogStatus = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';

interface Deps {
  origin: string;
  getToken: () => string | undefined;
  providers: () => HistoryProviders | undefined;
  settings: PersistedValue<TrackSettings>;
  now?: () => number;
  fetchValues?: typeof fetchHistoryValuesAcrossProviders;
}

export function createTripLogController(deps: Deps) {
  const now = deps.now ?? Date.now;
  const fetchValues = deps.fetchValues ?? fetchHistoryValuesAcrossProviders;
  let day = $state<TripDay | undefined>();
  let selectedDate = $state(localDate(now()));
  let status = $state<TripLogStatus>('idle');
  let version = $state(0);
  let generation = 0;
  let initialized = false;

  async function load(date: string): Promise<TripDay | undefined> {
    const range = dateRange(date);
    const providers = deps.providers();
    if (!range || !providers || providers.ids.length === 0) return undefined;
    const result = await fetchValues(deps.origin, deps.getToken(), providers, {
      paths: [SK_PATHS.position, SK_PATHS.speedOverGround, SK_PATHS.windAngleApparent],
      from: range.from,
      to: range.to,
      resolutionSeconds: DAY_RESOLUTION_SECONDS,
    });
    return result
      ? buildTripDay(
          date,
          result.values,
          trackStopSpeedKnots(deps.settings.value),
          trackStopDurationMinutes(deps.settings.value),
        )
      : undefined;
  }

  async function selectDate(date: string): Promise<void> {
    const request = ++generation;
    selectedDate = date;
    status = 'loading';
    const next = await load(date);
    if (request !== generation) return;
    day = next;
    status = next ? 'ready' : 'error';
    version += 1;
  }

  async function selectLatest(): Promise<void> {
    const request = ++generation;
    const today = localDate(now());
    selectedDate = today;
    status = 'loading';
    const current = await load(today);
    if (request !== generation) return;
    if (current?.hasTravel) {
      day = current;
      status = 'ready';
      version += 1;
      return;
    }
    const providers = deps.providers();
    const threshold = trackStopSpeedKnots(deps.settings.value);
    const scan = providers
      ? await fetchValues(deps.origin, deps.getToken(), providers, {
          paths: [`${SK_PATHS.speedOverGround}:max`],
          durationSeconds: DAY_SCAN_SECONDS,
          resolutionSeconds: DAY_SCAN_RESOLUTION_SECONDS,
        })
      : undefined;
    if (request !== generation) return;
    let latest: string | undefined;
    if (scan) {
      const speedIndex = scan.values.columns.findIndex(
        (column) => column.path === SK_PATHS.speedOverGround,
      );
      const thresholdMps = (threshold * 1852) / 3600;
      for (const row of scan.values.rows) {
        const speed = speedIndex < 0 ? undefined : row[speedIndex + 1];
        const timestamp = Date.parse(row[0]);
        if (typeof speed === 'number' && speed > thresholdMps && Number.isFinite(timestamp)) {
          latest = localDate(timestamp);
        }
      }
    }
    const next = latest && latest !== today ? await load(latest) : current;
    if (request !== generation) return;
    selectedDate = latest ?? today;
    day = next;
    status = next ? 'ready' : current ? 'ready' : 'error';
    version += 1;
  }

  function moveDay(delta: number): void {
    const range = dateRange(selectedDate);
    if (!range) return;
    const date = new Date(range.from);
    date.setDate(date.getDate() + delta);
    const next = localDate(date.getTime());
    if (next <= localDate(now())) void selectDate(next);
  }

  $effect(() => {
    const enabled = tripLogEnabled(deps.settings.value);
    const providers = deps.providers();
    const speed = trackStopSpeedKnots(deps.settings.value);
    const duration = trackStopDurationMinutes(deps.settings.value);
    if (!enabled) {
      generation += 1;
      status = 'idle';
      initialized = false;
      return;
    }
    if (!providers || providers.ids.length === 0) {
      status = 'unavailable';
      return;
    }
    if (!initialized) {
      initialized = true;
      void selectLatest();
      return;
    }
    void speed;
    void duration;
    void selectDate(selectedDate);
  });

  return {
    get day() {
      return day;
    },
    get selectedDate() {
      return selectedDate;
    },
    get status() {
      return status;
    },
    get version() {
      return version;
    },
    get today() {
      return localDate(now());
    },
    selectDate,
    selectLatest,
    previousDay: () => moveDay(-1),
    nextDay: () => moveDay(1),
    refresh: () => selectDate(selectedDate),
    dispose() {
      generation += 1;
    },
  };
}

export type TripLogController = ReturnType<typeof createTripLogController>;
