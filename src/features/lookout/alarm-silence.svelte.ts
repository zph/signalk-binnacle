import { HOUR_MS, isFiniteNumber, type ReactiveClock } from '$shared/lib';
import { binnacleStorageKey } from '$shared/persistence';
import { createPersistedCodec, PersistedValue, type StorageLike } from '$shared/settings';

export const ALARM_SILENCE_HOURS = [1, 6, 12, 24] as const;
export type AlarmSilenceHours = (typeof ALARM_SILENCE_HOURS)[number];

const MAX_ALARM_SILENCE_MS = 24 * HOUR_MS;

export function createAlarmSilenceController(clock: ReactiveClock, storage?: StorageLike) {
  const until = new PersistedValue<number>(
    binnacleStorageKey('alarmSilencedUntil'),
    0,
    storage,
    createPersistedCodec(
      (value: unknown): value is number =>
        isFiniteNumber(value) && value >= 0 && value <= clock.now + MAX_ALARM_SILENCE_MS,
    ),
  );

  function silenceFor(hours: AlarmSilenceHours): void {
    if (!ALARM_SILENCE_HOURS.includes(hours)) throw new RangeError('Unsupported alarm silence');
    until.set(clock.now + hours * HOUR_MS);
  }

  return {
    silenceFor,
    clear: () => until.set(0),
    get active() {
      return clock.now < until.value;
    },
    get remainingSeconds() {
      return Math.max(0, Math.ceil((until.value - clock.now) / 1000));
    },
    get untilMs() {
      return until.value;
    },
  };
}

export type AlarmSilenceController = ReturnType<typeof createAlarmSilenceController>;
