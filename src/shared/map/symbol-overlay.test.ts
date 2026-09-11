import { describe, expect, it, vi } from 'vitest';
import { createFakeMap, fakeOverlayContext } from '$shared/testing';
import { createSymbolOverlay, type SymbolOverlayConfig } from './symbol-overlay';

// The shared fake map covers the source, layer, and image surface except removeImage,
// which only this overlay exercises.
function fakeSymbolMap() {
  const base = createFakeMap();
  return { ...base, removeImage: (id: string) => base.images.delete(id) };
}

function config(): SymbolOverlayConfig {
  return {
    id: 'binnacle-ais',
    title: 'AIS targets',
    band: 'traffic',
    sourceId: 'binnacle-ais-source',
    layerId: 'binnacle-ais-symbol',
    iconId: 'binnacle-ais-icon',
    iconImage: () => ({ width: 1, height: 1 }) as ImageData,
    defaultColor: { r: 255, g: 0, b: 0, a: 255 },
    paintColor: () => ({ r: 255, g: 0, b: 0, a: 255 }),
    features: () => ({ type: 'FeatureCollection', features: [] }),
    shouldRefresh: () => false,
  };
}

describe('createSymbolOverlay', () => {
  it('adds the icon, source, and layer', async () => {
    const overlay = createSymbolOverlay(config());
    const map = fakeSymbolMap();
    await overlay.add(fakeOverlayContext(map));
    expect(map.images.has('binnacle-ais-icon')).toBe(true);
    expect(map.getSource('binnacle-ais-source')).toBeTruthy();
    expect(map.getLayer('binnacle-ais-symbol')).toBeTruthy();
  });

  it('add is idempotent when the source and layer already exist (the reattach path)', async () => {
    const overlay = createSymbolOverlay(config());
    const map = fakeSymbolMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    expect(() => overlay.add(ctx)).not.toThrow();
    expect(map.sources.size).toBe(1);
    expect(map.layers.size).toBe(1);
  });

  it('remove deletes the layer, source, and icon image', async () => {
    const overlay = createSymbolOverlay(config());
    const map = fakeSymbolMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    overlay.remove(ctx);
    expect(map.layers.size).toBe(0);
    expect(map.sources.size).toBe(0);
    expect(map.images.has('binnacle-ais-icon')).toBe(false);
  });

  it('remove tolerates an icon that is already gone', async () => {
    const overlay = createSymbolOverlay(config());
    const map = fakeSymbolMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    map.images.delete('binnacle-ais-icon');
    expect(() => overlay.remove(ctx)).not.toThrow();
  });

  it('does not invalidate a source for fresh collections with unchanged visual values', async () => {
    let longitude = 1;
    const configured = config();
    configured.shouldRefresh = () => true;
    configured.features = () => ({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [longitude, 2] },
          properties: { heading: 90 },
        },
      ],
    });
    const overlay = createSymbolOverlay(configured);
    const map = fakeSymbolMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    const source = map.sources.get('binnacle-ais-source');
    if (!source?.setData) throw new Error('symbol source was not added');
    const setData = vi.spyOn(source, 'setData');

    for (let update = 0; update < 20; update += 1) overlay.sync(ctx);
    expect(setData).not.toHaveBeenCalled();

    longitude = 1.001;
    overlay.sync(ctx);
    expect(setData).toHaveBeenCalledOnce();
  });
});
