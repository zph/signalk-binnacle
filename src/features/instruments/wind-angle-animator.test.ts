import { describe, expect, it, vi } from 'vitest';
import {
  createWindAngleAnimator,
  WIND_ANGLE_MAX_DURATION_MS,
  WIND_ANGLE_MIN_DURATION_MS,
} from '$shared/nav';

const DEG = Math.PI / 180;

function createScheduler() {
  let nowMs = 0;
  let nextId = 1;
  const callbacks = new Map<number, (nowMs: number) => void>();
  return {
    scheduler: {
      now: () => nowMs,
      request(callback: (frameNowMs: number) => void) {
        const id = nextId++;
        callbacks.set(id, callback);
        return id;
      },
      cancel(id: number) {
        callbacks.delete(id);
      },
    },
    advance(frameNowMs: number) {
      nowMs = frameNowMs;
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback(nowMs);
    },
    pending: () => callbacks.size,
  };
}

describe('wind angle animator', () => {
  it('shows the first sample immediately, then interpolates over the sample cadence', () => {
    const frames = createScheduler();
    const onChange = vi.fn();
    const animator = createWindAngleAnimator(onChange, { scheduler: frames.scheduler });

    animator.push(10 * DEG, 1_000);
    animator.push(30 * DEG, 2_000);
    expect(onChange).toHaveBeenLastCalledWith(10 * DEG);

    frames.advance(500);
    expect(onChange.mock.lastCall?.[0]).toBeCloseTo(20 * DEG, 12);
    frames.advance(1_000);
    expect(onChange.mock.lastCall?.[0]).toBeCloseTo(30 * DEG, 12);
    expect(frames.pending()).toBe(0);
  });

  it('damps sub-degree vane chatter but accepts accumulated movement', () => {
    const frames = createScheduler();
    const onChange = vi.fn();
    const animator = createWindAngleAnimator(onChange, { scheduler: frames.scheduler });

    animator.push(10 * DEG, 1_000);
    animator.push(10.8 * DEG, 2_000);
    expect(frames.pending()).toBe(0);

    animator.push(11.2 * DEG, 3_000);
    expect(frames.pending()).toBe(1);
  });

  it('crosses the angular seam through the shortest arc', () => {
    const frames = createScheduler();
    const seen: number[] = [];
    const animator = createWindAngleAnimator(
      (angle) => {
        if (angle !== undefined) seen.push(angle / DEG);
      },
      { scheduler: frames.scheduler },
    );

    animator.push(179 * DEG, 1_000);
    animator.push(-179 * DEG, 2_000);
    frames.advance(500);

    expect(seen.at(-1)).toBeCloseTo(180, 6);
  });

  it('bounds animation duration for unusually fast and slow samples', () => {
    const fastFrames = createScheduler();
    const fast = vi.fn();
    const fastAnimator = createWindAngleAnimator(fast, { scheduler: fastFrames.scheduler });
    fastAnimator.push(0, 1_000);
    fastAnimator.push(20 * DEG, 1_010);
    fastFrames.advance(WIND_ANGLE_MIN_DURATION_MS / 2);
    expect((fast.mock.lastCall?.[0] as number) / DEG).toBeCloseTo(10, 6);

    const slowFrames = createScheduler();
    const slow = vi.fn();
    const slowAnimator = createWindAngleAnimator(slow, { scheduler: slowFrames.scheduler });
    slowAnimator.push(0, 1_000);
    slowAnimator.push(20 * DEG, 11_000);
    slowFrames.advance(WIND_ANGLE_MAX_DURATION_MS / 2);
    expect((slow.mock.lastCall?.[0] as number) / DEG).toBeCloseTo(10, 6);
  });

  it('updates immediately for reduced motion and replay clock reversal', () => {
    const frames = createScheduler();
    const reduced = vi.fn();
    const reducedAnimator = createWindAngleAnimator(reduced, {
      scheduler: frames.scheduler,
      reducedMotion: () => true,
    });
    reducedAnimator.push(0, 1_000);
    reducedAnimator.push(20 * DEG, 2_000);
    expect(reduced).toHaveBeenLastCalledWith(20 * DEG);
    expect(frames.pending()).toBe(0);

    const replay = vi.fn();
    const replayAnimator = createWindAngleAnimator(replay, { scheduler: frames.scheduler });
    replayAnimator.push(0, 2_000);
    replayAnimator.push(-30 * DEG, 1_000);
    expect(replay).toHaveBeenLastCalledWith(-30 * DEG);
    expect(frames.pending()).toBe(0);
  });

  it('cancels scheduled work when destroyed', () => {
    const frames = createScheduler();
    const animator = createWindAngleAnimator(vi.fn(), { scheduler: frames.scheduler });
    animator.push(0, 1_000);
    animator.push(20 * DEG, 2_000);
    animator.destroy();

    expect(frames.pending()).toBe(0);
  });
});
