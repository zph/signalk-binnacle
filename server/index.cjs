'use strict';

const MAX_CPA_METERS = 1_852_000;
const MAX_TCPA_SECONDS = 7 * 24 * 60 * 60;

function collisionThresholds(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = {
    dangerCpaMeters: value.dangerCpaMeters,
    dangerTcpaSeconds: value.dangerTcpaSeconds,
    warningCpaMeters: value.warningCpaMeters,
    warningTcpaSeconds: value.warningTcpaSeconds,
  };
  if (
    !bounded(candidate.dangerCpaMeters, MAX_CPA_METERS) ||
    !bounded(candidate.dangerTcpaSeconds, MAX_TCPA_SECONDS) ||
    !bounded(candidate.warningCpaMeters, MAX_CPA_METERS) ||
    !bounded(candidate.warningTcpaSeconds, MAX_TCPA_SECONDS)
  ) {
    return undefined;
  }
  return candidate;
}

function bounded(value, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
}

function schema() {
  const cpa = { type: 'number', minimum: 0, maximum: MAX_CPA_METERS };
  const tcpa = { type: 'number', minimum: 0, maximum: MAX_TCPA_SECONDS };
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      collisionThresholds: {
        title: 'Collision alarm thresholds',
        type: 'object',
        additionalProperties: false,
        required: [
          'dangerCpaMeters',
          'dangerTcpaSeconds',
          'warningCpaMeters',
          'warningTcpaSeconds',
        ],
        properties: {
          dangerCpaMeters: { ...cpa, title: 'Danger CPA (meters)' },
          dangerTcpaSeconds: { ...tcpa, title: 'Danger TCPA (seconds)' },
          warningCpaMeters: { ...cpa, title: 'Warning CPA (meters)' },
          warningTcpaSeconds: { ...tcpa, title: 'Warning TCPA (seconds)' },
        },
      },
    },
  };
}

module.exports = function createBinnaclePlugin(app) {
  let stored;

  function start(options) {
    if (!options || !Object.hasOwn(options, 'collisionThresholds')) {
      stored = undefined;
      app.setPluginStatus?.('Ready to store collision alarm settings');
      return;
    }
    stored = collisionThresholds(options.collisionThresholds);
    if (!stored) {
      app.setPluginError?.('Stored collision alarm thresholds are invalid.');
      return;
    }
    app.setPluginStatus?.('Collision alarm settings stored');
  }

  function save(next) {
    return new Promise((resolve, reject) => {
      app.savePluginOptions({ collisionThresholds: next }, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  return {
    id: 'binnacle-custom',
    name: 'Binnacle Custom',
    description: 'Stores boat-wide Binnacle configuration on the Signal K server.',
    schema,
    start,
    stop: () => undefined,
    registerWithRouter(router) {
      router.access('readonly').get('/api/settings/collision', (_request, response) => {
        response.set('Cache-Control', 'no-store');
        response.json({ thresholds: stored ?? null });
      });
      router.access('readwrite').put('/api/settings/collision', async (request, response) => {
        const next = collisionThresholds(request.body?.thresholds);
        if (!next) {
          response.status(400).json({ error: 'Invalid collision alarm thresholds.' });
          return;
        }
        try {
          await save(next);
          stored = next;
          app.setPluginStatus?.('Collision alarm settings stored');
          response.set('Cache-Control', 'no-store');
          response.json({ thresholds: stored });
        } catch (error) {
          app.error?.(`Unable to save collision alarm settings: ${errorMessage(error)}`);
          response.status(500).json({ error: 'Unable to save collision alarm settings.' });
        }
      });
    },
    getOpenApi() {
      return {
        openapi: '3.0.3',
        info: { title: 'Binnacle Custom settings API', version: '1.0.0' },
        paths: {
          '/api/settings/collision': {
            get: { summary: 'Read collision alarm thresholds' },
            put: { summary: 'Store collision alarm thresholds' },
          },
        },
      };
    },
    statusMessage: () =>
      stored ? 'Collision alarm settings stored' : 'Waiting for collision alarm settings',
  };
};

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
