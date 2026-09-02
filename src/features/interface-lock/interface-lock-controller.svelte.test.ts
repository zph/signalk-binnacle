import { describe, expect, it } from 'vitest';
import { createInterfaceLockController } from './interface-lock-controller.svelte';

describe('createInterfaceLockController', () => {
  it('locks only for the current page session', () => {
    const controller = createInterfaceLockController();

    expect(controller.locked).toBe(false);
    controller.lock();
    expect(controller.locked).toBe(true);

    // A new application instance represents a reload, including a forced service-worker update.
    expect(createInterfaceLockController().locked).toBe(false);
    controller.unlock();
    expect(controller.locked).toBe(false);
  });
});
