import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import type { LatLon } from '$shared/geo';
import { baseStyleUrl, mapThemePaint } from '$shared/map';
import { createPositionRenderGate, POSITION_RENDER_DEADBAND_METERS } from '$shared/nav';
import type { Theme } from '$shared/ui';
import type { AisRadarRangeNm } from './ais-radar-model';

const EARTH_CIRCUMFERENCE_METERS = 40_075_016.686;
const TILE_SIZE_PX = 256;
const DEFAULT_VECTOR_MAX_ZOOM = 14;
const MAX_TILE_ZOOM = 24;
const MAX_MERCATOR_LATITUDE = 85.051_129;
const MAX_TILE_CACHE_ENTRIES = 64;
const MAX_WATER_FEATURES_PER_TILE = 10_000;
const MAX_WATER_POINTS_PER_TILE = 300_000;
const AIS_RADAR_FALLBACK_DIAMETER_PX = 400;

export const AIS_RADAR_POSITION_MAX_INTERVAL_MS = 5_000;
export const AIS_RADAR_LAYOUT_RENDER_DELAY_MS = 150;

interface RefitScheduler {
  request(callback: () => void, delayMs: number): number | undefined;
  cancel(id: number): void;
}

interface ShorelineFrame {
  position: LatLon;
  rangeNm: AisRadarRangeNm;
  width: number;
  height: number;
  theme: Theme;
  companionBase?: string | null;
}

interface ShorelineController {
  sync(frame: ShorelineFrame): void;
  destroy(): void;
}

interface TileRef {
  z: number;
  x: number;
  y: number;
  worldX: number;
}

interface ShorelinePlan {
  centerX: number;
  centerY: number;
  worldPixels: number;
  tileCount: number;
  refs: TileRef[];
}

interface WaterPoint {
  x: number;
  y: number;
}

interface DecodedWaterTile {
  extent: number;
  features: WaterPoint[][][];
}

interface LoadedWaterTile {
  ref: TileRef;
  water: DecodedWaterTile;
}

interface TileDescriptor {
  template: string;
  minZoom: number;
  maxZoom: number;
}

interface ShorelineSource {
  load(planForZoom: (minZoom: number, maxZoom: number) => ShorelinePlan): Promise<{
    plan: ShorelinePlan;
    tiles: LoadedWaterTile[];
  } | null>;
}

const defaultRefitScheduler: RefitScheduler = {
  request(callback, delayMs) {
    if (typeof window === 'undefined') return undefined;
    return window.setTimeout(callback, delayMs);
  },
  cancel(id) {
    if (typeof window !== 'undefined') window.clearTimeout(id);
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteZoom(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(MAX_TILE_ZOOM, Math.max(0, Math.round(value)))
    : fallback;
}

function normalizedDiameter(width: number, height: number): number {
  const diameter = Math.min(width, height);
  return Math.max(1, Math.round(diameter > 0 ? diameter : AIS_RADAR_FALLBACK_DIAMETER_PX));
}

function boundedLatitude(latitude: number): number {
  return Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, latitude));
}

function mercatorPoint(position: LatLon): { x: number; y: number } {
  const latitudeRad = (boundedLatitude(position.latitude) * Math.PI) / 180;
  return {
    x: (position.longitude + 180) / 360,
    y: (1 - Math.log(Math.tan(latitudeRad) + 1 / Math.cos(latitudeRad)) / Math.PI) / 2,
  };
}

function wrappedTileX(x: number, count: number): number {
  return ((x % count) + count) % count;
}

export function aisRadarPositionRenderMeters(rangeNm: AisRadarRangeNm, diameterPx: number): number {
  const usableDiameter =
    Number.isFinite(diameterPx) && diameterPx > 0 ? diameterPx : AIS_RADAR_FALLBACK_DIAMETER_PX;
  return Math.max(POSITION_RENDER_DEADBAND_METERS, (rangeNm * 1852) / usableDiameter);
}

