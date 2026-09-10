'use strict';

const { mkdirSync } = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const MAX_CPA_METERS = 1_852_000;
const MAX_TCPA_SECONDS = 7 * 24 * 60 * 60;
const ALARM_LOCATIONS = new Set(['top', 'center', 'bottom']);
const NOAA_MOORING_SOURCES = [
  { scaleBand: 'overview', layer: 34 },
  { scaleBand: 'general', layer: 40 },
  { scaleBand: 'coastal', layer: 46 },
  { scaleBand: 'approach', layer: 60 },
  { scaleBand: 'harbour', layer: 56 },
  { scaleBand: 'berthing', layer: 27 },
];
const MAX_MOORINGS = 5_000;
const NOAA_PAGE_SIZE = 1_000;
const NOAA_CACHE_MS = 15 * 60 * 1_000;
const NOAA_CACHE_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
const NOAA_FAILURE_RETRY_MS = 10_000;
const MAX_CACHE_ENTRIES = 32;
const MAX_AREA_SPAN_DEGREES = 5;

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

function alarmLocation(value) {
  return typeof value === 'string' && ALARM_LOCATIONS.has(value) ? value : undefined;
}

function parseBbox(value) {
  if (typeof value !== 'string' || value.length > 160) return undefined;
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length !== 4) return undefined;
  const [west, south, east, north] = parsed;
  if (
    ![west, south, east, north].every(Number.isFinite) ||
    west < -180 ||
    east > 180 ||
    south < -90 ||
    north > 90 ||
    west >= east ||
    south >= north ||
    east - west > MAX_AREA_SPAN_DEGREES ||
    north - south > MAX_AREA_SPAN_DEGREES
  ) {
    return undefined;
  }
  return [west, south, east, north];
}

function bboxKey(bbox) {
  return bbox.map((value) => value.toFixed(5)).join(',');
}

function filterCollection(collection, bbox) {
  return {
    type: 'FeatureCollection',
    features: collection.features.filter((feature) => {
      const [longitude, latitude] = feature.geometry.coordinates;
      return (
        longitude >= bbox[0] && longitude <= bbox[2] && latitude >= bbox[1] && latitude <= bbox[3]
      );
    }),
  };
}

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  const hasControlCharacter = Array.from(text).some((character) => {
    const code = character.codePointAt(0);
    return code !== undefined && (code <= 31 || code === 127);
  });
  return text && text.length <= maxLength && !hasControlCharacter ? text : undefined;
}

