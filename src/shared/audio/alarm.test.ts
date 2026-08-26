import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlarmTone } from './alarm';

// The node test environment has no window; stub one carrying a counting AudioContext so the
// module-scoped shared context is observable. Each test reloads the module (vi.resetModules) so
// that module state does not leak from one case to the next.

const TONE: AlarmTone = {
  frequency: 700,
  beepMs: 100,
  gapMs: 100,
  beeps: 2,
  periodMs: 1000,
  volume: 0.1,
};

interface AudioGraphStats {
  active: number;
  peak: number;
  created: number;
}

function fakeGain(disconnects: string[], graph: AudioGraphStats) {
  let connected = false;
  return {
    gain: {
      setValueAtTime: () => undefined,
      linearRampToValueAtTime: () => undefined,
    },
    connect: (node: unknown) => {
      if (!connected) {
        connected = true;
        graph.active += 1;
        graph.created += 1;
        graph.peak = Math.max(graph.peak, graph.active);
      }
      return node;
    },
    disconnect: () => {
      disconnects.push('gain');
      if (!connected) return;
      connected = false;
      graph.active -= 1;
    },
  };
}

function fakeOscillator(starts: number[], disconnects: string[], autoEnd: boolean) {
  const oscillator = {
    type: '',
    frequency: { value: 0 },
    onended: undefined as (() => void) | undefined,
    connect: (node: unknown) => node,
    disconnect: () => disconnects.push('oscillator'),
    start: (when: number) => {
      starts.push(when);
    },
    stop: (when?: number) => {
      if (autoEnd && when !== undefined) {
        setTimeout(() => oscillator.onended?.(), Math.max(0, when * 1000));
      }
    },
  };
  return oscillator;
}

function createAudioStub({ resumeRejects = false, autoEnd = false } = {}) {
  const contexts: FakeAudioContext[] = [];
  // Every beep's scheduled start time, so a test can count what a burst actually queued.
  const starts: number[] = [];
  const disconnects: string[] = [];
  const graph: AudioGraphStats = { active: 0, peak: 0, created: 0 };
  const oscillators: ReturnType<typeof fakeOscillator>[] = [];
  // Mutable so a test can grant the gesture partway through, the way a returning navigator does.
  const gesture = { refused: resumeRejects };
  class FakeAudioContext {
    state: AudioContextState = 'suspended';
    currentTime = 0;
    destination = {};
    constructor() {
      contexts.push(this);
    }
    resume(): Promise<void> {
      if (gesture.refused) return Promise.reject(new Error('gesture required'));
      this.state = 'running';
      return Promise.resolve();
    }
    createOscillator() {
      const oscillator = fakeOscillator(starts, disconnects, autoEnd);
      oscillators.push(oscillator);
      return oscillator;
    }
    createGain() {
      return fakeGain(disconnects, graph);
    }
  }
  return {
    contexts,
    starts,
    disconnects,
    oscillators,
    graph,
    gesture,
    AudioContext: FakeAudioContext,
  };
}

async function loadAudio(audio?: { AudioContext: unknown }) {
  vi.stubGlobal('window', audio ?? {});
  vi.resetModules();
  return await import('./alarm');
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('shared alarm audio context', () => {
  it('creates one audio context for every Alarm', async () => {
    const stub = createAudioStub();
    const { Alarm } = await loadAudio(stub);
    const first = new Alarm();
    const second = new Alarm();
    first.start(TONE);
    second.start(TONE);
    expect(stub.contexts).toHaveLength(1);
    first.stop();
    second.stop();
  });

  it('shares the primed context with an Alarm constructed later', async () => {
    const stub = createAudioStub();
    const { Alarm, primeAlarmAudio } = await loadAudio(stub);
    primeAlarmAudio();
    const alarm = new Alarm();
    alarm.start(TONE);
    expect(stub.contexts).toHaveLength(1);
    alarm.stop();
  });

  it('reports primed only once the shared context is running', async () => {
    const stub = createAudioStub();
    const { alarmAudioPrimed, primeAlarmAudio } = await loadAudio(stub);
    expect(alarmAudioPrimed()).toBe(false);
    // Asking must never build a context of its own, or the gesture-driven prime would resume one
    // context while the alarms sound through another.
    expect(stub.contexts).toHaveLength(0);
    primeAlarmAudio();
    expect(alarmAudioPrimed()).toBe(true);
  });

  it('stays unprimed when the context refuses to resume', async () => {
    const stub = createAudioStub({ resumeRejects: true });
    const { alarmAudioPrimed, primeAlarmAudio } = await loadAudio(stub);
    primeAlarmAudio();
    expect(stub.contexts).toHaveLength(1);
    expect(alarmAudioPrimed()).toBe(false);
  });

  it('schedules nothing while the context is suspended, so a resume cannot fire a pile-up', async () => {
    vi.useFakeTimers();
    const stub = createAudioStub({ resumeRejects: true });
    const { Alarm } = await loadAudio(stub);
    const alarm = new Alarm();

    alarm.start(TONE);
    vi.advanceTimersByTime(TONE.periodMs * 6);
    // A suspended context freezes currentTime, so every skipped burst would have queued its beeps
    // at the same instant and blasted them together on the next gesture.
    expect(stub.starts).toEqual([]);

    stub.gesture.refused = false;
    vi.advanceTimersByTime(TONE.periodMs);

    // One burst's worth of beeps, at the burst spacing, not seven bursts stacked on one timestamp.
    expect(stub.starts).toEqual([0, (TONE.beepMs + TONE.gapMs) / 1000]);
    alarm.stop();
  });

  it('disconnects every completed or canceled beep from the shared destination', async () => {
    const stub = createAudioStub();
    const { Alarm, primeAlarmAudio } = await loadAudio(stub);
    primeAlarmAudio();
    const alarm = new Alarm();

    alarm.start(TONE);
    expect(stub.oscillators).toHaveLength(TONE.beeps);
    stub.oscillators[0]?.onended?.();
    expect(stub.disconnects).toEqual(['oscillator', 'gain']);

    alarm.stop();
    expect(stub.disconnects.filter((kind) => kind === 'oscillator')).toHaveLength(TONE.beeps);
    expect(stub.disconnects.filter((kind) => kind === 'gain')).toHaveLength(TONE.beeps);
  });

  it('keeps the connected audio graph bounded through a virtual day of alarm bursts', async () => {
    vi.useFakeTimers();
    const stub = createAudioStub({ autoEnd: true });
    const { Alarm, primeAlarmAudio } = await loadAudio(stub);
    primeAlarmAudio();
    const alarm = new Alarm();
    alarm.start(TONE);

    // Advance in half-hour chunks so the fake-timer safety limit never mistakes the intentional
    // day-long soak for a runaway zero-delay loop.
    for (let halfHour = 0; halfHour < 48; halfHour += 1) {
      vi.advanceTimersByTime(30 * 60 * 1000);
      expect(stub.graph.active).toBeLessThanOrEqual(TONE.beeps);
    }

    expect(stub.graph.created).toBeGreaterThan(100_000);
    expect(stub.graph.peak).toBeLessThanOrEqual(TONE.beeps);
    alarm.stop();
    expect(stub.graph.active).toBe(0);
  });

  it('stays quiet and unprimed without Web Audio', async () => {
    const { alarmAudioPrimed, primeAlarmAudio } = await loadAudio();
    expect(() => primeAlarmAudio()).not.toThrow();
    expect(alarmAudioPrimed()).toBe(false);
  });
});