export function buildAisRadarShorelinePlan(
  position: LatLon,
  rangeNm: AisRadarRangeNm,
  width: number,
  height: number,
  minZoom = 0,
  maxZoom = DEFAULT_VECTOR_MAX_ZOOM,
): ShorelinePlan {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const diameter = normalizedDiameter(safeWidth, safeHeight);
  const radiusMeters = Math.max(1, rangeNm * 1852);
  const latitudeScale = Math.cos((boundedLatitude(position.latitude) * Math.PI) / 180);
  const desiredWorldPixels =
    (EARTH_CIRCUMFERENCE_METERS * latitudeScale * diameter) / (radiusMeters * 2);
  const displayZoom = Math.log2(Math.max(TILE_SIZE_PX, desiredWorldPixels) / TILE_SIZE_PX);
  const boundedMaxZoom = finiteZoom(maxZoom, DEFAULT_VECTOR_MAX_ZOOM);
  const boundedMinZoom = Math.min(boundedMaxZoom, finiteZoom(minZoom, 0));
  const tileZoom = Math.max(boundedMinZoom, Math.min(boundedMaxZoom, Math.floor(displayZoom)));
  const tileCount = 2 ** tileZoom;
  const worldPixels = TILE_SIZE_PX * 2 ** displayZoom;
  const center = mercatorPoint(position);
  const halfWidth = safeWidth / 2 / worldPixels;
  const halfHeight = safeHeight / 2 / worldPixels;
  const minWorldX = Math.floor((center.x - halfWidth) * tileCount);
  const maxWorldX = Math.floor((center.x + halfWidth) * tileCount);
  const minY = Math.max(0, Math.floor((center.y - halfHeight) * tileCount));
  const maxY = Math.min(tileCount - 1, Math.floor((center.y + halfHeight) * tileCount));
  const refs: TileRef[] = [];

  for (let worldX = minWorldX; worldX <= maxWorldX; worldX += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      refs.push({ z: tileZoom, x: wrappedTileX(worldX, tileCount), y, worldX });
    }
  }
  return { centerX: center.x, centerY: center.y, worldPixels, tileCount, refs };
}

export function decodeAisRadarWaterTile(bytes: ArrayBuffer): DecodedWaterTile {
  const tile = new VectorTile(new PbfReader(new Uint8Array(bytes)));
  const layer = tile.layers.water;
  if (!layer) return { extent: 4096, features: [] };
  const features: WaterPoint[][][] = [];
  let pointCount = 0;
  const featureCount = Math.min(layer.length, MAX_WATER_FEATURES_PER_TILE);

  for (let index = 0; index < featureCount; index += 1) {
    const feature = layer.feature(index);
    if (feature.type !== 3 || feature.properties.brunnel === 'tunnel') continue;
    const rings = feature
      .loadGeometry()
      .map((ring) => ring.map((point) => ({ x: point.x, y: point.y })));
    pointCount += rings.reduce((sum, ring) => sum + ring.length, 0);
    if (pointCount > MAX_WATER_POINTS_PER_TILE) break;
    features.push(rings);
  }
  return { extent: layer.extent, features };
}

function safeHttpUrl(raw: string, base: string): string | undefined {
  try {
    const resolved = new URL(raw, base);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return undefined;
    return resolved.href.replaceAll('%7B', '{').replaceAll('%7D', '}');
  } catch {
    return undefined;
  }
}

function tileDescriptorFromSource(
  source: Record<string, unknown>,
  base: string,
): TileDescriptor | undefined {
  const tiles = Array.isArray(source.tiles)
    ? source.tiles.filter((tile): tile is string => typeof tile === 'string')
    : [];
  const template = tiles[0] ? safeHttpUrl(tiles[0], base) : undefined;
  if (!template) return undefined;
  return {
    template,
    minZoom: finiteZoom(source.minzoom, 0),
    maxZoom: finiteZoom(source.maxzoom, DEFAULT_VECTOR_MAX_ZOOM),
  };
}

async function fetchJsonRecord(
  fetchFn: typeof fetch,
  url: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  const response = await fetchFn(url, init);
  if (!response.ok) throw new Error(`Shoreline source returned HTTP ${response.status}`);
  const value: unknown = await response.json();
  if (!isRecord(value)) throw new TypeError('Shoreline source returned an invalid document');
  return value;
}

