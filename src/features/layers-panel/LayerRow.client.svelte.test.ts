import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LayerListItem } from '$shared/map';
import LayerRow from './LayerRow.svelte';
import type { LayersView } from './layers-view.svelte';

const mounted: Array<() => void> = [];
const noop = (): void => {};
const view = { toggle: noop, setOpacity: noop } as unknown as LayersView;

function mountRow(
  overrides: Partial<LayerListItem> = {},
  rowView: LayersView = view,
  subLayers: LayerListItem[] = [],
): HTMLElement {
  const target = document.createElement('div');
  document.body.append(target);
  const item: LayerListItem = {
    id: 'depth',
    title: 'Depth',
    visible: true,
    opacity: 0.85,
    supportsOpacity: true,
    pinned: false,
    band: 'overlay-top',
    available: true,
    ...overrides,
  };
  let component!: ReturnType<typeof mount>;
  flushSync(() => {
    component = mount(LayerRow, {
      target,
      props: {
        item,
        view: rowView,
        index: 0,
        count: 1,
        dragging: false,
        dropBefore: false,
        dropAfter: false,
        onHandlePointerDown: noop,
        onHandleKeydown: noop,
        subLayers,
      },
    });
  });
  mounted.push(() => {
    void unmount(component);
    target.remove();
  });
  return target;
}

function openOpacity(target: HTMLElement): void {
  const trigger = target.querySelector<HTMLButtonElement>('[aria-label="Adjust Depth opacity"]');
  if (!trigger) throw new Error('no opacity trigger');
  trigger.click();
  flushSync();
}

afterEach(() => {
  for (const dispose of mounted.splice(0).reverse()) dispose();
});

describe('LayerRow opacity popover', () => {
  it('exposes the popover as a group, not a modal dialog', () => {
    const target = mountRow();
    openOpacity(target);

    const surface = target.querySelector('.anchored-menu-surface');
    expect(surface?.getAttribute('role')).toBe('group');
    expect(surface?.getAttribute('aria-label')).toBe('Depth opacity');
    const trigger = target.querySelector('[aria-label="Adjust Depth opacity"]');
    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    expect(trigger?.hasAttribute('aria-haspopup')).toBe(false);
  });

  it('announces the opacity as a percentage rather than a raw fraction', () => {
    const target = mountRow();
    openOpacity(target);

    const slider = target.querySelector('input[type="range"]');
    expect(slider?.getAttribute('aria-valuetext')).toBe('85%');
  });

  it('keeps slider input transient and persists only the committed change', () => {
    const setOpacity = vi.fn();
    const rowView = { toggle: noop, setOpacity } as unknown as LayersView;
    const target = mountRow({}, rowView);
    openOpacity(target);
    const slider = target.querySelector<HTMLInputElement>('input[type="range"]');
    if (!slider) throw new Error('no opacity slider');

    slider.value = '0.8';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.value = '0.75';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));

    expect(setOpacity.mock.calls).toEqual([
      ['depth', 0.8, false],
      ['depth', 0.75, false],
      ['depth', 0.75],
    ]);
  });
});

describe('LayerRow visibility', () => {
  it('uses the name area as the visibility toggle', () => {
    const toggle = vi.fn();
    const rowView = { toggle, setOpacity: noop } as unknown as LayersView;
    const target = mountRow({}, rowView);
    const control = target.querySelector<HTMLButtonElement>(
      'button.layer-toggle[aria-pressed="true"]',
    );

    control?.click();

    expect(toggle).toHaveBeenCalledWith('depth', false);
    expect(target.querySelector('input[type="checkbox"]')).toBeNull();
  });
});

describe('LayerRow child-layer disclosure', () => {
  it('opens from the caret and commits opacity to the selected child id', () => {
    const setOpacity = vi.fn();
    const rowView = { toggle: noop, setOpacity } as unknown as LayersView;
    const target = mountRow({ title: 'NOAA ENC California' }, rowView, [
      {
        id: 'depth:facet:soundings',
        title: 'Soundings and contours',
        visible: true,
        opacity: 0.75,
        supportsOpacity: true,
        pinned: false,
        band: 'basemap',
        parent: 'depth',
        available: true,
      },
    ]);
    const caret = target.querySelector<HTMLButtonElement>(
      '[aria-label="Show NOAA ENC California child layers"]',
    );
    if (!caret) throw new Error('no chart-layer caret');
    const childGroup = target.querySelector<HTMLElement>(
      '[aria-label="NOAA ENC California child layers"]',
    );
    expect(childGroup?.hidden).toBe(true);

    caret.click();
    flushSync();

    expect(childGroup?.hidden).toBe(false);
    const opacity = target.querySelector<HTMLButtonElement>(
      '[aria-label="Adjust Soundings and contours opacity"]',
    );
    if (!opacity) throw new Error('no child opacity control');
    opacity.click();
    flushSync();
    const slider = target.querySelector<HTMLInputElement>(
      'input[aria-label="Soundings and contours opacity"]',
    );
    if (!slider) throw new Error('no child opacity slider');
    slider.value = '0.6';
    slider.dispatchEvent(new Event('change', { bubbles: true }));

    expect(setOpacity).toHaveBeenCalledWith('depth:facet:soundings', 0.6);
  });

  it('shows a disabled caret for a chart without child layers', () => {
    const target = mountRow({
      title: 'Open Maps',
      chart: { identifier: 'open-maps', source: 'server', kind: 'vector', type: 'MVT' },
    });

    const caret = target.querySelector<HTMLButtonElement>('.facet-caret');
    expect(caret?.disabled).toBe(true);
    expect(caret?.getAttribute('aria-label')).toBe('No child layers for Open Maps');
  });
});
