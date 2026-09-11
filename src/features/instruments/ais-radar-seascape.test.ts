import { PbfWriter } from 'pbf';
import { describe, expect, it, vi } from 'vitest';
import {
  AIS_RADAR_LAYOUT_RENDER_DELAY_MS,
  AIS_RADAR_POSITION_MAX_INTERVAL_MS,
  aisRadarPositionRenderMeters,
  buildAisRadarShorelinePlan,
  createAisRadarShorelineController,
  createAisRadarShorelineSource,
  decodeAisRadarWaterTile,
  drawAisRadarShoreline,
} from './ais-radar-seascape';

function signed(value: number): number {
  return value < 0 ? -value * 2 - 1 : value * 2;
}

function waterTile(): ArrayBuffer {
  const writer = new PbfWriter();
  writer.writeMessage(
    3,
    (_layer, layer) => {
      layer.writeStringField(1, 'water');
      layer.writeMessage(
        2,
        (_feature, feature) => {
          feature.writeVarintField(3, 3);
          feature.writePackedVarint(4, [
            9,
            signed(0),
            signed(0),
            26,
            signed(4096),
            signed(0),
            signed(0),
            signed(4096),
            signed(-4096),
            signed(0),
            15,
          ]);
        },
        undefined,
      );
      layer.writeVarintField(5, 4096);
      layer.writeVarintField(15, 2);
    },
    undefined,
  );
  const bytes = writer.finish();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function fakeScheduler() {
  let nextId = 1;
  const callbacks = new Map<number, () => void>();
  const delays: number[] = [];
  return {
    scheduler: {
      request(callback: () => void, delayMs: number) {
        const id = nextId++;
        callbacks.set(id, callback);
        delays.push(delayMs);
        return id;
      },
      cancel(id: number) {
        callbacks.delete(id);
      },
    },
    flush() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback();
    },
    pending: () => callbacks.size,
    delays,
  };
}

