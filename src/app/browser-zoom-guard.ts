const PAGE_ZOOM_KEYS = new Set(['+', '=', '-', '_', '0']);
const PAGE_ZOOM_CODES = new Set([
  'Equal',
  'Minus',
  'Digit0',
  'NumpadAdd',
  'NumpadSubtract',
  'Numpad0',
]);

function isPageZoomShortcut(event: KeyboardEvent): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    (PAGE_ZOOM_KEYS.has(event.key) || PAGE_ZOOM_CODES.has(event.code))
  );
}

// A chartplotter must retain its fixed operating layout. Chrome's page zoom can otherwise make
// critical instruments unreachable without changing the chart scale. Map zoom remains available
// through its ordinary keyboard, wheel, and pinch gestures.
export function installBrowserZoomGuard(target: EventTarget = window): () => void {
  const preventKeyboardZoom = (event: Event): void => {
    if (isPageZoomShortcut(event as KeyboardEvent)) event.preventDefault();
  };
  const preventWheelZoom = (event: Event): void => {
    const wheelEvent = event as WheelEvent;
    if (wheelEvent.ctrlKey || wheelEvent.metaKey) event.preventDefault();
  };

  target.addEventListener('keydown', preventKeyboardZoom, true);
  target.addEventListener('wheel', preventWheelZoom, { capture: true, passive: false });

  return () => {
    target.removeEventListener('keydown', preventKeyboardZoom, true);
    target.removeEventListener('wheel', preventWheelZoom, true);
  };
}
