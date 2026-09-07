import { describe, expect, it, vi } from 'vitest';
import { parseCapabilities, parseStatus, startWayfinderPlan } from './wayfinder-client';

describe('wayfinder API parsing', () => {
  it('accepts a ready capability response', () => {
    expect(
      parseCapabilities({
        apiVersion: '1.3',
        ready: true,
        objectives: ['fastest', 'leastMotoring', 'allMotoring', 'bestWeather'],
        maximumAlternatives: 10,
        passageConstraints: ['daylightOnly', 'maxHoursPerDay'],
        navigationConstraints: ['minimumShoreDistanceNm', 'maximumOffshoreDistanceNm'],
        vesselDraft: { valueM: 1.8, path: 'design.draft.maximum' },
        configuredDraftPath: 'design.draft.current',
      }),
    ).toEqual({
      apiVersion: '1.3',
      ready: true,
      objectives: ['fastest', 'leastMotoring', 'allMotoring', 'bestWeather'],
      maximumAlternatives: 10,
      passageConstraints: ['daylightOnly', 'maxHoursPerDay'],
      navigationConstraints: ['minimumShoreDistanceNm', 'maximumOffshoreDistanceNm'],
      vesselDraft: { valueM: 1.8, path: 'design.draft.maximum' },
      configuredDraftPath: 'design.draft.current',
      unavailableReason: undefined,
    });
  });

  it('preserves a precise route-start rejection from Wayfinder', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: 'Start point is shallower than the configured minimum depth' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    const result = await startWayfinderPlan(
      'http://signalk.test',
      undefined,
      {
        id: 'route-1',
        name: 'Test route',
        waypoints: [
          { position: { latitude: 58.6, longitude: 19 } },
          { position: { latitude: 58.8, longitude: 19.35 } },
        ],
      },
      '2026-06-06T13:00:00.000Z',
      {
        daylightOnly: false,
        maxHoursPerDay: 0,
        minimumShoreDistanceNm: 0,
        maximumOffshoreDistanceNm: 0,
        objective: 'fastest',
        alternativeCount: 5,
        motorSpeedKn: 0,
        motorBelowKn: 0,
        vesselDraftM: 1.8,
      },
      fetchFn,
    );

    expect(result).toEqual({
      started: false,
      error: 'Start point is shallower than the configured minimum depth',
    });
  });

  it('accepts an older capability response but reports no passage constraints', () => {
    expect(parseCapabilities({ apiVersion: '1.0', ready: true, objectives: ['fastest'] })).toEqual({
      apiVersion: '1.0',
      ready: true,
      objectives: ['fastest'],
      maximumAlternatives: 1,
      passageConstraints: [],
      navigationConstraints: [],
      vesselDraft: undefined,
      configuredDraftPath: 'design.draft.current',
      unavailableReason: undefined,
    });
  });

  it('rejects malformed capability and status responses', () => {
    expect(
      parseCapabilities({ apiVersion: '1.0', ready: true, objectives: ['unsafe'] }),
    ).toBeUndefined();
    expect(parseStatus({ status: 'routing' })).toBeUndefined();
  });

  it('normalizes the plugin calculation states', () => {
    expect(parseStatus({ status: 'calculating', progress: 42 })).toEqual({
      state: 'calculating',
      progress: 42,
    });
    expect(parseStatus({ status: 'warning', progress: 100, warning: 'Partial route' })).toEqual({
      state: 'complete',
      progress: 100,
      message: 'Partial route',
    });
  });

  it('parses ranked alternative summaries', () => {
    expect(
      parseStatus({
        status: 'done',
        progress: 100,
        alternatives: [
          {
            index: 0,
            complete: true,
            durationHours: 12.5,
            distanceNm: 64.2,
            motorHours: 0,
            averageWaveHeightM: 0.8,
            maximumWaveHeightM: 1.4,
            averageWindKn: 14,
            maximumWindKn: 21,
          },
        ],
      }),
    ).toEqual({
      state: 'complete',
      progress: 100,
      alternatives: [
        {
          index: 0,
          complete: true,
          durationHours: 12.5,
          distanceNm: 64.2,
          motorHours: 0,
          averageWaveHeightM: 0.8,
          maximumWaveHeightM: 1.4,
          averageWindKn: 14,
          maximumWindKn: 21,
        },
      ],
    });
  });
});
