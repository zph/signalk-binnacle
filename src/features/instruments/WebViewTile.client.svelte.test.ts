import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TileDef } from './tile-catalog';
import WebViewTile from './WebViewTile.svelte';

const mounted: Array<() => void> = [];

afterEach(() => {
  for (const dispose of mounted.splice(0).reverse()) dispose();
});

function webviewDef(kind: 'app' | 'link'): TileDef {
  return {
    id: `webview:${kind}:fixture`,
    label: 'Tides and currents',
    abbr: 'WEB',
    description: 'Tides and currents web view.',
    sensorGloss: 'Web view unavailable',
    paths: [],
    zonesPath: '',
    category: 'apps',
    kind: 'webview',
    webview: { url: 'about:blank', kind },
    read: () => ({ state: 'live', value: 'WEB', unit: '', secondary: 'Web view' }),
  };
}

function mountTile(
  kind: 'app' | 'link',
  onOpen: () => void = () => {},
  expanded = false,
): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  let component!: ReturnType<typeof mount>;
  flushSync(() => {
    component = mount(WebViewTile, {
      target: host,
      props: {
        def: webviewDef(kind),
        label: 'Tides and currents',
        reading: { state: 'live', value: 'WEB', unit: '' },
        expanded,
        actionLabel: expanded ? 'Collapse instrument' : 'Expand instrument',
        onOpen,
      },
    });
  });
  mounted.push(() => {
    void unmount(component);
    host.remove();
  });
  return host;
}

describe('WebViewTile', () => {
  it('labels the section, the frame, and its two controls accessibly', () => {
    const host = mountTile('app');
    const section = host.querySelector('section.webview-tile');
    expect(section?.getAttribute('aria-label')).toBe('Tides and currents, web view');
    const frame = host.querySelector('iframe');
    expect(frame?.getAttribute('title')).toBe('Tides and currents');
    expect(host.querySelector('button[aria-label="Reload Tides and currents"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Expand instrument"]')).not.toBeNull();
    expect(
      host.querySelector('[role="group"][aria-label="Tides and currents controls"]'),
    ).not.toBeNull();
  });

  it('sandboxes same-origin apps with their origin preserved', () => {
    const host = mountTile('app');
    expect(host.querySelector('iframe')?.getAttribute('sandbox')).toBe(
      'allow-scripts allow-same-origin allow-forms',
    );
  });

  it('gives external links an opaque sandboxed origin', () => {
    const host = mountTile('link');
    expect(host.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts allow-forms');
  });

  it('clears the loading note once the frame reports load', () => {
    const host = mountTile('app');
    // about:blank may report load during the mount flush; only the clearing is asserted.
    host.querySelector('iframe')?.dispatchEvent(new Event('load'));
    expect(host.textContent).not.toContain('Loading…');
  });

  it('remounts the frame on reload and requests the expand through the open control', () => {
    const onOpen = vi.fn();
    const host = mountTile('app', onOpen);
    const before = host.querySelector('iframe');
    flushSync(() =>
      host
        .querySelector<HTMLButtonElement>('button[aria-label="Reload Tides and currents"]')
        ?.click(),
    );
    expect(host.querySelector('iframe')).not.toBe(before);

    flushSync(() =>
      host.querySelector<HTMLButtonElement>('button[aria-label="Expand instrument"]')?.click(),
    );
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('shows a top-right close control when expanded', () => {
    const host = mountTile('app', () => {}, true);
    expect(host.querySelector('button[aria-label="Close Tides and currents"]')).not.toBeNull();
  });
});
