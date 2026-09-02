'use strict';

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
const NOAA_FIELDS = 'OBJECTID,BOYSHP,CATMOR,COLOUR,COLPAT,OBJNAM,INFORM,SORDAT,SORIND,DSNM';
const MAX_MOORINGS = 5_000;
const NOAA_PAGE_SIZE = 1_000;
const NOAA_CACHE_MS = 15 * 60 * 1_000;
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
      outFields: NOAA_FIELDS,
      returnGeometry: 'true',
      outSR: '4326',
      orderByFields: 'OBJECTID',
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
  const byPosition = new Map();
  let sourceAnswered = false;
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    sourceAnswered = true;
    for (const feature of result.value) {
      const [longitude, latitude] = feature.geometry.coordinates;
      byPosition.set(`${longitude.toFixed(6)},${latitude.toFixed(6)}`, feature);
    }
  }
  if (!sourceAnswered) throw new Error('NOAA ENC mooring services were unavailable');
  return { type: 'FeatureCollection', features: [...byPosition.values()].slice(0, MAX_MOORINGS) };
}

function createNoaaCache() {
  const entries = new Map();
  return {
    async get(bbox) {
      const key = bboxKey(bbox);
      const now = Date.now();
      const cached = entries.get(key);
      if (cached && cached.expiresAt > now) return cached.value;
      const value = await fetchNoaaMoorings(bbox);
      entries.delete(key);
      entries.set(key, { expiresAt: now + NOAA_CACHE_MS, value });
      while (entries.size > MAX_CACHE_ENTRIES) entries.delete(entries.keys().next().value);
      return value;
    },
    clear() {
      entries.clear();
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
  const noaaCache = createNoaaCache();

  function start(options) {
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
          const collection = await noaaCache.get(bbox);
          response.set('Cache-Control', 'public, max-age=300');
          response.json(collection);
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
            get: { summary: 'Read collision alarm thresholds' },
            put: { summary: 'Store collision alarm thresholds' },
          },
          '/api/settings/alarm-location': {
            get: { summary: 'Read alarm location' },
            put: { summary: 'Store alarm location' },
          },
          '/api/moorings': {
            get: { summary: 'Read NOAA ENC mooring facilities for a bounded chart area' },
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