async function resolveDirectTileDescriptor(fetchFn: typeof fetch): Promise<TileDescriptor> {
  const styleUrl = baseStyleUrl();
  const style = await fetchJsonRecord(fetchFn, styleUrl);
  if (!isRecord(style.sources)) throw new TypeError('Basemap style has no sources');
  const preferred = style.sources.openmaptiles;
  const source = isRecord(preferred)
    ? preferred
    : Object.values(style.sources).find(
        (candidate): candidate is Record<string, unknown> =>
          isRecord(candidate) && candidate.type === 'vector',
      );
  if (!source) throw new TypeError('Basemap style has no vector source');
  const inline = tileDescriptorFromSource(source, styleUrl);
  if (inline) return inline;
  if (typeof source.url !== 'string') throw new TypeError('Basemap vector source has no URL');
  const tileJsonUrl = safeHttpUrl(source.url, styleUrl);
  if (!tileJsonUrl) throw new TypeError('Basemap vector source URL is unsupported');
  const tileJson = await fetchJsonRecord(fetchFn, tileJsonUrl);
  const descriptor = tileDescriptorFromSource(tileJson, tileJsonUrl);
  if (!descriptor) throw new TypeError('Basemap TileJSON has no HTTP tile template');
  return descriptor;
}

function tileUrl(template: string, ref: TileRef): string {
  return template
    .replaceAll('{z}', String(ref.z))
    .replaceAll('{x}', String(ref.x))
    .replaceAll('{y}', String(ref.y));
}

function authInit(
  url: string,
  companionBase: string | null | undefined,
  token?: string,
): RequestInit {
  if (!companionBase || !token || !url.startsWith(`${companionBase.replace(/\/+$/, '')}/`)) {
    return {};
  }
  return { headers: { Authorization: `Bearer ${token}` } };
}

