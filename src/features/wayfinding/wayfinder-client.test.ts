import { describe, expect, it, vi } from 'vitest';
import {
  normalizeShorelineConstraints,
  parseCapabilities,
  parseStatus,
  startWayfinderPlan,
} from './wayfinder-client';

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
        useLandAvoidance: true,
        useCurrentGrib: true,
        waitForWind: false,
        maxWindKn: 0,
        maxWaveM: 0,
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

  it('sends every route-affecting standalone Wayfinder option', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        new Response('{}', { status: 202, headers: { 'Content-Type': 'application/json' } }),
      );

    await startWayfinderPlan(
      'http://signalk.test',
      'token',
      {
        id: 'route-1',
        name: 'Test route',
        waypoints: [
          { position: { latitude: 38.1, longitude: -122.3 } },
          { position: { latitude: 38.2, longitude: -122.2 } },
          { position: { latitude: 38.3, longitude: -122.1 } },
        ],
      },
      '2026-09-08T16:00:00.000Z',
      {
        useLandAvoidance: false,
        useCurrentGrib: false,
        waitForWind: true,
        maxWindKn: 28,
        maxWaveM: 1.7,
        daylightOnly: true,
        maxHoursPerDay: 8,
        minimumShoreDistanceNm: 1,
        maximumOffshoreDistanceNm: 40,
        objective: 'leastMotoring',
        alternativeCount: 10,
        motorSpeedKn: 6,
        motorBelowKn: 2,
        vesselDraftM: 1.8,
      },
      fetchFn,
    );

    const request = fetchFn.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      start: { lat: 38.1, lon: -122.3 },
      end: { lat: 38.3, lon: -122.1 },
      waypoints: [{ lat: 38.2, lon: -122.2 }],
      departureTime: '2026-09-08T16:00:00.000Z',
      useLandAvoidance: true,
      useSafetyMargin: false,
      useCurrentGrib: false,
      options: {
        waitForWind: true,
        maxWindKn: 28,
        maxWaveM: 1.7,
        daylightOnly: true,
        maxHoursPerDay: 8,
        minimumShoreDistanceNm: 1,
        maximumOffshoreDistanceNm: 40,
        objective: 'leastMotoring',
        alternativeCount: 10,
        motorSpeedKn: 6,
        motorBelowKn: 2,
        vesselDraftM: 1.8,
      },
    });
  });

  it('deduplicates the standard shoreline margin from custom clearance', () => {
    expect(normalizeShorelineConstraints(false, 0)).toEqual({
      useLandAvoidance: false,
      useSafetyMargin: false,
      minimumShoreDistanceNm: 0,
    });
    expect(normalizeShorelineConstraints(true, 0.5)).toEqual({
      useLandAvoidance: true,
      useSafetyMargin: true,
      minimumShoreDistanceNm: 0,
    });
    expect(normalizeShorelineConstraints(false, 2)).toEqual({
      useLandAvoidance: true,
      useSafetyMargin: false,
      minimumShoreDistanceNm: 2,
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
