import { describe, expect, it } from 'vitest';
import type { CurrentEvent, TideEvent } from '$entities/tides';
import {
  formatCurrentRate,
  formatStationDistance,
  formatTideHeight,
  formatTideHeightSecondary,
  nextCurrentEvent,
  nextFlowEvent,
  nowFraction,
  tideCurvePoints,
  tideCurveSamples,
  tideDepthCurvePoints,
  tideHeightAt,
  tideHoverReading,
  tideSourceNote,
  upcomingEvents,
} from './tides-display';

const events: TideEvent[] = [
  { timeMs: 1000, heightMeters: 0.1, kind: 'low' },
  { timeMs: 3000, heightMeters: 0.5, kind: 'high' },
];

describe('tides-display', () => {
  it('puts the preferred height unit first and the other in support', () => {
    expect(formatTideHeight(1.234, 'metric')).toBe('1.23 m');
    expect(formatTideHeightSecondary(1.234, 'metric')).toBe('4.0 ft');
    expect(formatTideHeight(1, 'imperial')).toBe('3.3 ft');
    expect(formatTideHeightSecondary(1, 'imperial')).toBe('1.00 m');
  });

  it('formats the station distance in whole kilometers or miles with a floor', () => {
    expect(formatStationDistance(500, 'metric')).toBe('<1 km');
    expect(formatStationDistance(12_400, 'metric')).toBe('12 km');
    expect(formatStationDistance(1500, 'imperial')).toBe('<1 mi');
    expect(formatStationDistance(12_400, 'imperial')).toBe('8 mi');
  });

  it('formats a current rate in knots from SI m/s', () => {
    expect(formatCurrentRate(0.5144)).toBe('1.0 kn');
  });

  it('returns only upcoming events, soonest first', () => {
    expect(upcomingEvents(events, 2000).map((e) => e.timeMs)).toEqual([3000]);
  });

  it('returns the earliest chronological current event, slack included', () => {
    // Slack water is the decisive event for a tidal-gate transit; skipping it for a later
    // maximum told a navigator the wrong next event.
    const currents: CurrentEvent[] = [
      { timeMs: 1000, velocityMps: 0.5, directionRad: (100 * Math.PI) / 180, kind: 'flood' },
      { timeMs: 2000, velocityMps: 0, directionRad: undefined, kind: 'slack' },
      { timeMs: 3000, velocityMps: 0.4, directionRad: (280 * Math.PI) / 180, kind: 'ebb' },
    ];
    expect(nextCurrentEvent(currents, 1500)?.kind).toBe('slack');
    // An event exactly at now still counts as upcoming.
    expect(nextCurrentEvent(currents, 2000)?.kind).toBe('slack');
    // A passed slack yields the following maximum.
    expect(nextCurrentEvent(currents, 2001)?.kind).toBe('ebb');
    // An empty upcoming window yields nothing rather than a stale event.
    expect(nextCurrentEvent(currents, 4000)).toBeUndefined();
    expect(nextCurrentEvent([], 0)).toBeUndefined();
  });

  it('finds the following flood or ebb maximum for the secondary row', () => {
    const currents: CurrentEvent[] = [
      { timeMs: 2000, velocityMps: 0, directionRad: undefined, kind: 'slack' },
      { timeMs: 3000, velocityMps: 0.4, directionRad: (280 * Math.PI) / 180, kind: 'ebb' },
    ];
    expect(nextFlowEvent(currents, 1500)?.kind).toBe('ebb');
    expect(nextFlowEvent(currents, 3500)).toBeUndefined();
  });

  it('normalizes tide curve points to a 0..1 box', () => {
    const points = tideCurvePoints(events);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[1]).toEqual({ x: 1, y: 1 });
    expect(tideCurvePoints([])).toEqual([]);
  });

  it('interpolates tide height smoothly between turning points', () => {
    expect(tideHeightAt(events, 1000)).toBeCloseTo(0.1);
    expect(tideHeightAt(events, 2000)).toBeCloseTo(0.3);
    expect(tideHeightAt(events, 3000)).toBeCloseTo(0.5);
    expect(tideHeightAt(events, 500)).toBeUndefined();
    expect(tideHeightAt(events, 3001)).toBeUndefined();
  });

  it('densifies turning points for a smooth chart without changing its endpoints', () => {
    const samples = tideCurveSamples(events, 500);
    expect(samples).toHaveLength(5);
    expect(samples[0]).toEqual({ timeMs: 1000, heightMeters: 0.1 });
    expect(samples.at(-1)).toEqual({ timeMs: 3000, heightMeters: 0.5 });
  });

  it('projects sounder depth by the predicted tide change on one physical scale', () => {
    const projected = tideDepthCurvePoints(events, 2000, 4);
    expect(projected).toBeDefined();
    expect(projected?.tide).toHaveLength(2);
    expect(projected?.estimatedDepth).toHaveLength(2);
    // The estimated depth moves by the same 0.4 m between low and high as the tide prediction.
    const ySpan = (projected?.estimatedDepth[1].y ?? 0) - (projected?.estimatedDepth[0].y ?? 0);
    const tideSpan = (projected?.tide[1].y ?? 0) - (projected?.tide[0].y ?? 0);
    expect(ySpan).toBeCloseTo(tideSpan);
    expect(projected?.estimatedDepth[0].y).toBeGreaterThan(projected?.tide[0].y ?? 0);
    expect(tideDepthCurvePoints(events, 500, 4)).toBeUndefined();
  });

  it('reports the hovered tide and sounder-adjusted depth at an exact time', () => {
    expect(tideHoverReading(events, 2500, 4, 2000)).toEqual({
      timeMs: 2500,
      tideHeightMeters: expect.closeTo(0.441421356, 6),
      estimatedDepthMeters: expect.closeTo(4.141421356, 6),
    });
  });

  it('snaps hover inspection to the nearest authoritative six-minute sample', () => {
    const detailed = [
      { timeMs: 1000, heightMeters: 0.1 },
      { timeMs: 1360, heightMeters: 0.25 },
      { timeMs: 1720, heightMeters: 0.4 },
    ];
    expect(tideHoverReading(events, 1300, 4, 1360, detailed)).toEqual({
      timeMs: 1360,
      tideHeightMeters: 0.25,
      estimatedDepthMeters: 4,
    });
  });

  it('locates now within the span, or undefined outside it', () => {
    expect(nowFraction(events, 2000)).toBeCloseTo(0.5);
    expect(nowFraction(events, 500)).toBeUndefined();
  });

  it('names the source that served the tide prediction, or stays silent without one', () => {
    expect(tideSourceNote('signalk-tides')).toBe(
      'Automatic tide predictions use the signalk-tides plugin. Tidal-current predictions use NOAA CO-OPS.',
    );
    expect(tideSourceNote('noaa-coops')).toBe(
      'Automatic tide and tidal-current predictions use NOAA CO-OPS.',
    );
    expect(
      tideSourceNote('noaa-coops', {
        mode: 'manual',
        station: { id: 'T1', name: 'Tide', latitude: 0, longitude: 0 },
        distanceMeters: 0,
      }),
    ).toContain('manually selected');
    expect(tideSourceNote(undefined)).toBe('');
  });
});
