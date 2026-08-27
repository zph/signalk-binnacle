import { createLatestWriter } from '$shared/lib';
import type { PersistedValue, Thresholds } from '$shared/settings';
import {
  type CollisionThresholdSettings,
  collisionThresholdSettings,
  loadCollisionSettings,
  mergeCollisionThresholdSettings,
  saveCollisionSettings,
} from './collision-settings-client';

interface CollisionSettingsSyncDeps {
  origin: string;
  thresholds: PersistedValue<Thresholds>;
  getToken: () => string | undefined;
}

export interface CollisionSettingsSync {
  hydrate(): Promise<void>;
  observe(value: Thresholds): void;
  dispose(): void;
}

function signature(value: CollisionThresholdSettings): string {
  return `${value.dangerCpaMeters}:${value.dangerTcpaSeconds}:${value.warningCpaMeters}:${value.warningTcpaSeconds}`;
}

export function createCollisionSettingsSync(
  deps: CollisionSettingsSyncDeps,
): CollisionSettingsSync {
  let generation = 0;
  let ready = false;
  let latest = collisionThresholdSettings(deps.thresholds.value);
  let lastSavedSignature: string | undefined;
  let submittedSignature: string | undefined;
  let dirtySignature: string | undefined;

  const writer = createLatestWriter<CollisionThresholdSettings>(async (value) => {
    const valueSignature = signature(value);
    const result = await saveCollisionSettings(deps.origin, deps.getToken(), value);
    if (result !== 'ok') {
      if (submittedSignature === valueSignature) submittedSignature = undefined;
      throw new Error(`Collision settings write failed: ${result}`);
    }
    lastSavedSignature = valueSignature;
    if (submittedSignature === valueSignature) submittedSignature = undefined;
    if (dirtySignature === valueSignature) dirtySignature = undefined;
  });

  function submit(value: CollisionThresholdSettings): void {
    const valueSignature = signature(value);
    if (!ready || valueSignature === lastSavedSignature || valueSignature === submittedSignature) {
      return;
    }
    dirtySignature = valueSignature;
    submittedSignature = valueSignature;
    writer.submit(value);
  }

  function observe(value: Thresholds): void {
    latest = collisionThresholdSettings(value);
    submit(latest);
  }

  async function hydrate(): Promise<void> {
    if (ready) {
      if (dirtySignature) submit(latest);
      return;
    }
    const currentGeneration = ++generation;
    const startingSignature = signature(latest);
    const result = await loadCollisionSettings(deps.origin, deps.getToken());
    if (currentGeneration !== generation) return;
    if (result.state === 'failed' || result.state === 'unavailable') {
      ready = false;
      return;
    }
    ready = true;
    if (result.state === 'empty') {
      lastSavedSignature = undefined;
      submit(latest);
      return;
    }
    if (result.state !== 'configured') return;

    const serverSignature = signature(result.thresholds);
    lastSavedSignature = serverSignature;
    submittedSignature = undefined;
    const current = collisionThresholdSettings(deps.thresholds.value);
    if (dirtySignature || signature(current) !== startingSignature) {
      latest = current;
      submit(current);
      return;
    }
    latest = result.thresholds;
    if (signature(current) !== serverSignature) {
      deps.thresholds.set(
        mergeCollisionThresholdSettings(deps.thresholds.value, result.thresholds),
      );
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
