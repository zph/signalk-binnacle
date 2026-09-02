import { describe, expect, it } from 'vitest';
import { installBrowserZoomGuard } from './browser-zoom-guard';

describe('installBrowserZoomGuard', () => {
  it('blocks browser keyboard zoom shortcuts', () => {
    const target = new EventTarget();
    const remove = installBrowserZoomGuard(target);

    for (const key of ['+', '=', '-', '_', '0']) {
      const event = Object.assign(new Event('keydown', { cancelable: true }), {
        key,
        ctrlKey: true,
        metaKey: false,
        code: '',
      }) as KeyboardEvent;
      target.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }

    const numpad = Object.assign(new Event('keydown', { cancelable: true }), {
      key: 'Unidentified',
      code: 'NumpadAdd',
      metaKey: true,
      ctrlKey: false,
    }) as KeyboardEvent;
    target.dispatchEvent(numpad);
    expect(numpad.defaultPrevented).toBe(true);
    remove();
  });

  it('leaves chart keyboard zoom alone', () => {
    const target = new EventTarget();
    const remove = installBrowserZoomGuard(target);
    const event = Object.assign(new Event('keydown', { cancelable: true }), {
      key: '+',
      ctrlKey: false,
      metaKey: false,
      code: 'Equal',
    }) as KeyboardEvent;

    target.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    remove();
  });

  it('blocks modifier-wheel page zoom but leaves ordinary map wheel input alone', () => {
    const target = new EventTarget();
    const remove = installBrowserZoomGuard(target);
    const pageZoom = Object.assign(new Event('wheel', { cancelable: true }), {
      ctrlKey: true,
      metaKey: false,
    }) as WheelEvent;
    const mapZoom = Object.assign(new Event('wheel', { cancelable: true }), {
      ctrlKey: false,
      metaKey: false,
    }) as WheelEvent;

    target.dispatchEvent(pageZoom);
    target.dispatchEvent(mapZoom);

    expect(pageZoom.defaultPrevented).toBe(true);
    expect(mapZoom.defaultPrevented).toBe(false);
    remove();
  });
});
