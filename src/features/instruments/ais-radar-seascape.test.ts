import { describe, expect, it, vi } from 'vitest';
import { mapThemePaint } from '$shared/map';
import {
  AIS_RADAR_MAP_PADDING_PX,
  aisRadarBounds,
  applyAisRadarSeascape,
  fitAisRadarSeascape,
} from './ais-radar-seascape';

function fakeMap() {
  return {
    getStyle: () => ({
      layers: [
        { id: 'background', type: 'background' },
        { id: 'water', type: 'fill', 'source-layer': 'water' },
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
    fitBounds: vi.fn(),
  };
}

describe('AIS radar seascape', () => {
  it('keeps only flat land, water, and the water boundary', () => {
    const map = fakeMap();
    applyAisRadarSeascape(map as never, 'day');
    const paint = mapThemePaint('day');

    expect(map.setLayoutProperty).toHaveBeenCalledWith('background', 'visibility', 'visible');
    expect(map.setLayoutProperty).toHaveBeenCalledWith('water', 'visibility', 'visible');
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
});
