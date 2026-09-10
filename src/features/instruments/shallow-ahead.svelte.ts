import type { OwnVessel } from '$entities/vessel';
import type { ReactiveClock } from '$shared/lib';
import type { SignalKStore } from '$shared/signalk';
import { SK_PATHS } from '$shared/signalk';
import {
  draftFromSignalKValues,
  type SeascapeTileSource,
  SHALLOW_AHEAD_LOOKAHEAD_SECONDS,
  SHALLOW_AHEAD_MAX_DISTANCE_M,
  SHALLOW_AHEAD_MIN_SPEED_MPS,
} from './shallow-ahead-model';

const REFRESH_MS = 30_000;

export type ShallowAheadState =
  | 'inactive'
  | 'loading'
  | 'hazard'
  | 'none-found'
  | 'coverage-gap'
  | 'unavailable';

export interface ShallowAheadReading {
  state: ShallowAheadState;
  message: string;
  draftM?: number;
  thresholdM?: number;
  lookaheadDistanceM?: number;
  distanceM?: number;
  tcpaSeconds?: number;
  depthM?: number;
  coverageFraction?: number;
  updatedAtMs?: number;
}

export interface ShallowAheadMonitor {
  readonly reading: ShallowAheadReading;
  dispose(): void;
}

export function createShallowAheadMonitor(deps: {
  vessel: OwnVessel;
  store: SignalKStore;
  clock: ReactiveClock;
  active: () => boolean;
  source: () => SeascapeTileSource;
}): ShallowAheadMonitor {
  let reading = $state.raw<ShallowAheadReading>({
    state: 'inactive',
    message: 'Instrument is not active.',
  });
  let abort: AbortController | undefined;
  let generation = 0;
  let lastRequestKey = '';

  const stop = $effect.root(() => {
    $effect(() => {
      const active = deps.active();
      const now = deps.clock.now;
      const position = deps.vessel.position;
      const courseRad = deps.vessel.cogRad;
      const speedMps = deps.vessel.sogMps;
      const draftM = draftFromSignalKValues([
        deps.store.cell(SK_PATHS.draftCurrent).value,
        deps.store.cell(SK_PATHS.draftMaximum).value,
        deps.store.cell(SK_PATHS.draftMinimum).value,
      ]);
      const source = deps.source();

      if (!active) {
        abort?.abort();
        abort = undefined;
        lastRequestKey = '';
        reading = { state: 'inactive', message: 'Instrument is not active.' };
        return;
      }
      if (draftM === undefined) {
        setUnavailable('Set vessel draft in Signal K to calculate the shallow-water threshold.');
        return;
      }
      const thresholdM = draftM * 2;
      if (
        !position ||
        courseRad === undefined ||
        speedMps === undefined ||
        deps.vessel.positionStale ||
        deps.vessel.cogStale ||
        deps.vessel.sogStale
      ) {
        setUnavailable('Fresh position, course, and speed are required.');
        return;
      }
      if (speedMps < SHALLOW_AHEAD_MIN_SPEED_MPS) {
        setUnavailable('Speed is too low to project a reliable course ahead.');
        return;
      }

      const lookaheadDistanceM = Math.min(
        SHALLOW_AHEAD_MAX_DISTANCE_M,
        speedMps * SHALLOW_AHEAD_LOOKAHEAD_SECONDS,
      );
      const requestKey = `${Math.floor(now / REFRESH_MS)}:${source.template}:${source.proxied}`;
      if (requestKey === lastRequestKey) return;
      lastRequestKey = requestKey;
      const requestGeneration = ++generation;
      abort?.abort();
      abort = new AbortController();
      const signal = abort.signal;
      reading = {
        state: 'loading',
        message: 'Checking Seascape depth ahead.',
        draftM,
        thresholdM,
        lookaheadDistanceM,
      };

      void import('./shallow-ahead')
        .then(({ createSeascapeTileLoader, scanSeascapeAhead }) =>
          scanSeascapeAhead(
            { position, courseRad, distanceM: lookaheadDistanceM, thresholdM, signal },
            createSeascapeTileLoader(source),
          ),
        )
        .then(
          (profile) => {
            if (signal.aborted || requestGeneration !== generation) return;
            const common = {
              draftM,
              thresholdM,
              lookaheadDistanceM,
              coverageFraction: profile.coverageFraction,
              updatedAtMs: deps.clock.now,
            };
            if (profile.hazard) {
              reading = {
                state: 'hazard',
                message: 'Seascape shows water shallower than twice the vessel draft ahead.',
                ...common,
                distanceM: profile.hazard.distanceM,
                tcpaSeconds: profile.hazard.distanceM / speedMps,
                depthM: profile.hazard.depthM,
              };
            } else if (!profile.coverageComplete) {
              reading = {
                state: 'coverage-gap',
                message: 'Seascape coverage is incomplete along the projected course.',
                ...common,
              };
            } else {
              reading = {
                state: 'none-found',
                message: 'No depth below twice the vessel draft was found in the scanned profile.',
                ...common,
              };
            }
          },
          (error: unknown) => {
            if (signal.aborted || requestGeneration !== generation) return;
            reading = {
              state: 'unavailable',
              message:
                error instanceof Error && error.message
                  ? `Seascape lookup unavailable: ${error.message}`
                  : 'Seascape lookup unavailable.',
              draftM,
              thresholdM,
              lookaheadDistanceM,
            };
          },
        );
    });
  });

  function setUnavailable(message: string): void {
    abort?.abort();
    abort = undefined;
    lastRequestKey = '';
    reading = { state: 'unavailable', message };
  }

  return {
    get reading() {
      return reading;
    },
    dispose() {
      generation += 1;
      abort?.abort();
      stop();
    },
  };
}
