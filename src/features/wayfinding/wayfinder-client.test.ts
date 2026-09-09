import { describe, expect, it, vi } from 'vitest';
import {
  fetchWayfinderRouteGeometry,
  normalizePropulsionOptions,
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
        objective: 'fastest',
        alternativeCount: 10,
        motorSpeedKn: 6,
        motorBelowKn: 0,
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
        objective: 'fastest',
        alternativeCount: 10,
        motorSpeedKn: 6,
        motorBelowKn: 0,
        vesselDraftM: 1.8,
      },
    });
  });

  it('deduplicates the standard shoreline margin from custom clearance', () => {
    expect(normalizeShorelineConstraints(false, 0)).toEqual({
      useLandAvoidance: true,
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

  it('removes propulsion options that the selected objective makes redundant', () => {
    const constraints = {
      useLandAvoidance: true,
      useCurrentGrib: true,
      waitForWind: true,
      maxWindKn: 0,
      maxWaveM: 0,
      daylightOnly: false,
      maxHoursPerDay: 0,
      minimumShoreDistanceNm: 0.5,
      maximumOffshoreDistanceNm: 0,
      alternativeCount: 5,
      motorSpeedKn: 6,
      motorBelowKn: 2,
      vesselDraftM: 1.8,
    } as const;

    expect(normalizePropulsionOptions({ ...constraints, objective: 'leastMotoring' })).toEqual({
      motorSpeedKn: 0,
      motorBelowKn: 0,
      waitForWind: true,
    });
    expect(normalizePropulsionOptions({ ...constraints, objective: 'allMotoring' })).toEqual({
      motorSpeedKn: 6,
      motorBelowKn: 0,
      waitForWind: false,
    });
    expect(normalizePropulsionOptions({ ...constraints, objective: 'bestWeather' })).toEqual({
      motorSpeedKn: 0,
      motorBelowKn: 0,
      waitForWind: true,
    });
    expect(normalizePropulsionOptions({ ...constraints, objective: 'fastest' })).toEqual({
      motorSpeedKn: 6,
      motorBelowKn: 2,
      waitForWind: false,
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
    expect(
      parseStatus({
        status: 'calculating',
        progress: 42,
        frontier: [
          [38.1, -122.3],
          [38.2, -122.2],
        ],
      }),
    ).toEqual({
      state: 'calculating',
      progress: 42,
      frontier: [
        { latitude: 38.1, longitude: -122.3 },
        { latitude: 38.2, longitude: -122.2 },
      ],
    });
    expect(parseStatus({ status: 'warning', progress: 100, warning: 'Partial route' })).toEqual({
      state: 'complete',
      progress: 100,
      message: 'Partial route',
    });
  });

  it('fails closed when an older Wayfinder promotes only partial alternatives', () => {
    expect(
      parseStatus({
        status: 'warning',
        progress: 100,
        warning: 'Route extends past forecast coverage',
        alternatives: [
          {
            index: 0,
            complete: false,
            durationHours: 33,
            distanceNm: 36,
            motorHours: 0,
            averageWaveHeightM: 0.9,
            maximumWaveHeightM: 0.9,
            averageWindKn: 4,
            maximumWindKn: 9,
          },
        ],
      }),
    ).toMatchObject({
      state: 'failed',
      progress: 100,
      message: 'Route extends past forecast coverage',
    });
  });

  it('parses pending alternative geometry for chart overlays', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          feature: {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [
                [-122.3, 38.1],
                [-122.2, 38.2],
              ],
            },
            properties: {},
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(
      fetchWayfinderRouteGeometry('http://signalk.test', undefined, 2, fetchFn),
    ).resolves.toEqual({
      index: 2,
      points: [
        { latitude: 38.1, longitude: -122.3 },
        { latitude: 38.2, longitude: -122.2 },
      ],
    });
    expect(fetchFn).toHaveBeenCalledWith(
      'http://signalk.test/plugins/signalk-wayfinder/pending-route?index=2',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('retains pending-route timing, wind, angle, and propulsion evidence', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          feature: {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [
                [-122.3, 38.1],
                [-122.2, 38.2],
              ],
            },
            properties: {
              coordinatesMeta: [
                { time: '2026-09-08T12:00:00Z' },
                {
                  time: '2026-09-08T13:30:00Z',
                  windDir: 285,
                  heading: 240,
                  twa: 45,
                  tws: 12.4,
                  boatSpeed: 6.1,
                  propulsion: 'sail',
                },
              ],
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(
      fetchWayfinderRouteGeometry('http://signalk.test', undefined, 0, fetchFn),
    ).resolves.toEqual({
      index: 0,
      points: [
        { latitude: 38.1, longitude: -122.3, time: '2026-09-08T12:00:00Z' },
        {
          latitude: 38.2,
          longitude: -122.2,
          time: '2026-09-08T13:30:00Z',
          windDir: 285,
          heading: 240,
          twa: 45,
          tws: 12.4,
          boatSpeed: 6.1,
          propulsion: 'sail',
        },
      ],
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
            p95WaveHeightM: 1.2,
            maximumWaveHeightM: 1.4,
            averageWindKn: 14,
            p95WindKn: 19,
            maximumWindKn: 21,
          },
        ],
      }),
    ).toEqual({
      state: 'complete',
      progress: 100,
      message: undefined,
      alternatives: [
        {
          index: 0,
          complete: true,
          durationHours: 12.5,
          distanceNm: 64.2,
          motorHours: 0,
          averageWaveHeightM: 0.8,
          p95WaveHeightM: 1.2,
          maximumWaveHeightM: 1.4,
          averageWindKn: 14,
          p95WindKn: 19,
          maximumWindKn: 21,
        },
      ],
    });
  });

  it('keeps only alternatives that reached the destination', () => {
    const complete = {
      index: 1,
      complete: true,
      durationHours: 13,
      distanceNm: 65,
      motorHours: 0,
      averageWaveHeightM: 0.9,
      maximumWaveHeightM: 1.5,
      averageWindKn: 13,
      maximumWindKn: 20,
    };
    expect(
      parseStatus({
        status: 'warning',
        progress: 100,
        alternatives: [{ ...complete, index: 0, complete: false }, complete],
      }),
    ).toMatchObject({ state: 'complete', alternatives: [complete] });
  });
});
