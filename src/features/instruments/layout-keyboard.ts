export function installLayoutKeyboard(
  enabled: () => boolean,
  step: (direction: number) => void,
  target: Window = window,
): () => void {
  const handle = (event: KeyboardEvent) => {
    if (
      !enabled() ||
      event.defaultPrevented ||
      event.repeat ||
      !event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey ||
      !['ArrowLeft', 'ArrowRight'].includes(event.key)
    )
      return;
    if (
      event.target instanceof Element &&
      event.target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    step(event.key === 'ArrowRight' ? 1 : -1);
  };
  target.addEventListener('keydown', handle, true);
  return () => target.removeEventListener('keydown', handle, { capture: true });
}
