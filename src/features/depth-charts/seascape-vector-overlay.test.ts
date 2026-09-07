import { createExpression } from '@maplibre/maplibre-gl-style-spec';
import type { ExpressionSpecification } from 'maplibre-gl';
import { chartSourceById } from 'signalk-chart-sources';
import { describe, expect, it } from 'vitest';
import { createFakeMap, declaredSource, type FakeMap, fakeOverlayContext } from '$shared/testing';
import { SEASCAPE_VECTOR_SOURCES, type SeascapeVectorSource } from './seascape-sources';
import { createSeascapeVectorOverlay } from './seascape-vector-overlay';

// Synthetic on purpose: this fixture exercises wiring, so a real catalog value here would read as
// an upstream fact and go stale whenever Seascape republishes its TileJSON.
const SOURCE: SeascapeVectorSource = {
  id: 'seascape-vector',
  tiles: ['https://tiles.example.test/vector/{z}/{x}/{y}.pbf'],
  maxzoom: 9,
  attribution: 'test attribution',
};

const ctx = (map: FakeMap) => fakeOverlayContext(map);

// The shared fake stores each layer as a loose record, so the layout object needs naming once
// rather than casting at every text-font assertion below.
const layerLayout = (map: FakeMap, id: string) =>
  map.layers.get(id)?.layout as Record<string, unknown> | undefined;

function evaluateExpression(
  expression: unknown,
  unit: 'm' | 'ft' | 'fm',
  properties: Record<string, number | string>,
): unknown {
  const parsed = createExpression(expression as ExpressionSpecification, 'seascape-label', null, {
    unit,
  });
  if (parsed.result === 'error') {
    throw new Error(parsed.value.map(({ message }) => message).join('; '));
  }
  return parsed.value.evaluate({ zoom: 12 }, { type: 'Point', properties } as never);
}

describe('createSeascapeVectorOverlay', () => {
  it('drying is a standalone fill row; contours bundles the line and both symbol layers', () => {
    const { contours, drying } = createSeascapeVectorOverlay(SOURCE);
    expect(drying.id).toBe('seascape-drying');
    expect(drying.parent).toBeUndefined();
    expect(drying.layerIds).toEqual(['seascape-drying-layer']);
    expect(contours.id).toBe('seascape-contours');
    expect(contours.layerIds).toEqual([
      'seascape-contours-line',
      'seascape-contours-label',
      'seascape-soundings-layer',
    ]);
    expect(contours.group).toBeUndefined();
    expect(drying.group).toBeUndefined();
  });

  it("declares the source's zoom ceiling on the map, so a catalog correction reaches MapLibre", async () => {
    // seascape-sources.test.ts proves the module reads maxzoom from the catalog; this proves the
    // overlay then hands it on. Either link alone lets a corrected ceiling vanish silently.
    const map = createFakeMap();
    const { drying } = createSeascapeVectorOverlay(SEASCAPE_VECTOR_SOURCES[0]);
    await drying.add(ctx(map));
    const expected = chartSourceById('seascape-vector')?.maxzoom;
    // Pinned so a missing catalog entry cannot make undefined match undefined and pass vacuously.
    expect(expected).toBeTypeOf('number');
    expect(declaredSource(map, 'seascape-vector').maxzoom).toBe(expected);
  });

  it('both rows share one vector source, created once', async () => {
    const map = createFakeMap();
    const { contours, drying } = createSeascapeVectorOverlay(SOURCE);
    await drying.add(ctx(map));
    expect(map.sources.has('seascape-vector')).toBe(true);
    await contours.add(ctx(map));
    expect(map.sources.size).toBe(1);
    expect(map.layers.get('seascape-drying-layer')?.['source-layer']).toBe('drying');
    expect(map.layers.get('seascape-contours-line')?.['source-layer']).toBe('contours');
    expect(map.layers.get('seascape-soundings-layer')?.['source-layer']).toBe('soundings');
  });

  it('both symbol layers set a text-font the base style actually serves', async () => {
    // OpenFreeMap's Liberty style (this app's base map glyph source) only serves Noto Sans;
    // MapLibre's own default text-font 404s against it. A regression here silently falls back
    // to that unset default instead of failing loudly, so this test pins the explicit value.
    const map = createFakeMap();
    const { contours } = createSeascapeVectorOverlay(SOURCE);
    await contours.add(ctx(map));
    expect(layerLayout(map, 'seascape-contours-label')?.['text-font']).toEqual([
      'Noto Sans Regular',
    ]);
    expect(layerLayout(map, 'seascape-soundings-layer')?.['text-font']).toEqual([
      'Noto Sans Regular',
    ]);
  });

  it('renders contour labels and soundings in the live depth unit', async () => {
    const map = createFakeMap();
    const { contours } = createSeascapeVectorOverlay(SOURCE);
    await contours.add(ctx(map));
    const contourText = layerLayout(map, 'seascape-contours-label')?.['text-field'];
    const soundingText = layerLayout(map, 'seascape-soundings-layer')?.['text-field'];
    const properties = { depth_abs_m: 9.144, depth_m: 9.144, depth_ft: 30 };

    expect(evaluateExpression(contourText, 'm', properties)).toBe('9.144m');
    expect(evaluateExpression(contourText, 'ft', properties)).toBe('30ft');
    expect(evaluateExpression(contourText, 'fm', properties)).toBe('5fm');
    expect(evaluateExpression(soundingText, 'm', properties)).toBe('9.144');
    expect(evaluateExpression(soundingText, 'ft', properties)).toBe('30');
    expect(evaluateExpression(soundingText, 'fm', properties)).toBe('5');
  });

  it('uses Seascape metric contour features for fathoms', async () => {
    const map = createFakeMap();
    const { contours } = createSeascapeVectorOverlay(SOURCE);
    await contours.add(ctx(map));
    const filter = map.layers.get('seascape-contours-line')?.filter;

    expect(evaluateExpression(filter, 'ft', { sys: 'ft' })).toBe(true);
    expect(evaluateExpression(filter, 'fm', { sys: 'm' })).toBe(true);
    expect(evaluateExpression(filter, 'fm', { sys: 'ft' })).toBe(false);
  });

  it('removing one row does not remove the shared source out from under the other', async () => {
    const map = createFakeMap();
    const { contours, drying } = createSeascapeVectorOverlay(SOURCE);
    await drying.add(ctx(map));
    await contours.add(ctx(map));
    contours.remove(ctx(map));
    expect(map.sources.has('seascape-vector')).toBe(true);
    expect(map.layers.has('seascape-drying-layer')).toBe(true);
    drying.remove(ctx(map));
    expect(map.sources.has('seascape-vector')).toBe(false);
  });

  it('removing rows in reverse order also preserves the shared source until both are gone', async () => {
    const map = createFakeMap();
    const { contours, drying } = createSeascapeVectorOverlay(SOURCE);
    await drying.add(ctx(map));
    await contours.add(ctx(map));
    drying.remove(ctx(map));
    expect(map.sources.has('seascape-vector')).toBe(true);
    expect(map.layers.has('seascape-contours-line')).toBe(true);
    contours.remove(ctx(map));
    expect(map.sources.has('seascape-vector')).toBe(false);
  });
});
