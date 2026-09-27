import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { PATH, createAnchorClearancePublisher } = require('./anchor-clearance.cjs') as {
  PATH: string;
  createAnchorClearancePublisher: (app: TestApp) => { start: () => void; stop: () => void };
};

const ANCHOR = { latitude: 0, longitude: 0 };
const METERS_PER_DEGREE = 111_195.08;

function at(east: number, north: number) {
  return { latitude: north / METERS_PER_DEGREE, longitude: east / METERS_PER_DEGREE };
}

interface TestApp {
  error: ReturnType<typeof vi.fn>;
  getSelfPath: (path: string) => unknown;
  handleMessage: ReturnType<typeof vi.fn>;
  subscriptionmanager: {
    subscribe: ReturnType<typeof vi.fn>;
  };
}

function harness() {
  let onDelta: (delta: unknown) => void = () => undefined;
  const unsubscribe = vi.fn();
  const app: TestApp = {
    error: vi.fn(),
    getSelfPath: () => undefined,
    handleMessage: vi.fn(),
    subscriptionmanager: {
      subscribe: vi.fn((_command, unsubscribes: Array<() => void>, _error, callback) => {
        unsubscribes.push(unsubscribe);
        onDelta = callback;
      }),
    },
  };
  const publisher = createAnchorClearancePublisher(app);
  publisher.start();
  function send(values: Record<string, unknown>) {
    onDelta({
      updates: [
        {
          timestamp: new Date().toISOString(),
          values: Object.entries(values).map(([path, value]) => ({ path, value })),
        },
      ],
    });
  }
  function lastValue() {
    const message = app.handleMessage.mock.lastCall?.[1] as {
      updates: Array<{ values: Array<{ path: string; value: number | null }> }>;
    };
    return message.updates[0].values[0];
  }
  return { app, publisher, send, lastValue, unsubscribe };
}

function calculate(vessel: unknown, zone: unknown) {
  const test = harness();
  test.send({
    'navigation.anchor.state': 'on',
    'navigation.anchor.position': ANCHOR,
    'navigation.anchor.watchZone': zone,
    'navigation.position': vessel,
  });
  const value = test.lastValue().value;
  test.publisher.stop();
  return value;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('signed anchor boundary clearance', () => {
  it('reports positive, zero, and negative clearance for a circle', () => {
    const zone = { type: 'circle', radius: 100 };
    expect(calculate(at(40, 0), zone)).toBeCloseTo(60, 1);
    expect(calculate(at(100, 0), zone)).toBeCloseTo(0, 1);
    expect(calculate(at(120, 0), zone)).toBeCloseTo(-20, 1);
  });

  it('measures to the nearest edge of a polygon, including a concave notch', () => {
    const zone = {
      type: 'polygon',
      vertices: [
        { bearing: 315, distance: Math.sqrt(2) * 100 },
        { bearing: 45, distance: Math.sqrt(2) * 100 },
        { bearing: 135, distance: Math.sqrt(2) * 100 },
        { bearing: 180, distance: 20 },
        { bearing: 225, distance: Math.sqrt(2) * 100 },
      ],
    };
    expect(calculate(at(0, 50), zone)).toBeGreaterThan(0);
    expect(calculate(at(0, -70), zone)).toBeLessThan(0);
    expect(calculate(at(0, 105), zone)).toBeCloseTo(-5, 1);
  });

  it('handles a sector crossing north and its radial sides', () => {
    const zone = { type: 'sector', radius: 100, startAngle: 300, endAngle: 60 };
    expect(calculate(at(0, 80), zone)).toBeCloseTo(20, 1);
    expect(calculate(at(0, 120), zone)).toBeCloseTo(-20, 1);
    expect(calculate(at(80, 0), zone)).toBeLessThan(0);
  });

  it('rejects invalid and degenerate geometry', () => {
    expect(calculate(at(0, 0), { type: 'circle', radius: -1 })).toBeNull();
    expect(
      calculate(at(0, 0), {
        type: 'polygon',
        vertices: [
          { bearing: 0, distance: 10 },
          { bearing: 0, distance: 20 },
          { bearing: 0, distance: 30 },
        ],
      }),
    ).toBeNull();
  });
});

describe('Binnacle Signal K anchor clearance publisher', () => {
  it('emits a separate signed metric and never overwrites Hoekens notifications', () => {
    const test = harness();
    test.send({
      'navigation.anchor.state': 'on',
      'navigation.anchor.position': ANCHOR,
      'navigation.anchor.watchZone': { type: 'circle', radius: 100 },
      'navigation.position': at(40, 0),
    });
    expect(test.lastValue().path).toBe(PATH);
    expect(test.lastValue().value).toBeCloseTo(60, 1);
    expect(test.app.handleMessage).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ path: 'notifications.navigation.anchor' }),
    );
    test.send({ 'navigation.anchor.state': 'off' });
    expect(test.lastValue()).toEqual({ path: PATH, value: null });
    test.publisher.stop();
    expect(test.unsubscribe).toHaveBeenCalledOnce();
  });

  it('clears a stale fix rather than publishing false clearance', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-26T12:00:00Z'));
    const test = harness();
    test.send({
      'navigation.anchor.state': 'on',
      'navigation.anchor.position': ANCHOR,
      'navigation.anchor.watchZone': { type: 'circle', radius: 100 },
      'navigation.position': at(20, 0),
    });
    expect(test.lastValue().value).toBeCloseTo(80, 1);
    vi.advanceTimersByTime(31_000);
    expect(test.lastValue().value).toBeNull();
    test.publisher.stop();
  });
});
