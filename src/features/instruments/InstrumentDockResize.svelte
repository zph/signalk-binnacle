<script lang="ts">
import {
  clampInstrumentDockWidth,
  MAX_INSTRUMENT_DOCK_WIDTH_PX,
  MIN_INSTRUMENT_DOCK_WIDTH_PX,
} from './dock-width';

interface Props {
  width: number;
  onResize: (width: number) => void;
  onCommit: (width: number) => void;
}

const { width, onResize, onCommit }: Props = $props();
let pointerId: number | undefined;
let startX = 0;
let startWidth = 0;
let dragWidth = 0;

function bounded(next: number): number {
  return clampInstrumentDockWidth(next, window.innerWidth);
}

function handlePointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  pointerId = event.pointerId;
  startX = event.clientX;
  startWidth = width;
  dragWidth = width;
  event.currentTarget instanceof Element && event.currentTarget.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function handlePointerMove(event: PointerEvent): void {
  if (pointerId !== event.pointerId) return;
  dragWidth = bounded(startWidth + startX - event.clientX);
  onResize(dragWidth);
}

function finishPointer(event: PointerEvent): void {
  if (pointerId !== event.pointerId) return;
  pointerId = undefined;
  onCommit(dragWidth);
}

function handleKeydown(event: KeyboardEvent): void {
  let next: number | undefined;
  if (event.key === 'ArrowLeft') next = width + 16;
  if (event.key === 'ArrowRight') next = width - 16;
  if (event.key === 'Home') next = MIN_INSTRUMENT_DOCK_WIDTH_PX;
  if (event.key === 'End') next = MAX_INSTRUMENT_DOCK_WIDTH_PX;
  if (next === undefined) return;
  event.preventDefault();
  const value = bounded(next);
  onResize(value);
  onCommit(value);
}
</script>

<div
  class="dock-resize"
  role="slider"
  aria-label="Resize instruments dock"
  aria-orientation="vertical"
  aria-valuemin={MIN_INSTRUMENT_DOCK_WIDTH_PX}
  aria-valuemax={MAX_INSTRUMENT_DOCK_WIDTH_PX}
  aria-valuenow={Math.round(width)}
  aria-valuetext={`${Math.round(width)} pixels wide`}
  tabindex="0"
  onpointerdown={handlePointerDown}
  onpointermove={handlePointerMove}
  onpointerup={finishPointer}
  onpointercancel={finishPointer}
  onkeydown={handleKeydown}
></div>

<style>
.dock-resize {
  position: absolute;
  z-index: var(--z-overlay);
  inset-block: 0;
  /* Keep the full touch target on the chart side of the divider. Centering it on the border made
     its invisible half cover the first control in every customization row. */
  inset-inline-start: calc(-1 * var(--control-size));
  inline-size: var(--control-size);
  cursor: ew-resize;
  touch-action: none;
}
.dock-resize::after {
  content: "";
  position: absolute;
  inset-block: var(--space-2);
  inset-inline-end: 0;
  inline-size: 3px;
  border-radius: var(--radius-pill);
  background: var(--border);
  transition: background var(--transition-fast);
}
.dock-resize:hover::after,
.dock-resize:focus-visible::after {
  background: var(--accent);
}
@media (max-width: 900px) {
  .dock-resize {
    display: none;
  }
}
</style>