export function createAisRadarShorelineSource(options: {
  companionBase?: string | null;
  getToken?: () => string | undefined;
  fetchFn?: typeof fetch;
}): ShorelineSource {
  const fetchFn = options.fetchFn ?? fetch;
  const companionBase = options.companionBase?.replace(/\/+$/, '');
  const tileCache = new Map<string, Promise<DecodedWaterTile | null>>();
  let descriptorPromise: Promise<TileDescriptor> | undefined;

  function descriptor(): Promise<TileDescriptor> {
    if (!descriptorPromise) {
      descriptorPromise = companionBase
        ? Promise.resolve({
            template: `${companionBase}/style/basemap/tiles/openmaptiles/{z}/{x}/{y}`,
            minZoom: 0,
            maxZoom: DEFAULT_VECTOR_MAX_ZOOM,
          })
        : resolveDirectTileDescriptor(fetchFn);
      void descriptorPromise.catch(() => {
        descriptorPromise = undefined;
      });
    }
    return descriptorPromise;
  }

  function loadTile(url: string): Promise<DecodedWaterTile | null> {
    const cached = tileCache.get(url);
    if (cached) return cached;
    const request = fetchFn(url, authInit(url, companionBase, options.getToken?.()))
      .then((response) => {
        if (!response.ok) throw new Error(`Shoreline tile returned HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then(decodeAisRadarWaterTile)
      .catch(() => {
        tileCache.delete(url);
        return null;
      });
    tileCache.set(url, request);
    if (tileCache.size > MAX_TILE_CACHE_ENTRIES) {
      const oldest = tileCache.keys().next().value;
      if (typeof oldest === 'string') tileCache.delete(oldest);
    }
    return request;
  }

  return {
    async load(planForZoom) {
      let resolved: TileDescriptor;
      try {
        resolved = await descriptor();
      } catch {
        return null;
      }
      const plan = planForZoom(resolved.minZoom, resolved.maxZoom);
      const loaded = await Promise.all(
        plan.refs.map(async (ref) => ({
          ref,
          water: await loadTile(tileUrl(resolved.template, ref)),
        })),
      );
      return {
        plan,
        tiles: loaded.filter((entry): entry is LoadedWaterTile => entry.water !== null),
      };
    },
  };
}

function screenPoint(
  plan: ShorelinePlan,
  ref: TileRef,
  extent: number,
  point: WaterPoint,
  width: number,
  height: number,
): WaterPoint {
  return {
    x:
      width / 2 +
      ((ref.worldX + point.x / extent) / plan.tileCount - plan.centerX) * plan.worldPixels,
    y: height / 2 + ((ref.y + point.y / extent) / plan.tileCount - plan.centerY) * plan.worldPixels,
  };
}

export function drawAisRadarShoreline(
  context: CanvasRenderingContext2D,
  frame: ShorelineFrame,
  plan: ShorelinePlan,
  tiles: LoadedWaterTile[],
): void {
  const paint = mapThemePaint(frame.theme);
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, frame.width, frame.height);
  context.fillStyle = paint.water;
  context.fillRect(0, 0, frame.width, frame.height);
  context.lineWidth = 1;
  context.strokeStyle = paint.boundary;

  for (const tile of tiles) {
    const topLeft = screenPoint(
      plan,
      tile.ref,
      tile.water.extent,
      { x: 0, y: 0 },
      frame.width,
      frame.height,
    );
    const bottomRight = screenPoint(
      plan,
      tile.ref,
      tile.water.extent,
      { x: tile.water.extent, y: tile.water.extent },
      frame.width,
      frame.height,
    );
    context.save();
    context.beginPath();
    context.rect(
      Math.floor(topLeft.x),
      Math.floor(topLeft.y),
      Math.ceil(bottomRight.x - topLeft.x) + 1,
      Math.ceil(bottomRight.y - topLeft.y) + 1,
    );
    context.clip();
    context.fillStyle = paint.background;
    context.fillRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);

    context.fillStyle = paint.water;
    for (const feature of tile.water.features) {
      context.beginPath();
      for (const ring of feature) {
        const first = ring[0];
        if (!first) continue;
        const start = screenPoint(
          plan,
          tile.ref,
          tile.water.extent,
          first,
          frame.width,
          frame.height,
        );
        context.moveTo(start.x, start.y);
        for (const point of ring.slice(1)) {
          const screen = screenPoint(
            plan,
            tile.ref,
            tile.water.extent,
            point,
            frame.width,
            frame.height,
          );
          context.lineTo(screen.x, screen.y);
        }
        context.closePath();
      }
      context.fill('evenodd');
      context.stroke();
    }
    context.restore();
  }
}

export function createAisRadarShorelineController(
  onRender: (frame: ShorelineFrame) => void,
  options: { now?: () => number; scheduler?: RefitScheduler } = {},
): ShorelineController {
  const positionGate = createPositionRenderGate(options.now);
  const scheduler = options.scheduler ?? defaultRefitScheduler;
  let renderedFrame: ShorelineFrame | undefined;
  let pendingFrame: ShorelineFrame | undefined;
  let pendingId: number | undefined;

  function cancelPending(): void {
    if (pendingId === undefined) return;
    scheduler.cancel(pendingId);
    pendingId = undefined;
  }

  function render(frame: ShorelineFrame): void {
    cancelPending();
    pendingFrame = undefined;
    renderedFrame = { ...frame, position: { ...frame.position } };
    positionGate.reset();
    positionGate.shouldRender(frame.position, {
      minDistanceMeters: aisRadarPositionRenderMeters(
        frame.rangeNm,
        normalizedDiameter(frame.width, frame.height),
      ),
      maxIntervalMs: AIS_RADAR_POSITION_MAX_INTERVAL_MS,
      minTrailingDistanceMeters: POSITION_RENDER_DEADBAND_METERS,
    });
    onRender(frame);
  }

  function schedule(frame: ShorelineFrame): void {
    pendingFrame = frame;
    cancelPending();
    pendingId = scheduler.request(() => {
      pendingId = undefined;
      if (pendingFrame) render(pendingFrame);
    }, AIS_RADAR_LAYOUT_RENDER_DELAY_MS);
    if (pendingId === undefined) render(frame);
  }

  return {
    sync(frame) {
      if (
        !renderedFrame ||
        renderedFrame.rangeNm !== frame.rangeNm ||
        renderedFrame.theme !== frame.theme ||
        renderedFrame.companionBase !== frame.companionBase
      ) {
        render(frame);
        return;
      }
      if (
        normalizedDiameter(renderedFrame.width, renderedFrame.height) !==
        normalizedDiameter(frame.width, frame.height)
      ) {
        schedule(frame);
        return;
      }
      if (
        positionGate.shouldRender(frame.position, {
          minDistanceMeters: aisRadarPositionRenderMeters(
            frame.rangeNm,
            normalizedDiameter(frame.width, frame.height),
          ),
          maxIntervalMs: AIS_RADAR_POSITION_MAX_INTERVAL_MS,
          minTrailingDistanceMeters: POSITION_RENDER_DEADBAND_METERS,
        })
      ) {
        render(frame);
      }
    },
    destroy() {
      cancelPending();
    },
  };
}