describe('AIS radar shoreline', () => {
  it('selects a bounded tile set at a display-appropriate zoom', () => {
    const plan = buildAisRadarShorelinePlan({ latitude: 0, longitude: 0 }, 6, 400, 400);

    expect(plan.refs.length).toBeGreaterThan(0);
    expect(plan.refs.length).toBeLessThanOrEqual(9);
    expect(new Set(plan.refs.map((ref) => ref.z)).size).toBe(1);
    expect(plan.refs[0]?.z).toBeGreaterThanOrEqual(10);
    expect(plan.refs.every((ref) => ref.x >= 0 && ref.x < 2 ** ref.z)).toBe(true);
  });

  it('wraps shoreline requests across the antimeridian', () => {
    const plan = buildAisRadarShorelinePlan({ latitude: 0, longitude: 179.999 }, 24, 440, 440);

    expect(plan.refs.some((ref) => ref.x === 0)).toBe(true);
    expect(plan.refs.every((ref) => ref.x >= 0 && ref.x < 2 ** ref.z)).toBe(true);
  });

  it('decodes only polygon geometry from the water layer', () => {
    const decoded = decodeAisRadarWaterTile(waterTile());

    expect(decoded.extent).toBe(4096);
    expect(decoded.features).toHaveLength(1);
    expect(decoded.features[0]?.[0]).toEqual([
      { x: 0, y: 0 },
      { x: 4096, y: 0 },
      { x: 4096, y: 4096 },
      { x: 0, y: 4096 },
      { x: 0, y: 0 },
    ]);
  });

  it('loads and caches authenticated Chart Locker water tiles', async () => {
    const bytes = waterTile();
    const fetchFn = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(bytes),
    );
    const source = createAisRadarShorelineSource({
      companionBase: 'http://localhost/plugins/signalk-chart-locker',
      getToken: () => 'test-token',
      fetchFn: fetchFn as typeof fetch,
    });
    const plan = buildAisRadarShorelinePlan({ latitude: 0, longitude: 0 }, 6, 180, 180);

    const first = await source.load(() => plan);
    const second = await source.load(() => plan);

    expect(first?.tiles).toHaveLength(plan.refs.length);
    expect(second?.tiles).toHaveLength(plan.refs.length);
    expect(fetchFn).toHaveBeenCalledTimes(plan.refs.length);
    expect(fetchFn.mock.calls[0]?.[1]).toEqual({
      headers: { Authorization: 'Bearer test-token' },
    });
  });

  it('discovers the direct OpenFreeMap tile template without sending Signal K credentials', async () => {
    const bytes = waterTile();
    const fetchFn = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/styles/liberty')) {
        return new Response(
          JSON.stringify({ sources: { openmaptiles: { type: 'vector', url: '/planet' } } }),
        );
      }
      if (url.endsWith('/planet')) {
        return new Response(
          JSON.stringify({ tiles: ['/planet/current/{z}/{x}/{y}.pbf'], maxzoom: 14 }),
        );
      }
      return new Response(bytes);
    });
    const source = createAisRadarShorelineSource({
      getToken: () => 'must-not-leak',
      fetchFn: fetchFn as typeof fetch,
    });
    const plan = buildAisRadarShorelinePlan({ latitude: 0, longitude: 0 }, 6, 180, 180);

    const loaded = await source.load(() => plan);

    expect(loaded?.tiles).toHaveLength(plan.refs.length);
    expect(fetchFn.mock.calls.every((call) => call[1] === undefined || !call[1]?.headers)).toBe(
      true,
    );
  });

  it('coalesces stationary data and resize bursts while preserving real motion', () => {
    let now = 0;
    const frames = fakeScheduler();
    const render = vi.fn();
    const controller = createAisRadarShorelineController(render, {
      now: () => now,
      scheduler: frames.scheduler,
    });
    const initial = {
      position: { latitude: 0, longitude: 0 },
      rangeNm: 6 as const,
      width: 180,
      height: 180,
      theme: 'day' as const,
      companionBase: 'http://localhost/plugin',
    };

    controller.sync(initial);
    for (let index = 0; index < 1_000; index += 1) {
      now += AIS_RADAR_POSITION_MAX_INTERVAL_MS;
      const sign = index % 2 === 0 ? 1 : -1;
      controller.sync({
        ...initial,
        position: { latitude: sign * 0.000_001, longitude: 0 },
      });
    }
    expect(render).toHaveBeenCalledOnce();

    controller.sync({ ...initial, position: { latitude: 0.001, longitude: 0 } });
    expect(render).toHaveBeenCalledTimes(2);

    for (let diameter = 181; diameter <= 440; diameter += 1) {
      controller.sync({ ...initial, width: diameter, height: diameter });
      expect(frames.pending()).toBe(1);
    }
    expect(render).toHaveBeenCalledTimes(2);
    expect(frames.delays.every((delay) => delay === AIS_RADAR_LAYOUT_RENDER_DELAY_MS)).toBe(true);
    frames.flush();
    expect(render).toHaveBeenCalledTimes(3);

    controller.sync({ ...initial, rangeNm: 12, width: 440, height: 440 });
    expect(render).toHaveBeenCalledTimes(4);
    controller.destroy();
    expect(frames.pending()).toBe(0);
  });

  it('draws loaded tile land and water without a WebGL surface', () => {
    const context = {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
    };
    const frame = {
      position: { latitude: 0, longitude: 0 },
      rangeNm: 6 as const,
      width: 180,
      height: 180,
      theme: 'day' as const,
    };
    const plan = buildAisRadarShorelinePlan(frame.position, frame.rangeNm, 180, 180);
    const ref = plan.refs[0];
    if (!ref) throw new Error('Expected a shoreline tile');

    drawAisRadarShoreline(context as never, frame, plan, [
      { ref, water: decodeAisRadarWaterTile(waterTile()) },
    ]);

    expect(context.fillRect).toHaveBeenCalled();
    expect(context.fill).toHaveBeenCalledWith('evenodd');
    expect(context.stroke).toHaveBeenCalled();
  });

  it('scales the position threshold with radar range and layout size', () => {
    expect(aisRadarPositionRenderMeters(6, 180)).toBeCloseTo(61.73, 1);
    expect(aisRadarPositionRenderMeters(6, 440)).toBeCloseTo(25.25, 1);
    expect(aisRadarPositionRenderMeters(0.5, 440)).toBeCloseTo(2.1, 1);
  });
});
