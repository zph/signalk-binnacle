import { describe, expect, it } from 'vitest';
import {
  clampFloatingBox,
  defaultFloatingBox,
  type FloatingInstrumentBox,
  fitFloatingBoxToViewport,
  floatingInstrumentBoxesCodec,
  MAX_FLOATING_INSTRUMENTS,
  MIN_FLOATING_HEIGHT,
  MIN_FLOATING_WIDTH,
  sanitizeFloatingInstrumentBox,
  snapFloatingBoxToGrid,
} from './floating-layout';

function box(overrides: Partial<FloatingInstrumentBox> = {}): FloatingInstrumentBox {
  return { id: 'sog', x: 0.1, y: 0.1, width: 0.26, height: 0.2, ...overrides };
}

describe('sanitizeFloatingInstrumentBox', () => {
  it('passes a valid box through unchanged', () => {
    const valid = box();
    expect(sanitizeFloatingInstrumentBox(valid)).toEqual(valid);
  });

  it('clamps position against size into the chart area', () => {
    const result = sanitizeFloatingInstrumentBox(box({ x: 0.95, y: 0.95 }));
    expect(result).toEqual({ id: 'sog', x: 0.74, y: 0.8, width: 0.26, height: 0.2 });
  });

  it('clamps position at zero for negative coordinates', () => {
    const result = sanitizeFloatingInstrumentBox(box({ x: -0.5, y: -0.5 }));
    expect(result?.x).toBe(0);
    expect(result?.y).toBe(0);
  });

  it('enforces the minimum readable size', () => {
    const result = sanitizeFloatingInstrumentBox(box({ width: 0.01, height: 0.01 }));
    expect(result?.width).toBe(MIN_FLOATING_WIDTH);
    expect(result?.height).toBe(MIN_FLOATING_HEIGHT);
  });

  it('caps size at the full chart area', () => {
    const result = sanitizeFloatingInstrumentBox(box({ width: 4, height: 4 }));
    expect(result?.width).toBe(1);
    expect(result?.height).toBe(1);
  });

  it('rejects non-box shapes', () => {
    expect(sanitizeFloatingInstrumentBox(null)).toBeNull();
    expect(sanitizeFloatingInstrumentBox('sog')).toBeNull();
    expect(sanitizeFloatingInstrumentBox({ x: 0.1 })).toBeNull();
    expect(
      sanitizeFloatingInstrumentBox({ id: '', x: 0, y: 0, width: 0.26, height: 0.2 }),
    ).toBeNull();
    expect(
      sanitizeFloatingInstrumentBox({
        id: 'sog',
        x: Number.NaN,
        y: 0,
        width: 0.26,
        height: 0.2,
      }),
    ).toBeNull();
  });
});

describe('clampFloatingBox', () => {
  it('round-trips already-valid input unchanged', () => {
    const valid = box();
    expect(clampFloatingBox(valid)).toEqual(valid);
  });

  it('clamps an out-of-bounds box back into the chart area', () => {
    expect(clampFloatingBox(box({ x: 2, y: -1, width: 3 }))).toEqual(
      sanitizeFloatingInstrumentBox(box({ x: 2, y: -1, width: 3 })),
    );
  });
});

describe('snapFloatingBoxToGrid', () => {
  it('lightly snaps a moved box without changing its size', () => {
    const result = snapFloatingBoxToGrid(box({ x: 0.203, y: 0.357 }), 'move');

    expect(result).toEqual(box({ x: 0.2, y: 0.36 }));
  });

  it('leaves a moved box fluid outside the magnetic tolerance', () => {
    const unsnapped = box({ x: 0.209, y: 0.351 });

    expect(snapFloatingBoxToGrid(unsnapped, 'move')).toEqual(unsnapped);
  });

  it('snaps trailing edges during resize without moving the leading edges', () => {
    const resized = box({ x: 0.103, y: 0.107, width: 0.298, height: 0.294 });
    const result = snapFloatingBoxToGrid(resized, 'resize');

    expect(result.x).toBe(0.103);
    expect(result.y).toBe(0.107);
    expect(result.x + result.width).toBeCloseTo(0.4);
    expect(result.y + result.height).toBeCloseTo(0.4);
  });
});

