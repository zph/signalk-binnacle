import { describe, expect, it } from 'vitest';
import { createSatelliteImageryOverlay, SATELLITE_IMAGERY_SOURCE } from './satellite-source';

describe('SATELLITE_IMAGERY_SOURCE', () => {
  it('declares a keyless global reference layer with provider attribution', () => {
    expect(SATELLITE_IMAGERY_SOURCE.tiles).toEqual([
      'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    ]);
    expect(SATELLITE_IMAGERY_SOURCE.tiles[0]).not.toContain('token=');
    expect(SATELLITE_IMAGERY_SOURCE.defaultVisible).toBe(false);
    expect(SATELLITE_IMAGERY_SOURCE.category).toBe('charts');
    expect(SATELLITE_IMAGERY_SOURCE.region).toBe('Global');
    expect(SATELLITE_IMAGERY_SOURCE.attribution).toContain('Esri');
    expect(SATELLITE_IMAGERY_SOURCE.description).toContain('not a nautical chart');
  });
});

describe('createSatelliteImageryOverlay', () => {
  it('places imagery above the vector base and below chart data', () => {
    const overlay = createSatelliteImageryOverlay();
    expect(overlay.id).toBe('satellite-imagery');
    expect(overlay.band).toBe('basemap');
    expect(overlay.defaultVisible).toBe(false);
    expect(overlay.supportsOpacity).toBe(true);
  });
});
