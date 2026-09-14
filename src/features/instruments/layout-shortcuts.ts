export function layoutSwipe(
  node: HTMLElement,
  options: { enabled: boolean; step: (direction: number) => void },
) {
  let start: { id: number; x: number; y: number; time: number } | undefined;
  let suppressClickUntil = 0;
  const begin = (event: TouchEvent) => {
    const touch = event.touches[0];
    start =
      options.enabled &&
      event.touches.length === 1 &&
      touch.clientX > 32 &&
      touch.clientX < window.innerWidth - 32 &&
      !(
        event.target instanceof Element &&
        event.target.closest(
          'input, select, textarea, a, button:not(.tile):not([data-layout-swipe])',
        )
      )
        ? { id: touch.identifier, x: touch.clientX, y: touch.clientY, time: Date.now() }
        : undefined;
  };
  const move = (event: TouchEvent) => {
    if (event.touches.length !== 1) {
      start = undefined;
      return;
    }
    const touch = event.touches[0];
    if (!start || touch.identifier !== start.id) return;
    const dx = touch.clientX - start.x,
      dy = touch.clientY - start.y;
    if (Math.abs(dy) > 24 && Math.abs(dy) > Math.abs(dx)) {
      start = undefined;
      return;
    }
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) event.preventDefault();
  };
  const end = (event: TouchEvent) => {
    const previous = start;
    start = undefined;
    if (!previous || !options.enabled || event.touches.length) return;
    const touch = Array.from(event.changedTouches).find((t) => t.identifier === previous.id);
    if (!touch) return;
    const dx = touch.clientX - previous.x,
      dy = touch.clientY - previous.y;
    if (
      Math.abs(dx) >= 60 &&
      Math.abs(dx) > Math.abs(dy) * 1.5 &&
      Date.now() - previous.time < 800
    ) {
      event.preventDefault();
      suppressClickUntil = Date.now() + 500;
      options.step(dx < 0 ? 1 : -1);
    }
  };
  const cancel = () => {
    start = undefined;
  };
  const click = (event: MouseEvent) => {
    if (Date.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  node.addEventListener('touchstart', begin, { passive: true });
  node.addEventListener('touchmove', move, { passive: false });
  node.addEventListener('touchend', end, { passive: false });
  node.addEventListener('touchcancel', cancel);
  node.addEventListener('click', click, true);
  return {
    update(next: typeof options) {
      options = next;
      start = undefined;
    },
    destroy() {
      node.removeEventListener('touchstart', begin);
      node.removeEventListener('touchmove', move);
      node.removeEventListener('touchend', end);
      node.removeEventListener('touchcancel', cancel);
      node.removeEventListener('click', click, { capture: true });
    },
  };
}
