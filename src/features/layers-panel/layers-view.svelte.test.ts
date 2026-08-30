import { describe, expect, it, vi } from 'vitest';
import type { LayerListItem, OverlayContext, OverlayModule } from '$shared/map';
import { LayerManager } from '$shared/map';
import { fakeOverlayContext } from '$shared/testing';
import { LayersView } from './layers-view.svelte';

// The empty map is load-bearing: any direct map access from the view would throw, proving the
// view goes through the LayerManager only.
const fakeCtx = (): OverlayContext => fakeOverlayContext({});

function fakeOverlay(id: string): OverlayModule {
  return {
    id,
    title: id.toUpperCase(),
    band: 'basemap',
    supportsOpacity: true,
    layerIds: [id],
    add: () => {},
    remove: () => {},
    setVisible: () => {},
    setOpacity: () => {},
  };
}

function itemWithDepthDisplayControl(): LayerListItem {
  return {
    id: 'cells',
    title: 'Cells',
    visible: true,
    opacity: 1,
    supportsOpacity: true,
    pinned: false,
    band: 'bathymetry',
    available: true,
    depthDisplayControl: true,
    displayDepth: 'conservative',
    cellPortrayal: 'shaded',
  };
}

describe('LayersView', () => {
  it('reflects the manager snapshot', async () => {
    const manager = new LayerManager(fakeCtx());
    await manager.register(fakeOverlay('noaa'));
    const view = new LayersView(manager);
    view.refresh();
    expect(view.items.map((i) => i.title)).toEqual(['NOAA']);
  });

  it('toggle delegates to the manager and refreshes', async () => {
    const manager = new LayerManager(fakeCtx());
    await manager.register(fakeOverlay('noaa'));
    const view = new LayersView(manager);
    view.refresh();
    view.toggle('noaa', false);
    expect(view.items[0].visible).toBe(false);
  });

  it('setOpacity delegates and refreshes', async () => {
    const manager = new LayerManager(fakeCtx());
    await manager.register(fakeOverlay('noaa'));
    const view = new LayersView(manager);
    view.refresh();
    view.setOpacity('noaa', 0.3);
    expect(view.items[0].opacity).toBe(0.3);
  });

  it('sets a provider cell-size scale and updates the live readout', () => {
    const setCellSizeScale = vi.fn();
    const manager = { setCellSizeScale } as unknown as LayerManager;
    const view = new LayersView(manager);
    view.items = [
      {
        id: 'cells',
        title: 'Cells',
        visible: true,
        opacity: 1,
        supportsOpacity: true,
        pinned: false,
        band: 'bathymetry',
        available: true,
        cellSizeControl: {
          queryParameter: 'cellScale',
          minimum: 0.5,
          maximum: 4,
          step: 0.25,
          default: 1,
        },
        cellSizeScale: 1,
      },
    ];

    view.setCellSizeScale('cells', 1.68, false);

    expect(setCellSizeScale).toHaveBeenCalledWith('cells', 1.68, false);
    expect(view.items[0].cellSizeScale).toBe(1.75);
  });

  it('sets the Binnacle depth-label scale and updates the live readout', () => {
    const setLabelSizeScale = vi.fn();
    const manager = { setLabelSizeScale } as unknown as LayerManager;
    const view = new LayersView(manager);
    view.items = [
      {
        id: 'cells',
        title: 'Cells',
        visible: true,
        opacity: 1,
        supportsOpacity: true,
        pinned: false,
        band: 'bathymetry',
        available: true,
        labelSizeControl: {
          queryParameter: 'labelSizeScale',
          minimum: 0.5,
          maximum: 2,
          step: 0.1,
          default: 1,
        },
        labelSizeScale: 1,
      },
    ];

    view.setLabelSizeScale('cells', 1.76, false);

    expect(setLabelSizeScale).toHaveBeenCalledWith('cells', 1.76, false);
    expect(view.items[0].labelSizeScale).toBeCloseTo(1.8);
  });

  it('sets the bathymetry depth-display choice in place', () => {
    const setDisplayDepth = vi.fn();
    const manager = { setDisplayDepth } as unknown as LayerManager;
    const view = new LayersView(manager);
    view.items = [itemWithDepthDisplayControl()];

    view.setDisplayDepth('cells', 'predicted');

    expect(setDisplayDepth).toHaveBeenCalledWith('cells', 'predicted');
    expect(view.items[0].displayDepth).toBe('predicted');
  });

  it('sets the bathymetry cell portrayal in place', () => {
    const setCellPortrayal = vi.fn();
    const manager = { setCellPortrayal } as unknown as LayerManager;
    const view = new LayersView(manager);
    view.items = [itemWithDepthDisplayControl()];

    view.setCellPortrayal('cells', 'text');

    expect(setCellPortrayal).toHaveBeenCalledWith('cells', 'text');
    expect(view.items[0].cellPortrayal).toBe('text');
  });

  it('passes only the filtered chart order to the manager', () => {
    const listItem = (
      id: string,
      band: LayerListItem['band'],
      category: string,
    ): LayerListItem => ({
      id,
      title: id,
      visible: true,
      opacity: 1,
      supportsOpacity: true,
      pinned: false,
      band,
      category,
      available: true,
    });
    const items = [
      listItem('traffic', 'traffic', 'live'),
      listItem('chart-a', 'bathymetry', 'charts'),
      listItem('reference', 'safety', 'reference'),
      listItem('chart-b', 'bathymetry', 'charts'),
      listItem('route', 'routes', 'mine'),
    ];
    const reorderSubset = vi.fn();
    const manager = {
      layers: () => items,
      reorderSubset,
    } as unknown as LayerManager;
    const view = new LayersView(manager);
    view.items = items;

    view.reorderSubset('chart-a', ['chart-a', 'chart-b'], 1);

    expect(reorderSubset).toHaveBeenCalledWith('chart-a', ['chart-a', 'chart-b'], 1);
  });
});