describe('defaultFloatingBox', () => {
  it('places at the supplied point when it fits', () => {
    expect(defaultFloatingBox({ x: 0.4, y: 0.3 }, 'depth')).toEqual({
      id: 'depth',
      x: 0.4,
      y: 0.3,
      width: 0.26,
      height: 0.2,
    });
  });

  it('clamps a supplied point back inside the chart area', () => {
    expect(defaultFloatingBox({ x: 1.5, y: -0.5 }, 'depth')).toEqual({
      id: 'depth',
      x: 0.74,
      y: 0,
      width: 0.26,
      height: 0.2,
    });
  });

  it('falls back to its default position without a point', () => {
    expect(defaultFloatingBox(undefined, 'depth').x).toBeGreaterThan(0);
    expect(defaultFloatingBox(undefined, 'depth').y).toBeGreaterThan(0);
  });

  it('accepts a specialized default footprint', () => {
    expect(
      defaultFloatingBox({ x: 0.2, y: 0.1 }, 'tws-history', { width: 0.16, height: 0.48 }),
    ).toEqual({
      id: 'tws-history',
      x: 0.2,
      y: 0.1,
      width: 0.16,
      height: 0.48,
    });
  });
});

describe('fitFloatingBoxToViewport', () => {
  it('keeps a right and bottom mounted tile inside a narrow rotated chart', () => {
    const saved = { id: 'depth', x: 0.74, y: 0.8, width: 0.26, height: 0.2 };
    const originalViewport = { width: 1200, height: 800 };
    const aspectRatio =
      (saved.width * originalViewport.width) / (saved.height * originalViewport.height);
    const result = fitFloatingBoxToViewport(saved, { width: 300, height: 200 }, aspectRatio);

    expect(result.x).toBeCloseTo(0.584);
    expect(result.y).toBeCloseTo(0.68);
    expect(result.width).toBeCloseTo(0.416);
    expect(result.height).toBeCloseTo(0.32);
    expect(result.x + result.width).toBe(1);
    expect(result.y + result.height).toBe(1);
    expect((result.width * 300) / (result.height * 200)).toBeCloseTo(aspectRatio);
  });

  it('leaves an interior tile unchanged after rotating back to a wide chart', () => {
    const saved = { id: 'depth', x: 0.2, y: 0.3, width: 0.26, height: 0.2 };

    expect(fitFloatingBoxToViewport(saved, { width: 1024, height: 768 })).toEqual(saved);
  });

  it('preserves pixel aspect ratio and screen coverage through a device rotation', () => {
    const saved = { id: 'depth', x: 0.2, y: 0.3, width: 0.3, height: 0.25 };
    const landscape = { width: 1200, height: 700 };
    const portrait = { width: 700, height: 1200 };
    const aspectRatio = (saved.width * landscape.width) / (saved.height * landscape.height);

    const rotated = fitFloatingBoxToViewport(saved, portrait, aspectRatio);

    expect(rotated.width * rotated.height).toBeCloseTo(saved.width * saved.height);
    expect((rotated.width * portrait.width) / (rotated.height * portrait.height)).toBeCloseTo(
      aspectRatio,
    );
    expect(rotated.x + rotated.width / 2).toBeCloseTo(saved.x + saved.width / 2);
    expect(rotated.y + rotated.height / 2).toBeCloseTo(saved.y + saved.height / 2);
  });
});

describe('floatingInstrumentBoxesCodec', () => {
  it('decodes a valid array as valid', () => {
    const result = floatingInstrumentBoxesCodec.decode([box()]);
    expect(result.state).toBe('valid');
    if (result.state !== 'invalid') expect(result.value).toEqual([box()]);
  });

  it('migrates an out-of-bounds box to its clamped copy', () => {
    const drifted = box({ x: 0.95 });
    const result = floatingInstrumentBoxesCodec.decode([drifted]);
    expect(result.state).toBe('migrated');
    if (result.state !== 'invalid') {
      expect(result.value).toEqual([{ ...drifted, x: 0.74 }]);
    }
  });

  it('rejects the whole array when any item is structurally invalid', () => {
    expect(floatingInstrumentBoxesCodec.decode([box(), { id: 'sog' }]).state).toBe('invalid');
    expect(floatingInstrumentBoxesCodec.decode([{ id: 'sog' }]).state).toBe('invalid');
  });

  it('rejects an array longer than MAX_FLOATING_INSTRUMENTS', () => {
    const oversized = Array.from({ length: MAX_FLOATING_INSTRUMENTS + 1 }, (_, i) =>
      box({ id: `tile-${i}` }),
    );
    expect(floatingInstrumentBoxesCodec.decode(oversized).state).toBe('invalid');
  });

  it('decodes an empty array as valid', () => {
    expect(floatingInstrumentBoxesCodec.decode([]).state).toBe('valid');
  });
});
