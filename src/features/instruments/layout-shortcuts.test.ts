import { afterEach, describe, expect, it, vi } from 'vitest';
import { installLayoutKeyboard } from './layout-keyboard';
import { layoutSwipe } from './layout-shortcuts';

class TestElement extends EventTarget {
  editable = false;
  closest() {
    return this.editable ? this : null;
  }
}
function event(type: string, fields: Record<string, unknown>) {
  return Object.assign(new Event(type, { cancelable: true }), fields);
}

describe('instrument layout shortcuts', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('switches with Cmd arrows, but not while typing, repeating, disabled, or using other modifiers', () => {
    vi.stubGlobal('Element', TestElement);
    const target = new TestElement();
    const step = vi.fn();
    let enabled = true;
    const remove = installLayoutKeyboard(() => enabled, step, target as unknown as Window);
    const key = (fields: Record<string, unknown> = {}) =>
      target.dispatchEvent(event('keydown', { key: 'ArrowRight', metaKey: true, ...fields }));
    expect(key()).toBe(false);
    expect(step).toHaveBeenLastCalledWith(1);
    key({ key: 'ArrowLeft' });
    expect(step).toHaveBeenLastCalledWith(-1);
    for (const fields of [
      { repeat: true },
      { shiftKey: true },
      { altKey: true },
      { ctrlKey: true },
      { metaKey: false },
      { key: 'k' },
    ])
      key(fields);
    target.editable = true;
    key();
    target.editable = false;
    enabled = false;
    key();
    expect(step).toHaveBeenCalledTimes(2);
    remove();
    enabled = true;
    key();
    expect(step).toHaveBeenCalledTimes(2);
  });

  it('recognizes one-finger horizontal swipes and suppresses the resulting click', () => {
    vi.stubGlobal('Element', TestElement);
    vi.stubGlobal('window', { innerWidth: 1000 });
    const node = new TestElement();
    const step = vi.fn();
    const action = layoutSwipe(node as unknown as HTMLElement, { enabled: true, step });
    const touch = (x: number, y = 100) => ({ identifier: 1, clientX: x, clientY: y });
    const send = (type: string, touches: ReturnType<typeof touch>[], changedTouches = touches) =>
      node.dispatchEvent(event(type, { touches, changedTouches }));
    send('touchstart', [touch(200)]);
    expect(send('touchmove', [touch(100)])).toBe(false);
    expect(send('touchend', [], [touch(100)])).toBe(false);
    expect(step).toHaveBeenLastCalledWith(1);
    expect(node.dispatchEvent(new Event('click', { cancelable: true }))).toBe(false);
    send('touchstart', [touch(100)]);
    send('touchend', [], [touch(200)]);
    expect(step).toHaveBeenLastCalledWith(-1);
    action.destroy();
    send('touchstart', [touch(100)]);
    send('touchend', [], [touch(200)]);
    expect(step).toHaveBeenCalledTimes(2);
  });

  it('rejects edges, multitouch, vertical moves, short swipes, cancellation, and edit mode', () => {
    vi.stubGlobal('Element', TestElement);
    vi.stubGlobal('window', { innerWidth: 1000 });
    const node = new TestElement();
    const step = vi.fn();
    const action = layoutSwipe(node as unknown as HTMLElement, { enabled: true, step });
    const touch = (x: number, y = 100, identifier = 1) => ({ identifier, clientX: x, clientY: y });
    const send = (type: string, touches: ReturnType<typeof touch>[], changedTouches = touches) =>
      node.dispatchEvent(event(type, { touches, changedTouches }));
    for (const x of [20, 980]) {
      send('touchstart', [touch(x)]);
      send('touchend', [], [touch(x + 100)]);
    }
    send('touchstart', [touch(100), touch(150, 100, 2)]);
    send('touchend', [], [touch(250)]);
    send('touchstart', [touch(100)]);
    send('touchmove', [touch(105, 200)]);
    send('touchend', [], [touch(250)]);
    send('touchstart', [touch(100)]);
    send('touchend', [], [touch(120)]);
    send('touchstart', [touch(100)]);
    send('touchcancel', []);
    send('touchend', [], [touch(250)]);
    send('touchstart', [touch(100)]);
    action.update({ enabled: false, step });
    send('touchend', [], [touch(250)]);
    expect(step).not.toHaveBeenCalled();
    action.destroy();
  });
});
