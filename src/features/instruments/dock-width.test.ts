import { describe, expect, it } from 'vitest';
import {
  clampInstrumentDockWidth,
  MAX_INSTRUMENT_DOCK_WIDTH_PX,
  MIN_INSTRUMENT_DOCK_WIDTH_PX,
} from './dock-width';

describe('instrument dock width', () => {
  it('clamps to the configured width range', () => {
    expect(clampInstrumentDockWidth(100, 1600)).toBe(MIN_INSTRUMENT_DOCK_WIDTH_PX);
    expect(clampInstrumentDockWidth(500, 1600)).toBe(500);
    expect(clampInstrumentDockWidth(1000, 1600)).toBe(MAX_INSTRUMENT_DOCK_WIDTH_PX);
  });

  it('keeps a usable chart column at narrower desktop widths', () => {
    expect(clampInstrumentDockWidth(700, 1000)).toBe(680);
  });
});
