import { isRecord } from '$shared/lib';
import { SK_PATHS } from './paths';
import { SignalKResourceClient } from './resource';
import type { SignalKStore } from './store.svelte';
import type { SKFrame, Value } from './types';

const VESSELS_SNAPSHOT_PATH = '/signalk/v1/api/vessels';
const MAX_SNAPSHOT_CONTEXTS = 5_000;
const MAX_CONTEXT_LENGTH = 512;

const AIS_SNAPSHOT_PATHS = [
  SK_PATHS.position,
  SK_PATHS.courseOverGroundTrue,
  SK_PATHS.speedOverGround,
  SK_PATHS.headingTrue,
  SK_PATHS.name,
  SK_PATHS.aisShipType,
  SK_PATHS.vesselLength,
  SK_PATHS.closestApproach,
  SK_PATHS.navigationState,
] as const;

export interface AisSnapshot {
  ais: NonNullable<SKFrame['ais']>;
  aisEpochs: NonNullable<SKFrame['aisEpochs']>;
}

function safeContext(id: string): string | undefined {
  const context = id.startsWith('vessels.') ? id : `vessels.${id}`;
  if (context.length > MAX_CONTEXT_LENGTH) return undefined;
  for (let index = 0; index < context.length; index += 1) {
    const code = context.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return undefined;
  }
  return context;
}

function nested(root: Record<string, unknown>, path: string): unknown {
  let value: unknown = root;
  for (const segment of path.split('.')) {
    if (!isRecord(value)) return undefined;
    value = value[segment];
  }
  return value;
}

function snapshotLeaf(raw: unknown, now: number): { value: Value; epoch?: number } | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw) || !Object.hasOwn(raw, 'value')) return { value: raw as Value };
  const parsed = typeof raw.timestamp === 'string' ? Date.parse(raw.timestamp) : Number.NaN;
  return {
    value: raw.value as Value,
    epoch: Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, now) : undefined,
  };
}

export function parseAisSnapshot(
  value: unknown,
  selfContext?: string,
  now: number = Date.now(),
): AisSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const ais = new Map<string, Map<string, Value>>();
  const aisEpochs = new Map<string, Map<string, number>>();
  const entries = Object.entries(value);
  if (entries.length > MAX_SNAPSHOT_CONTEXTS) return undefined;

  for (const [id, rawVessel] of entries) {
    if (!isRecord(rawVessel)) continue;
    const context = safeContext(id);
    if (!context || context === selfContext || context === 'vessels.self') continue;

    const leaves: Array<{ path: string; value: Value; epoch?: number }> = [];
    let fallbackEpoch = 0;
    for (const path of AIS_SNAPSHOT_PATHS) {
      const leaf = snapshotLeaf(nested(rawVessel, path), now);
      if (!leaf) continue;
      leaves.push({ path, ...leaf });
      if (leaf.epoch !== undefined) fallbackEpoch = Math.max(fallbackEpoch, leaf.epoch);
    }
    // Without any provider timestamp the snapshot cannot establish freshness. Leave that vessel to
    // the live stream rather than minting a current report from an undated cached object.
    if (fallbackEpoch === 0 || leaves.length === 0) continue;

    const values = new Map<string, Value>();
    const epochs = new Map<string, number>();
    for (const leaf of leaves) {
      values.set(leaf.path, leaf.value);
      epochs.set(leaf.path, leaf.epoch ?? fallbackEpoch);
    }
    ais.set(context, values);
    aisEpochs.set(context, epochs);
  }

  return { ais, aisEpochs };
}

export async function fetchAisSnapshot(
  origin: string,
  token: string | undefined,
  selfContext?: string,
): Promise<AisSnapshot | undefined> {
  const value = await new SignalKResourceClient({
    getToken: () => token,
    timeoutMs: 10_000,
  }).fetchJson<unknown>(`${origin}${VESSELS_SNAPSHOT_PATH}`);
  return parseAisSnapshot(value, selfContext);
}

export async function hydrateAisSnapshot(
  store: SignalKStore,
  origin: string,
  token: string | undefined,
  fetchSnapshot: typeof fetchAisSnapshot = fetchAisSnapshot,
): Promise<boolean> {
  const generation = store.generation;
  const requestedAt = Date.now();
  const snapshot = await fetchSnapshot(origin, token, store.selfContext);
  if (!snapshot) return false;
  return store.applyFrame({
    self: new Map(),
    ...snapshot,
    connection: store.connection,
    epoch: requestedAt,
    generation,
  });
}
