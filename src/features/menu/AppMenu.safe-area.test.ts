import { describe, expect, it } from 'vitest';
import APP_MENU from './AppMenu.svelte?raw';

describe('left app-menu safe-area clearance', () => {
  it('keeps the dock content and attached tab clear of leading and top system chrome', () => {
    expect(APP_MENU).toContain('env(safe-area-inset-left, 0px)');
    expect(APP_MENU).toContain('env(safe-area-inset-top)');
  });
});
