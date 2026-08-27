import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import AppMenu from './AppMenu.svelte';
import APP_MENU_SOURCE from './AppMenu.svelte?raw';
import type { MenuItem } from './menu-item';

function renderMenu(items: MenuItem[]): string {
  return render(AppMenu, {
    props: { items, open: true, onOpenChange: () => {} },
  }).body;
}

function item(id: string, overrides: Partial<MenuItem> = {}): MenuItem {
  return { id, label: id, onSelect: () => {}, ...overrides };
}

describe('AppMenu count badge', () => {
  it('renders the count chip and its spoken suffix on a tile', () => {
    const body = renderMenu([item('alarms', { label: 'Alarms', count: 2 })]);

    expect(body).toContain('pill-count');
    expect(body).toMatch(/2 active/);
  });

  it('renders no chip for a tile without an active count', () => {
    const body = renderMenu([item('alarms', { label: 'Alarms' })]);

    expect(body).toContain('Alarms');
    expect(body).not.toContain('pill-count');
    expect(body).not.toMatch(/\d+ active/);
  });

  it('caps the tile chip at 99+ while the spoken suffix keeps the real count', () => {
    const body = renderMenu([item('alarms', { label: 'Alarms', count: 240 })]);

    expect(body).toContain('99+');
    expect(body).toMatch(/240 active/);
  });

  it('names the counted thing, singular and plural, when the item carries a noun', () => {
    const one = renderMenu([item('alarms', { label: 'Alarms', count: 1, countNoun: 'alarm' })]);
    const three = renderMenu([item('alarms', { label: 'Alarms', count: 3, countNoun: 'alarm' })]);

    expect(one).toContain('1 active alarm');
    expect(three).toContain('3 active alarms');
  });
});

describe('AppMenu group order', () => {
  it('renders the groups in the order of the items it is given', () => {
    const body = renderMenu([
      item('center', { group: 'Map' }),
      item('routes', { group: 'Navigate' }),
      item('alarms', { group: 'Safety' }),
    ]);

    const rendered = [...body.matchAll(/aria-label="(Map|Navigate|Safety)"/g)].map(
      (match) => match[1],
    );
    expect(rendered).toEqual(['Map', 'Navigate', 'Safety']);
  });

  // One order at every viewport. The phone-width CSS that reordered the groups gave a navigator two
  // mental models of the same chartplotter, and a rendered-DOM assertion cannot see CSS, so the
  // guard is on the source: no per-group hook and no order declaration to hang one on.
  it('carries no viewport-dependent group reorder', () => {
    expect(APP_MENU_SOURCE).not.toContain('data-group');
    expect(APP_MENU_SOURCE).not.toMatch(/\border:\s*\d/);
  });
});

describe('AppMenu edge dock', () => {
  it('keeps an attached visibility tab rendered while the dock is collapsed', () => {
    const collapsed = render(AppMenu, {
      props: { items: [], open: false, onOpenChange: () => {} },
    }).body;
    const expanded = render(AppMenu, {
      props: { items: [], open: true, onOpenChange: () => {} },
    }).body;

    expect(collapsed).toContain('aria-label="App menu visibility"');
    expect(collapsed).toContain('aria-expanded="false"');
    expect(collapsed).toContain('title="Show menu"');
    expect(collapsed).not.toContain('id="app-menu-launcher"');
    expect(expanded).toContain('aria-expanded="true"');
    expect(expanded).toContain('title="Hide menu"');
    expect(expanded).toContain('id="app-menu-launcher"');
  });

  it('is an in-flow edge dock rather than an anchored popover', () => {
    expect(APP_MENU_SOURCE).toContain('class="app-menu-dock"');
    expect(APP_MENU_SOURCE).toContain('inset-inline-start: 100%');
    expect(APP_MENU_SOURCE).not.toContain('AnchoredMenu');
  });
});

describe('AppMenu fixed bottom-bar actions', () => {
  it('shows a fixed action as selected in edit mode without adding it to the reorder list', () => {
    const body = render(AppMenu, {
      props: {
        items: [
          item('center', { group: 'Chart' }),
          item('instruments', { fixedToBar: true, group: 'Instruments' }),
        ],
        open: true,
        onOpenChange: () => {},
        editing: true,
        pinnedIds: ['center', 'instruments'],
      },
    }).body;

    expect(body).toContain('Fixed actions stay shown.');
    expect(body).toMatch(/aria-pressed="true"[^>]*>[\s\S]*instruments/);
    expect(body.match(/Move instruments/g)).toBeNull();
  });
});
