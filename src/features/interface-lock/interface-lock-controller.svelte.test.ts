import { describe, expect, it } from 'vitest';
import { booleanPersistedCodec, PersistedValue } from '$shared/settings';
import { createFakeStorage } from '$shared/testing';
import { createInterfaceLockController } from './interface-lock-controller.svelte';

describe('createInterfaceLockController', () => {
  it('persists the locked state until it is explicitly unlocked', () => {
    const key = 'binnacle-custom:interface-lock-test';
    const storage = createFakeStorage();
    const persisted = new PersistedValue(key, false, storage, booleanPersistedCodec);
    const controller = createInterfaceLockController(persisted);

    expect(controller.locked).toBe(false);
    controller.lock();
    expect(controller.locked).toBe(true);

    const restored = createInterfaceLockController(
      new PersistedValue(key, false, storage, booleanPersistedCodec),
    );
    expect(restored.locked).toBe(true);

    restored.unlock();
    expect(restored.locked).toBe(false);
    expect(JSON.parse(storage.data.get(key) ?? 'null')).toBe(false);
  });
});
