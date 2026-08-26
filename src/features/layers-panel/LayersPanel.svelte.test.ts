import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { LayerListItem } from '$shared/map';
import type { AuthController } from '$shared/signalk';
import LayersPanel from './LayersPanel.svelte';
import type { LayersView } from './layers-view.svelte';

function auth(writeBlocked: boolean, upgrading = false): AuthController {
  return { writeBlocked, upgrading, requestWriteAccess: vi.fn() } as unknown as AuthController;
}

function renderPanel(
  authController: AuthController,
  items: Partial<LayerListItem>[] = [],
  mode: 'charts' | 'overlays' = 'charts',
): string {
  return render(LayersPanel, {
    props: {
      view: { items } as unknown as LayersView,
      auth: authController,
      onClose: vi.fn(),
      onManageLayer: vi.fn(),
      request: { mode },
    },
  }).body;
}

describe('LayersPanel manageable overlays', () => {
  it('exposes AIS display settings from the AIS row', () => {
    const body = renderPanel(
      auth(false),
      [
        {
          id: 'ais',
          title: 'AIS targets',
          visible: true,
          opacity: 1,
          supportsOpacity: true,
          pinned: false,
          band: 'traffic',
          available: true,
          manageable: true,
        },
      ],
      'overlays',
    );

    expect(body).toContain('aria-label="Manage AIS targets"');
  });
});

describe('LayersPanel write access', () => {
  it('offers the read/write request beside the chart-sharing block', () => {
    const body = renderPanel(auth(true));

    expect(body).toContain('Read and write access is needed to share them');
    expect(body).toContain('Request read and write access');
  });

  it('rests the request control while a request is outstanding', () => {
    expect(renderPanel(auth(true, true))).toMatch(/<button[^>]+disabled[^>]*>\s*Requesting access/);
  });

  it('leaves the note out while writes are allowed', () => {
    expect(renderPanel(auth(false))).not.toContain('Request read and write access');
  });
});

describe('LayersPanel chart guidance', () => {
  it('exposes chart stacking handles in the Charts view', () => {
    const body = renderPanel(auth(false), [
      {
        id: 'harbor-chart',
        title: 'Harbor chart',
        visible: true,
        opacity: 1,
        supportsOpacity: true,
        pinned: false,
        band: 'bathymetry',
        available: true,
        chart: {
          identifier: 'harbor',
          source: 'server',
          kind: 'vector',
          type: 'S-57',
        },
      },
      {
        id: 'coastal-chart',
        title: 'Coastal chart',
        visible: true,
        opacity: 1,
        supportsOpacity: true,
        pinned: false,
        band: 'bathymetry',
        available: true,
        chart: {
          identifier: 'coastal',
          source: 'server',
          kind: 'raster',
          type: 'tilelayer',
        },
      },
    ]);

    expect(body).toContain('drag their grips to set chart stacking');
    expect(body).toContain('aria-label="Move Harbor chart, position 1 of 2"');
    expect(body).toContain('aria-label="Move Coastal chart, position 2 of 2"');
    expect(body).toContain('aria-keyshortcuts="ArrowUp ArrowDown"');
  });

  it('explains a reference-only view and that depth shading does not count as a chart', () => {
    const body = renderPanel(auth(false));
    expect(body).toContain('No nautical chart is on');
    expect(body).toContain('does not count as a chart');
  });

  it('drops the explanation once a navigation chart is visible', () => {
    const withChart = renderPanel(auth(false), [
      { visible: true, chartCoverage: { coverage: [[-100, 15, -64, 52]] } },
    ]);
    expect(withChart).not.toContain('No nautical chart is on');
    // A depth-shading layer carries neither chart field, so it never clears the notice.
    const shadingOnly = renderPanel(auth(false), [{ visible: true }]);
    expect(shadingOnly).toContain('No nautical chart is on');
  });

  it('sets expectations for waters NOAA does not cover, beside Add a chart', () => {
    expect(renderPanel(auth(false))).toContain('Outside US waters, add your own chart here');
  });
});
