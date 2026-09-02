import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import InterfaceLockLayer from './InterfaceLockLayer.svelte';
import type { InterfaceLockController } from './interface-lock-controller.svelte';

function controller(locked: boolean): InterfaceLockController {
  return {
    locked,
    lock: vi.fn(),
    unlock: vi.fn(),
  };
}

describe('InterfaceLockLayer', () => {
  it('leaves only the explicit unlock control inside the full-screen modal', () => {
    const body = render(InterfaceLockLayer, { props: { controller: controller(true) } }).body;

    expect(body).toContain('<dialog');
    expect(body).toContain('aria-label="Binnacle controls locked"');
    expect(body).toContain('aria-modal="true"');
    expect(body).toContain('Hold 5 seconds to unlock Binnacle');
  });

  it('does not mount a modal while controls are unlocked', () => {
    const body = render(InterfaceLockLayer, { props: { controller: controller(false) } }).body;

    expect(body).not.toContain('<dialog');
  });
});