function finiteInRange(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function cleanNoaaFeature(value, scaleBand) {
  if (!value || typeof value !== 'object' || value.geometry?.type !== 'Point') return undefined;
  const coordinates = value.geometry.coordinates;
  if (
    !Array.isArray(coordinates) ||
    coordinates.length < 2 ||
    !finiteInRange(coordinates[0], -180, 180) ||
    !finiteInRange(coordinates[1], -90, 90)
  ) {
    return undefined;
  }
  const properties = value.properties;
  if (!properties || typeof properties !== 'object') return undefined;
  const objectId = properties.OBJECTID;
  if (!Number.isSafeInteger(objectId) || objectId < 0) return undefined;
  return {
    type: 'Feature',
    id: objectId,
    geometry: { type: 'Point', coordinates: [coordinates[0], coordinates[1]] },
    properties: {
      OBJECTID: objectId,
      BOYSHP: finiteInRange(properties.BOYSHP, 0, 100) ? properties.BOYSHP : null,
      CATMOR: cleanText(properties.CATMOR, 25) ?? null,
      COLOUR: cleanText(properties.COLOUR, 254) ?? null,
      COLPAT: cleanText(properties.COLPAT, 254) ?? null,
      OBJNAM: cleanText(properties.OBJNAM, 254) ?? null,
      INFORM: cleanText(properties.INFORM, 254) ?? null,
      SORDAT: cleanText(properties.SORDAT, 254) ?? null,
      SORIND: cleanText(properties.SORIND, 254) ?? null,
      DSNM: cleanText(properties.DSNM, 12) ?? null,
      BINNACLE_SCALE_BAND: scaleBand,
    },
  };
}

async function fetchNoaaMooringSource(source, bbox) {
  const features = [];
  const seen = new Set();
  for (let offset = 0; offset < MAX_MOORINGS; offset += NOAA_PAGE_SIZE) {
    const params = new URLSearchParams({
      where: '1=1',
      geometry: bbox.join(','),
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      returnGeometry: 'true',
      outSR: '4326',
      resultOffset: String(offset),
      resultRecordCount: String(NOAA_PAGE_SIZE),
      f: 'geojson',
    });
    const url = `https://encdirect.noaa.gov/arcgis/rest/services/encdirect/enc_${source.scaleBand}/MapServer/${source.layer}/query`;
    const response = await fetch(`${url}?${params}`, {
      headers: { Accept: 'application/geo+json, application/json' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`NOAA ENC returned ${response.status}`);
    const body = await response.json();
    if (!body || typeof body !== 'object' || !Array.isArray(body.features)) {
      throw new Error('NOAA ENC returned an invalid feature collection');
    }
    for (const raw of body.features) {
      const feature = cleanNoaaFeature(raw, source.scaleBand);
      if (!feature || seen.has(feature.id)) continue;
      seen.add(feature.id);
      features.push(feature);
      if (features.length >= MAX_MOORINGS) break;
    }
    if (features.length >= MAX_MOORINGS || body.features.length < NOAA_PAGE_SIZE) break;
  }
  return features;
}

async function fetchNoaaMoorings(bbox) {
  const results = await Promise.allSettled(
    NOAA_MOORING_SOURCES.map((source) => fetchNoaaMooringSource(source, bbox)),
  );
  const unavailable = results.flatMap((result, index) =>
    result.status === 'fulfilled' ? [] : [NOAA_MOORING_SOURCES[index].scaleBand],
  );
  if (unavailable.length > 0) {
    throw new Error(`NOAA ENC mooring services unavailable: ${unavailable.join(', ')}`);
  }
  const byPosition = new Map();
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const feature of result.value) {
      const [longitude, latitude] = feature.geometry.coordinates;
      byPosition.set(`${longitude.toFixed(6)},${latitude.toFixed(6)}`, feature);
    }
  }
  return {
    type: 'FeatureCollection',
    features: [...byPosition.values()].slice(0, MAX_MOORINGS),
  };
}

function createNoaaCache(databasePath, onError) {
  const entries = new Map();
  const failures = new Map();
  const pending = new Map();
  let database;
  let readStored;
  let writeStored;
  let pruneStored;
  try {
    if (databasePath) {
      mkdirSync(path.dirname(databasePath), { recursive: true });
      database = new DatabaseSync(databasePath);
      database.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 1000;');
      database.exec(`
        CREATE TABLE IF NOT EXISTS mooring_cache (
          cache_key TEXT PRIMARY KEY,
          west REAL NOT NULL,
          south REAL NOT NULL,
          east REAL NOT NULL,
          north REAL NOT NULL,
          payload TEXT NOT NULL,
          refreshed_at_ms INTEGER NOT NULL
        ) STRICT;
        CREATE INDEX IF NOT EXISTS mooring_cache_refreshed_at
          ON mooring_cache(refreshed_at_ms DESC);
      `);
      readStored = database.prepare(`
        SELECT payload, refreshed_at_ms
        FROM mooring_cache
        WHERE west <= ? AND south <= ? AND east >= ? AND north >= ?
          AND refreshed_at_ms > ?
        ORDER BY refreshed_at_ms DESC
        LIMIT 1
      `);
      writeStored = database.prepare(`
        INSERT INTO mooring_cache(cache_key, west, south, east, north, payload, refreshed_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
          west = excluded.west, south = excluded.south, east = excluded.east,
          north = excluded.north, payload = excluded.payload,
          refreshed_at_ms = excluded.refreshed_at_ms
      `);
      pruneStored = database.prepare(`
        DELETE FROM mooring_cache
        WHERE refreshed_at_ms <= ?
      `);
    }
  } catch (error) {
    database?.close();
    database = undefined;
    onError?.(`Unable to open mooring cache database: ${errorMessage(error)}`);
  }

  function stored(bbox, now) {
    if (!readStored) return undefined;
    try {
      const row = readStored.get(bbox[0], bbox[1], bbox[2], bbox[3], now - NOAA_CACHE_RETENTION_MS);
      if (!row || typeof row.payload !== 'string' || typeof row.refreshed_at_ms !== 'number') {
        return undefined;
      }
      const value = JSON.parse(row.payload);
      if (value?.type !== 'FeatureCollection' || !Array.isArray(value.features)) {
        return undefined;
      }
      return {
        value: filterCollection(value, bbox),
        cachedAtMs: row.refreshed_at_ms,
      };
    } catch (error) {
      onError?.(`Unable to read mooring cache database: ${errorMessage(error)}`);
      return undefined;
    }
  }

  function persist(bbox, value, now) {
    if (!writeStored || !pruneStored) return;
    try {
      writeStored.run(bboxKey(bbox), ...bbox, JSON.stringify(value), now);
      pruneStored.run(now - NOAA_CACHE_RETENTION_MS);
    } catch (error) {
      onError?.(`Unable to write mooring cache database: ${errorMessage(error)}`);
    }
  }

  function refresh(bbox, key) {
    const existing = pending.get(key);
    if (existing) return existing;
    const request = fetchNoaaMoorings(bbox)
      .then((value) => {
        const now = Date.now();
        failures.delete(key);
        entries.delete(key);
        entries.set(key, { refreshedAtMs: now, value });
        while (entries.size > MAX_CACHE_ENTRIES) entries.delete(entries.keys().next().value);
        persist(bbox, value, now);
        return { value, cachedAtMs: undefined };
      })
      .catch((error) => {
        failures.set(key, {
          retryAt: Date.now() + NOAA_FAILURE_RETRY_MS,
          error,
        });
        throw error;
      })
      .finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  }

  return {
    async get(bbox) {
      const key = bboxKey(bbox);
      const now = Date.now();
      const cached = entries.get(key);
      if (cached && cached.refreshedAtMs + NOAA_CACHE_MS > now) {
        return { value: cached.value, cachedAtMs: undefined };
      }
      const disk = stored(bbox, now);
      if (disk && disk.cachedAtMs + NOAA_CACHE_MS > now) return disk;
      if (disk) {
        void refresh(bbox, key).catch(() => undefined);
        return disk;
      }
      const failed = failures.get(key);
      if (failed && failed.retryAt > now) throw failed.error;
      return refresh(bbox, key);
    },
    clear() {
      entries.clear();
      failures.clear();
      pending.clear();
      database?.close();
      database = undefined;
    },
  };
}

function schema() {
  const cpa = { type: 'number', minimum: 0, maximum: MAX_CPA_METERS };
  const tcpa = { type: 'number', minimum: 0, maximum: MAX_TCPA_SECONDS };
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      collisionThresholds: {
        title: 'Legacy collision alarm thresholds',
        description:
          'Compatibility for older Binnacle clients. Current clients store collision policies in profiles.',
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
      alarmLocation: {
        title: 'Alarm location',
        type: 'string',
        enum: ['top', 'center', 'bottom'],
        default: 'bottom',
      },
    },
  };
}

