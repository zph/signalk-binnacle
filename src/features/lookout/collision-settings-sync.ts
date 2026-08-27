import { createLatestWriter } from '$shared/lib';
import { DEFAULT_THRESHOLDS, type PersistedValue, type Thresholds } from '$shared/settings';
import type { ResourceMutationResult } from '$shared/signalk';
import {
  type CollisionThresholdSettings,
  collisionThresholdSettings,
  loadCollisionSettings,
  mergeCollisionThresholdSettings,
  saveCollisionSettings,
} from './collision-settings-client';

export type ServerSettingLoad<T> =
  | { state: 'configured'; value: T }
  | { state: 'empty' | 'failed' | 'unavailable' };

interface ServerSettingSyncDeps<TLocal, TRemote> {
  store: PersistedValue<TLocal>;
  toRemote: (local: TLocal) => TRemote;
  merge: (local: TLocal, remote: TRemote) => TLocal;
  signature: (remote: TRemote) => string;
  load: () => Promise<ServerSettingLoad<TRemote>>;
  save: (remote: TRemote) => Promise<ResourceMutationResult>;
  writeError: string;
  preferLocal?: (local: TRemote, remote: TRemote) => boolean;
}

export interface ServerSettingSync<TLocal> {
  hydrate(): Promise<void>;
  observe(value: TLocal): void;
  dispose(): void;
}

// A server-backed setting keeps a bounded local fallback for offline startup. Hydration adopts the
// server value unless the local value changed while the request was in flight, in which case the
// newer local edit wins and uploads through a latest-only writer.
export function createServerSettingSync<TLocal, TRemote>(
  deps: ServerSettingSyncDeps<TLocal, TRemote>,
): ServerSettingSync<TLocal> {
  let generation = 0;
  let ready = false;
  let latest = deps.toRemote(deps.store.value);
  let lastSavedSignature: string | undefined;
  let submittedSignature: string | undefined;
  let dirtySignature: string | undefined;

  const writer = createLatestWriter<TRemote>(async (value) => {
    const valueSignature = deps.signature(value);
    const result = await deps.save(value);
    if (result !== 'ok') {
      if (submittedSignature === valueSignature) submittedSignature = undefined;
      throw new Error(`${deps.writeError}: ${result}`);
    }
    lastSavedSignature = valueSignature;
    if (submittedSignature === valueSignature) submittedSignature = undefined;
    if (dirtySignature === valueSignature) dirtySignature = undefined;
  });

  function submit(value: TRemote): void {
    const valueSignature = deps.signature(value);
    if (!ready || valueSignature === lastSavedSignature || valueSignature === submittedSignature) {
      return;
    }
    dirtySignature = valueSignature;
    submittedSignature = valueSignature;
    writer.submit(value);
  }

  function observe(value: TLocal): void {
    latest = deps.toRemote(value);
    submit(latest);
  }

  async function hydrate(): Promise<void> {
    if (ready) {
      if (dirtySignature) submit(latest);
      return;
    }
    const currentGeneration = ++generation;
    const startingSignature = deps.signature(latest);
    const result = await deps.load();
    if (currentGeneration !== generation) return;
    if (result.state !== 'configured') {
      if (result.state === 'failed' || result.state === 'unavailable') {
        ready = false;
        return;
      }
      ready = true;
      if (result.state === 'empty') {
        lastSavedSignature = undefined;
        submit(latest);
      }
      return;
    }

    ready = true;
    const serverSignature = deps.signature(result.value);
    lastSavedSignature = serverSignature;
    submittedSignature = undefined;
    const current = deps.toRemote(deps.store.value);
    if (
      dirtySignature ||
      deps.signature(current) !== startingSignature ||
      deps.preferLocal?.(current, result.value)
    ) {
      latest = current;
      submit(current);
      return;
    }
    latest = result.value;
    if (deps.signature(current) !== serverSignature) {
      deps.store.set(deps.merge(deps.store.value, result.value));
    }
  }

  return {
    hydrate,
    observe,
    dispose() {
      generation += 1;
      writer.dispose();
    },
  };
}

interface CollisionSettingsSyncDeps {
  origin: string;
  thresholds: PersistedValue<Thresholds>;
  getToken: () => string | undefined;
}

function collisionSignature(value: CollisionThresholdSettings): string {
  return `${value.dangerCpaMeters}:${value.dangerTcpaSeconds}:${value.warningCpaMeters}:${value.warningTcpaSeconds}`;
}

export function createCollisionSettingsSync(
  deps: CollisionSettingsSyncDeps,
): ServerSettingSync<Thresholds> {
  return createServerSettingSync({
    store: deps.thresholds,
    toRemote: collisionThresholdSettings,
    merge: mergeCollisionThresholdSettings,
    signature: collisionSignature,
    load: async () => {
      const result = await loadCollisionSettings(deps.origin, deps.getToken());
      return result.state === 'configured'
        ? { state: 'configured', value: result.thresholds }
        : result;
    },
    save: (value) => saveCollisionSettings(deps.origin, deps.getToken(), value),
    writeError: 'Collision settings write failed',
    // Early server-backed builds could seed the plugin with factory defaults before reading an
    // existing browser customization. Treat only that exact legacy shape as unconfigured so the
    // user's narrower or disabled CPA thresholds survive an upgrade. Once the server contains any
    // non-default value, it remains authoritative across displays.
    preferLocal: (local, remote) =>
      collisionSignature(remote) ===
        collisionSignature(collisionThresholdSettings(DEFAULT_THRESHOLDS)) &&
      collisionSignature(local) !==
        collisionSignature(collisionThresholdSettings(DEFAULT_THRESHOLDS)),
  });
}
