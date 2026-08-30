import { describe, expect, it } from 'vitest';
import {
  instrumentTileLayoutsCodec,
  instrumentTileSizeFor,
  resizeInstrumentTile,
} from './tile-layout';

describe('instrument tile layouts', () => {
  it('accepts bounded, named tile footprints', () => {
    expect(instrumentTileLayoutsCodec.decode({ sog: 'wide', heading: 'tall' })).toEqual({
      state: 'valid',
      value: { sog: 'wide', heading: 'tall' },
    });
    expect(instrumentTileLayoutsCodec.decode({ sog: 'enormous' })).toEqual({ state: 'invalid' });
  });

  it('uses the compact footprint when no size has been selected', () => {
    expect(instrumentTileSizeFor({}, 'sog')).toBe('normal');
  });

  it('maps the resize direction to the corresponding grid footprint', () => {
    expect(resizeInstrumentTile('normal', 20, 0)).toBe('wide');
    expect(resizeInstrumentTile('normal', 0, 20)).toBe('tall');
    expect(resizeInstrumentTile('normal', 20, 20)).toBe('large');
    expect(resizeInstrumentTile('large', -20, -20)).toBe('normal');
  });
});