module.exports = function createBinnaclePlugin(app) {
  let storedThresholds;
  let storedAlarmLocation;
  let saveQueue = Promise.resolve();
  let noaaCache = createNoaaCache();

  function start(options) {
    noaaCache.clear();
    const dataDirectory = app.getDataDirPath?.();
    noaaCache = createNoaaCache(
      dataDirectory ? path.join(dataDirectory, 'moorings-cache.sqlite') : undefined,
      (message) => app.error?.(message),
    );
    saveQueue = Promise.resolve();
    storedThresholds = undefined;
    storedAlarmLocation = undefined;
    if (options && Object.hasOwn(options, 'collisionThresholds')) {
      storedThresholds = collisionThresholds(options.collisionThresholds);
      if (!storedThresholds) {
        app.setPluginError?.('Stored collision alarm thresholds are invalid.');
        return;
      }
    }
    if (options && Object.hasOwn(options, 'alarmLocation')) {
      storedAlarmLocation = alarmLocation(options.alarmLocation);
      if (!storedAlarmLocation) {
        app.setPluginError?.('Stored alarm location is invalid.');
        return;
      }
    }
    app.setPluginStatus?.(
      storedThresholds || storedAlarmLocation
        ? 'Alarm settings stored'
        : 'Ready to store alarm settings',
    );
  }

  function save(update) {
    const operation = saveQueue.then(async () => {
      const nextThresholds = Object.hasOwn(update, 'collisionThresholds')
        ? update.collisionThresholds
        : storedThresholds;
      const nextAlarmLocation = Object.hasOwn(update, 'alarmLocation')
        ? update.alarmLocation
        : storedAlarmLocation;
      const options = {};
      if (nextThresholds) options.collisionThresholds = nextThresholds;
      if (nextAlarmLocation) options.alarmLocation = nextAlarmLocation;
      await new Promise((resolve, reject) => {
        app.savePluginOptions(options, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      storedThresholds = nextThresholds;
      storedAlarmLocation = nextAlarmLocation;
    });
    saveQueue = operation.catch(() => undefined);
    return operation;
  }

  return {
    id: 'binnacle-custom',
    name: 'Binnacle Custom',
    description: 'Stores boat-wide Binnacle configuration on the Signal K server.',
    schema,
    start,
    stop() {
      noaaCache.clear();
    },
    registerWithRouter(router) {
      router.access('readonly').get('/api/moorings', async (request, response) => {
        const bbox = parseBbox(request.query?.bbox);
        if (!bbox) {
          response.status(400).json({ error: 'A valid, bounded bbox is required.' });
          return;
        }
        try {
          const result = await noaaCache.get(bbox);
          response.set('Cache-Control', 'public, max-age=300');
          response.set('X-Binnacle-Moorings-Source', result.cachedAtMs ? 'stored' : 'live');
          response.json(
            result.cachedAtMs ? { ...result.value, cachedAtMs: result.cachedAtMs } : result.value,
          );
        } catch (fetchError) {
          app.error?.(`Unable to load NOAA ENC moorings: ${errorMessage(fetchError)}`);
          response.status(502).json({ error: 'Unable to load NOAA ENC moorings.' });
        }
      });
      router.access('readonly').get('/api/settings/collision', (_request, response) => {
        response.set('Cache-Control', 'no-store');
        response.json({ thresholds: storedThresholds ?? null });
      });
      router.access('readwrite').put('/api/settings/collision', async (request, response) => {
        const next = collisionThresholds(request.body?.thresholds);
        if (!next) {
          response.status(400).json({ error: 'Invalid collision alarm thresholds.' });
          return;
        }
        try {
          await save({ collisionThresholds: next });
          app.setPluginStatus?.('Alarm settings stored');
          response.set('Cache-Control', 'no-store');
          response.json({ thresholds: storedThresholds });
        } catch (error) {
          app.error?.(`Unable to save collision alarm settings: ${errorMessage(error)}`);
          response.status(500).json({ error: 'Unable to save collision alarm settings.' });
        }
      });
      router.access('readonly').get('/api/settings/alarm-location', (_request, response) => {
        response.set('Cache-Control', 'no-store');
        response.json({ location: storedAlarmLocation ?? null });
      });
      router.access('readwrite').put('/api/settings/alarm-location', async (request, response) => {
        const next = alarmLocation(request.body?.location);
        if (!next) {
          response.status(400).json({ error: 'Invalid alarm location.' });
          return;
        }
        try {
          await save({ alarmLocation: next });
          app.setPluginStatus?.('Alarm settings stored');
          response.set('Cache-Control', 'no-store');
          response.json({ location: storedAlarmLocation });
        } catch (error) {
          app.error?.(`Unable to save alarm location: ${errorMessage(error)}`);
          response.status(500).json({ error: 'Unable to save alarm location.' });
        }
      });
    },
    getOpenApi() {
      return {
        openapi: '3.0.3',
        info: { title: 'Binnacle Custom settings API', version: '1.0.0' },
        paths: {
          '/api/settings/collision': {
            get: { summary: 'Read legacy collision alarm thresholds' },
            put: { summary: 'Store legacy collision alarm thresholds' },
          },
          '/api/settings/alarm-location': {
            get: { summary: 'Read alarm location' },
            put: { summary: 'Store alarm location' },
          },
          '/api/moorings': {
            get: {
              summary: 'Read NOAA ENC mooring facilities for a bounded chart area',
            },
          },
        },
      };
    },
    statusMessage: () =>
      storedThresholds || storedAlarmLocation
        ? 'Alarm settings stored'
        : 'Waiting for alarm settings',
  };
};

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
