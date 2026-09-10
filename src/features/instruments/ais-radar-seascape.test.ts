import { describe, expect, it, vi } from 'vitest';
import { mapThemePaint } from '$shared/map';
import {
  AIS_RADAR_LAYOUT_REFIT_DELAY_MS,
  AIS_RADAR_MAP_PADDING_PX,
  AIS_RADAR_POSITION_MAX_INTERVAL_MS,
  aisRadarBounds,
  aisRadarPositionRenderMeters,
  aisRadarSeascapeStyle,
  applyAisRadarSeascape,
  createAisRadarCameraController,
  fitAisRadarSeascape,
} from './ais-radar-seascape';

function fakeMap() {
  return {
    getStyle: () => ({
      layers: [
        { id: 'background', type: 'background' },
        { id: 'water', type: 'fill', 'source-layer': 'water' },
        { id: '__z__basemap', type: 'background' },
        { id: 'coast', type: 'line', 'source-layer': 'water' },
        { id: 'water-name', type: 'symbol', 'source-layer': 'water_name' },
        { id: 'river', type: 'line', 'source-layer': 'waterway' },
        { id: 'road', type: 'line', 'source-layer': 'transportation' },
        { id: 'building', type: 'fill', 'source-layer': 'building' },
        { id: 'relief', type: 'raster' },
      ],
    }),
    setLayoutProperty: vi.fn(),
    setPaintProperty: vi.fn(),
    setBearing: vi.fn(),
    setPitch: vi.fn(),
    setCenter: vi.fn(),
    fitBounds: vi.fn(),
  };
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

describe('AIS radar seascape', () => {
  it('builds a minimal Chart Locker style with only background and water', () => {
    const style = aisRadarSeascapeStyle('http://boat.local/plugins/signalk-chart-locker/', 'day');

    expect(style?.layers.map((layer) => layer.id)).toEqual(['background', 'water']);
    expect(style?.sources).toEqual({
      openmaptiles: {
        type: 'vector',
        tiles: [
          'http://boat.local/plugins/signalk-chart-locker/style/basemap/tiles/openmaptiles/{z}/{x}/{y}',
        ],
      },
    });
    expect(aisRadarSeascapeStyle(undefined, 'day')).toBeUndefined();
  });

  it('keeps only flat land, water, and the water boundary', () => {
    const map = fakeMap();
    applyAisRadarSeascape(map as never, 'day');
    const paint = mapThemePaint('day');

    expect(map.setLayoutProperty).toHaveBeenCalledWith('background', 'visibility', 'visible');
    expect(map.setLayoutProperty).toHaveBeenCalledWith('water', 'visibility', 'visible');
    expect(map.setLayoutProperty).toHaveBeenCalledWith('__z__basemap', 'visibility', 'none');
    expect(map.setLayoutProperty).toHaveBeenCalledWith('coast', 'visibility', 'visible');
    for (const id of ['water-name', 'river', 'road', 'building', 'relief']) {
      expect(map.setLayoutProperty).toHaveBeenCalledWith(id, 'visibility', 'none');
    }
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'background',
      'background-color',
      paint.background,
    );
    expect(map.setPaintProperty).toHaveBeenCalledWith('water', 'fill-color', paint.water);
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'water',
      'fill-outline-color',
      paint.boundary,
    );
    expect(map.setPaintProperty).toHaveBeenCalledWith('coast', 'line-color', paint.boundary);
  });

  it('uses a water-colored background when only the offline fallback style exists', () => {
    const map = fakeMap();
    map.getStyle = () => ({ layers: [{ id: 'background', type: 'background' }] });

    applyAisRadarSeascape(map as never, 'night-red');

    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'background',
      'background-color',
      mapThemePaint('night-red').water,
    );
  });

  it('fits the selected range north-up around the boat', () => {
    const map = fakeMap();
    const position = { latitude: 38.04, longitude: -122.19 };

    fitAisRadarSeascape(map as never, position, 6);

    expect(map.setBearing).toHaveBeenCalledWith(0);
    expect(map.setPitch).toHaveBeenCalledWith(0);
    expect(map.fitBounds).toHaveBeenCalledWith(aisRadarBounds(position, 6), {
      padding: AIS_RADAR_MAP_PADDING_PX,
      duration: 0,
    });
    const [[west, south], [east, north]] = aisRadarBounds(position, 6);
    expect(west).toBeLessThan(position.longitude);
    expect(east).toBeGreaterThan(position.longitude);
    expect(south).toBeLessThan(position.latitude);
    expect(north).toBeGreaterThan(position.latitude);
  });

  it('unwraps an antimeridian-crossing range for MapLibre', () => {
    const [[west], [east]] = aisRadarBounds({ latitude: 0, longitude: 179.99 }, 24);
    expect(east).toBeGreaterThan(west);
    expect(east).toBeGreaterThan(180);
  });

  it('uses the displayed layout and range to gate passive coastline movement', () => {
    expect(aisRadarPositionRenderMeters(6, 180)).toBeCloseTo(61.73, 1);
    expect(aisRadarPositionRenderMeters(6, 440)).toBeCloseTo(25.25, 1);
    expect(aisRadarPositionRenderMeters(0.5, 440)).toBeCloseTo(2.1, 1);
  });

  it('centers cheaply for real motion without refitting stationary sensor jitter', () => {
    let now = 0;
    const map = fakeMap();
    const controller = createAisRadarCameraController(map as never, { now: () => now });
    const position = { latitude: 38, longitude: -122 };

    controller.sync(position, 6, 180);
    expect(map.fitBounds).toHaveBeenCalledOnce();
    for (let index = 0; index < 1_000; index += 1) {
      now += AIS_RADAR_POSITION_MAX_INTERVAL_MS;
      const sign = index % 2 === 0 ? 1 : -1;
      controller.sync(
        {
          latitude: position.latitude + sign * 0.000_001,
          longitude: position.longitude,
        },
        6,
        180,
      );
    }
    expect(map.setCenter).not.toHaveBeenCalled();
    expect(map.fitBounds).toHaveBeenCalledOnce();

    controller.sync(
      { latitude: position.latitude + 0.000_01, longitude: position.longitude },
      6,
      180,
    );
    expect(map.setCenter).toHaveBeenCalledExactlyOnceWith([-122, 38.000_01]);
    expect(map.fitBounds).toHaveBeenCalledOnce();

    controller.sync({ latitude: position.latitude + 0.001, longitude: position.longitude }, 6, 180);
    expect(map.setCenter).toHaveBeenCalledTimes(2);
    expect(map.fitBounds).toHaveBeenCalledOnce();

    // A long north-south passage eventually refits so Mercator scale drift cannot make the
    // coastline disagree with the radar range ring.
    controller.sync({ latitude: 40, longitude: position.longitude }, 6, 180);
    expect(map.fitBounds).toHaveBeenCalledTimes(2);
  });

  it('coalesces a resize burst into one trailing refit and refits a range change immediately', () => {
    const map = fakeMap();
    const frames = fakeScheduler();
    const controller = createAisRadarCameraController(map as never, {
      scheduler: frames.scheduler,
    });
    const position = { latitude: 38, longitude: -122 };

    controller.sync(position, 6, 180);
    for (let diameter = 181; diameter <= 440; diameter += 1) {
      controller.sync(position, 6, diameter);
      expect(frames.pending()).toBe(1);
    }
    expect(map.fitBounds).toHaveBeenCalledOnce();
    expect(frames.delays.every((delay) => delay === AIS_RADAR_LAYOUT_REFIT_DELAY_MS)).toBe(true);

    frames.flush();
    expect(map.fitBounds).toHaveBeenCalledTimes(2);
    expect(frames.pending()).toBe(0);

    controller.sync(position, 12, 440);
    expect(map.fitBounds).toHaveBeenCalledTimes(3);

    controller.sync(position, 12, 441);
    expect(frames.pending()).toBe(1);
    controller.destroy();
    expect(frames.pending()).toBe(0);
  });
});
