import { describe, expect, it } from 'vitest';
import type { StorageLike } from '$shared/settings';
import { createAlarmSilenceController } from './alarm-silence.svelte';

function memoryStorage(initial?: string): StorageLike & { value: string | null } {
  return {
    value: initial ?? null,
    getItem() {
      return this.value;
    },
    setItem(_key, value) {
      this.value = value;
    },
  };
}

describe('alarm silence', () => {
  it.each([1, 6, 12, 24] as const)('silences all audio for %s hours', (hours) => {
    const clock = { now: 1_000_000 };
    const silence = createAlarmSilenceController(clock, memoryStorage());
    silence.silenceFor(hours);
    expect(silence.active).toBe(true);
    expect(silence.remainingSeconds).toBe(hours * 60 * 60);
  });

  it('expires against the reactive clock and can be cleared early', () => {
    const clock = { now: 1_000_000 };
    const silence = createAlarmSilenceController(clock, memoryStorage());
    silence.silenceFor(1);
    clock.now += 3_600_000;
    expect(silence.active).toBe(false);
    expect(silence.remainingSeconds).toBe(0);
    silence.silenceFor(6);
    silence.clear();
    expect(silence.active).toBe(false);
  });

  it('survives reload but rejects a stored silence beyond 24 hours', () => {
    const clock = { now: 1_000_000 };
    const storage = memoryStorage();
    const first = createAlarmSilenceController(clock, storage);
    first.silenceFor(12);
    expect(createAlarmSilenceController(clock, storage).remainingSeconds).toBe(12 * 60 * 60);

    const unsafe = memoryStorage(JSON.stringify(clock.now + 25 * 60 * 60 * 1000));
    expect(createAlarmSilenceController(clock, unsafe).active).toBe(false);
    expect(unsafe.value).toBe('0');
  });
});
