import { describe, expect, it } from 'vitest';
import type { ChartFeatureSelection } from '$shared/map';
import { chartFeatureDetails } from './chart-feature-info';

const selection: ChartFeatureSelection = {
  chartIdentifier: 'signalk-bathymetry-datum-vector',
  chartTitle: 'Local Bathymetry Cells',
  sourceLayer: 'DEPARE',
  x: 100,
  y: 120,
  width: 800,
  height: 600,
  longitude: -122.4,
  latitude: 37.8,
  properties: {
    BATHYMETRY_PROVIDER: 'signalk-bathymetry',
    BATHY_DEPTH_M: 6.25,
    BATHY_ROBUST_DEPTH_M: 6.8,
    BATHY_VERTICAL_SIGMA_M: 0.4,
    BATHY_CONFIDENCE: 0.72,
    BATHY_CONFIDENCE_REASONS: 'single_pass|sparse_neighbors',
    BATHY_OBSERVATION_COUNT: 3,
    BATHY_SOUNDING_COUNT: 27,
    BATHY_PASS_COUNT: 1,
    BATHY_SOURCE_COUNT: 2,
    BATHY_CELL_METERS: 10,
    BATHY_NEWEST_AT_MS: 1_700_000_000_000,
    BATHY_DATUM: 'MLLW',
    BATHY_MODE: 'datum',
    BATHY_CHANGE_STATE: 'stable',
  },
};

describe('chartFeatureDetails', () => {
  it('formats local bathymetry quality and evidence in metric units', () => {
    const details = chartFeatureDetails(selection, 'metric');
    expect(details.title).toBe('Local bathymetry cell');
    expect(details.depth).toBe('6.3');
    expect(details.depthUnit).toBe('m');
    expect(details.quality).toBe('Moderate evidence (72%)');
    expect(details.uncertainty).toBe('0.4');
    expect(details.robustDepth).toBe('6.8');
    expect(details.confidenceReasons).toEqual(['Single Pass', 'Sparse Neighbors']);
    expect(details.observations).toBe(3);
    expect(details.soundings).toBe(27);
  });

  it('converts meter-native tile values into the active imperial display unit', () => {
    const details = chartFeatureDetails(selection, 'imperial');
    expect(details.depth).toBe('20.5');
    expect(details.depthUnit).toBe('ft');
    expect(details.uncertainty).toBe('1.3');
    expect(details.cellSize).toBe('33');
  });

  it('uses an exact Signal K depth category without changing the cell resolution unit', () => {
    const details = chartFeatureDetails(selection, 'metric', 'fm');
    expect(details.depth).toBe('3.4');
    expect(details.depthUnit).toBe('fm');
    expect(details.uncertainty).toBe('0.2');
    expect(details.robustDepth).toBe('3.7');
    expect(details.cellSize).toBe('10');
    expect(details.cellSizeUnit).toBe('m');
  });

  it('also gives ordinary ENC depth areas a compact depth readout', () => {
    const details = chartFeatureDetails(
      { ...selection, properties: { DRVAL1: '4.2' }, chartIdentifier: 'noaa-enc' },
      'metric',
    );
    expect(details.title).toBe('Chart depth area');
    expect(details.depth).toBe('4.2');
    expect(details.quality).toBeUndefined();
  });
});
