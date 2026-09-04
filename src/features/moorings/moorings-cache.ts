import { type Bbox4, bboxContains, isLatLon } from '$shared/geo';
import { cleanBoundedText, DAY_MS, isRecord } from '$shared/lib';
import { createExpiringStore, type ExpiringStore } from '$shared/storage';
import type { MooringPoint, MooringScaleBand } from './moorings-types';

export const MOORINGS_CACHE_TTL_MS = 90 * DAY_MS;
const MAX_CACHED_AREAS = 32;
const MAX_CACHED_MOORINGS = 5_000;
const INDEX_KEY = 'areas-v1';
const SCALE_BANDS = new Set<MooringScaleBand>([
  'overview',
  'general',
  'coastal',
  'approach',
  'harbour',
  'berthing',
]);

interface AreaIndexEntry {
  key: string;
  bbox: Bbox4;
  savedAtMs: number;
}

interface StoredArea extends AreaIndexEntry {
  moorings: MooringPoint[];
}

interface StoredIndex {
  version: 1;
  areas: AreaIndexEntry[];
}

export interface CachedMooringArea {
  bbox: Bbox4;
  moorings: MooringPoint[];
  savedAtMs: number;
}

export interface MooringsCache {
  find(viewport: Bbox4, nowMs: number): Promise<CachedMooringArea | undefined>;
  put(
    bbox: Bbox4,
    moorings: readonly MooringPoint[],
    savedAtMs: number,
    nowMs?: number,
  ): Promise<void>;
}

function validBbox(value: unknown): value is Bbox4 {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
  ) {
    return false;
  }
  const [west, south, east, north] = value;
  return west < east && south >= -85 && south < north && north <= 85 && east - west <= 10;
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  return value === undefined ? undefined : cleanBoundedText(value, maxLength);
}

function cachedMooring(value: unknown): MooringPoint | undefined {
  if (!isRecord(value) || !isLatLon(value.position)) return undefined;
  const id = cleanBoundedText(value.id, 256);
  const name = cleanBoundedText(value.name, 254);
  const scaleBand = cleanBoundedText(value.scaleBand, 16) as MooringScaleBand | undefined;
  if (!id || !name || !scaleBand || !SCALE_BANDS.has(scaleBand)) return undefined;
  const buoyShape = value.buoyShape;
  return {
    id,
    name,
    position: value.position,
    category: optionalText(value.category, 25),
    information: optionalText(value.information, 254),
    sourceDate: optionalText(value.sourceDate, 254),
    sourceIndication: optionalText(value.sourceIndication, 254),
    encCell: optionalText(value.encCell, 12),
    scaleBand,
    buoyShape: typeof buoyShape === 'number' && Number.isFinite(buoyShape) ? buoyShape : undefined,
    colors: optionalText(value.colors, 254),
    colorPattern: optionalText(value.colorPattern, 254),
    // Occupancy is live AIS evidence. Never replay an old assessment with a chart position.
    assessment: { status: 'unknown', score: 0, evidence: [] },
  };
}

function areaKey(bbox: Bbox4): string {
  return `area:${bbox.map((value) => value.toFixed(5)).join(',')}`;
}

function validIndexEntry(value: unknown, nowMs: number): AreaIndexEntry | undefined {
  if (
    !isRecord(value) ||
    typeof value.key !== 'string' ||
    !value.key.startsWith('area:') ||
    !validBbox(value.bbox) ||
    typeof value.savedAtMs !== 'number' ||
    !Number.isFinite(value.savedAtMs) ||
    value.savedAtMs < 0 ||
    value.savedAtMs + MOORINGS_CACHE_TTL_MS <= nowMs
  ) {
    return undefined;
  }
  return { key: value.key, bbox: value.bbox, savedAtMs: value.savedAtMs };
}

function validIndex(value: unknown, nowMs: number): AreaIndexEntry[] {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.areas)) return [];
  return value.areas
    .slice(0, MAX_CACHED_AREAS)
    .flatMap((entry) => {
      const valid = validIndexEntry(entry, nowMs);
      return valid ? [valid] : [];
    })
    .sort((left, right) => right.savedAtMs - left.savedAtMs);
}

function validArea(value: unknown, nowMs: number): StoredArea | undefined {
  const entry = validIndexEntry(value, nowMs);
  if (!entry || !isRecord(value) || !Array.isArray(value.moorings)) return undefined;
  const seen = new Set<string>();
  const moorings: MooringPoint[] = [];
  for (const candidate of value.moorings.slice(0, MAX_CACHED_MOORINGS)) {
    const mooring = cachedMooring(candidate);
    if (!mooring || seen.has(mooring.id)) continue;
    seen.add(mooring.id);
    moorings.push(mooring);
  }
  if (value.moorings.length > 0 && moorings.length === 0) return undefined;
  return { ...entry, moorings };
}

export function createMooringsCache(store?: ExpiringStore<unknown>): MooringsCache {
  const persist =
    store ??
    createExpiringStore<unknown>('binnacle-custom-moorings', {
      maxEntries: MAX_CACHED_AREAS + 1,
    });
  let saveQueue = Promise.resolve();

  return {
    async find(viewport, nowMs) {
      const storedIndex = await persist.get(INDEX_KEY);
      const entries = validIndex(storedIndex?.value, nowMs).filter((entry) =>
        bboxContains(entry.bbox, viewport),
      );
      for (const entry of entries) {
        const stored = await persist.get(entry.key);
        if (!stored || stored.expires <= nowMs) continue;
        const area = validArea(stored.value, nowMs);
        if (!area || area.key !== entry.key) continue;
        return {
          bbox: area.bbox,
          moorings: area.moorings,
          savedAtMs: area.savedAtMs,
        };
      }
      return undefined;
    },
    put(bbox, moorings, savedAtMs, nowMs = Date.now()) {
      const key = areaKey(bbox);
      const expires = savedAtMs + MOORINGS_CACHE_TTL_MS;
      const area: StoredArea = {
        key,
        bbox,
        savedAtMs,
        moorings: [...moorings],
      };
      saveQueue = saveQueue
        .then(async () => {
          const storedIndex = await persist.get(INDEX_KEY);
          const areas = validIndex(storedIndex?.value, nowMs)
            .filter((entry) => entry.key !== key)
            .concat({ key, bbox, savedAtMs })
            .sort((left, right) => right.savedAtMs - left.savedAtMs)
            .slice(0, MAX_CACHED_AREAS);
          const indexExpires = (areas[0]?.savedAtMs ?? savedAtMs) + MOORINGS_CACHE_TTL_MS;
          await persist.put(key, area, expires);
          await persist.put(INDEX_KEY, { version: 1, areas } satisfies StoredIndex, indexExpires);
          await persist.prune(nowMs);
        })
        .catch((error) => console.warn('[moorings] persisted cache write failed', error));
      return saveQueue;
    },
  };
}
