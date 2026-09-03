import type { AisTargets, AisTargetView } from '$entities/ais';
import { type Bbox4, bboxContains, lngLatBoundsToBbox4, padBbox } from '$shared/geo';
import { isRecord, readBoundedJson, withTimeout } from '$shared/lib';
import type { OverlayContext } from '$shared/map';
import { authInit } from '$shared/signalk';

const SETTLE_MS = 1_500;
const POLL_MS = 1_000;
const MAX_TARGETS = 1_000;
const MAX_BBOX_SPAN = 5;

interface DestinationSnapshot {
  state: 'connecting' | 'live' | 'disconnected' | 'error' | 'unavailable';
  targets: AisTargetView[];
}

export interface ViewportAisOverlayOptions {
  origin: string;
  getToken: () => string | undefined;
  available: () => boolean;
  targets: AisTargets;
  now?: () => number;
}

function finite(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
  );
}

function optionalFinite(value: unknown, minimum: number, maximum: number): number | undefined {
  return finite(value, minimum, maximum) ? value : undefined;
}

function target(value: unknown): AisTargetView | undefined {
  if (!isRecord(value) || !isRecord(value.position)) return undefined;
  const { id, mmsi, name, lastReportAtMs } = value;
  const { latitude, longitude } = value.position;
  if (
    typeof id !== 'string' ||
    typeof mmsi !== 'string' ||
    !finite(latitude, -90, 90) ||
    !finite(longitude, -180, 180) ||
    !finite(lastReportAtMs, 0, Number.MAX_SAFE_INTEGER)
  ) {
    return undefined;
  }
  return {
    id,
    name: typeof name === 'string' && name.trim() ? name.trim() : undefined,
    position: { latitude, longitude },
    cogRad: optionalFinite(value.cogRad, 0, Math.PI * 2),
    headingRad: optionalFinite(value.headingRad, 0, Math.PI * 2),
    sogMps: optionalFinite(value.sogMps, 0, 200),
    shipTypeId: optionalFinite(value.shipTypeId, 0, 99),
    lengthMeters: optionalFinite(value.lengthMeters, 0, 1_000),
    navigationState: typeof value.navigationState === 'string' ? value.navigationState : undefined,
    lastReportAtMs,
  };
}

async function fetchTargets(
  origin: string,
  token: string | undefined,
  bbox: Bbox4,
): Promise<DestinationSnapshot> {
  const query = new URLSearchParams({ bbox: JSON.stringify(bbox) });
  try {
    const response = await fetch(
      `${origin}/plugins/signalk-aisstream/api/destination?${query}`,
      withTimeout(authInit(token, { cache: 'no-store' }), 5_000),
    );
    if (response.status === 404 || response.status === 503) {
      return { state: 'unavailable', targets: [] };
    }
    if (!response.ok) return { state: 'error', targets: [] };
    const body = await readBoundedJson<unknown>(response);
    if (!isRecord(body) || !Array.isArray(body.targets)) {
      return { state: 'error', targets: [] };
    }
    const state =
      body.state === 'live' ||
      body.state === 'connecting' ||
      body.state === 'disconnected' ||
      body.state === 'error'
        ? body.state
        : 'error';
    return {
      state,
      targets: body.targets
        .slice(0, MAX_TARGETS)
        .map(target)
        .filter((item): item is AisTargetView => item !== undefined),
    };
  } catch {
    return { state: 'error', targets: [] };
  }
}

function sameBbox(left: Bbox4 | undefined, right: Bbox4): boolean {
  return left?.every((coordinate, index) => coordinate === right[index]) ?? false;
}

function requestBbox(viewport: Bbox4): Bbox4 | undefined {
  const [west, south, east, north] = viewport;
  if (west >= east || east - west > MAX_BBOX_SPAN || north - south > MAX_BBOX_SPAN)
    return undefined;
  const padded = padBbox(viewport);
  return padded[2] - padded[0] <= MAX_BBOX_SPAN && padded[3] - padded[1] <= MAX_BBOX_SPAN
    ? padded
    : viewport;
}

export function createViewportAisOverlay(options: ViewportAisOverlayOptions) {
  const now = options.now ?? Date.now;
  let mounted = false;
  let loading = false;
  let fetchedBbox: Bbox4 | undefined;
  let pendingViewport: Bbox4 | undefined;
  let pendingSince = 0;
  let nextFetchAt = 0;
  let generation = 0;

  function clear(): void {
    if (loading) {
      generation += 1;
      loading = false;
    }
    fetchedBbox = undefined;
    options.targets.clearViewportTargets();
  }

  async function load(bbox: Bbox4): Promise<void> {
    const requestGeneration = ++generation;
    loading = true;
    const snapshot = await fetchTargets(options.origin, options.getToken(), bbox);
    if (!mounted || requestGeneration !== generation) return;
    loading = false;
    fetchedBbox = bbox;
    options.targets.replaceViewportTargets(snapshot.targets);
    nextFetchAt = now() + POLL_MS;
  }

  return {
    id: 'viewport-ais',
    title: 'Viewport AIS',
    description: 'AISStream targets in the stabilized chart viewport.',
    band: 'traffic' as const,
    listed: false,
    supportsOpacity: false,
    layerIds: [],
    add(_ctx: OverlayContext) {
      mounted = true;
    },
    sync(ctx: OverlayContext) {
      if (!options.available()) {
        clear();
        return;
      }
      const viewport = lngLatBoundsToBbox4(ctx.map.getBounds());
      if (fetchedBbox && bboxContains(fetchedBbox, viewport) && now() < nextFetchAt) return;
      if (!pendingViewport || !sameBbox(pendingViewport, viewport)) {
        pendingViewport = viewport;
        pendingSince = now();
        return;
      }
      if (loading || now() - pendingSince < SETTLE_MS) return;
      const bbox = requestBbox(viewport);
      if (!bbox) {
        clear();
        return;
      }
      void load(bbox);
    },
    setVisible(_ctx: OverlayContext, _visible: boolean) {},
    setOpacity(_ctx: OverlayContext, _opacity: number) {},
    applyTheme() {},
    remove(_ctx: OverlayContext) {
      mounted = false;
      generation += 1;
      options.targets.clearViewportTargets();
    },
  };
}
