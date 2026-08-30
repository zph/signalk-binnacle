import { describe, expect, it } from 'vitest';
import {
  clampInstrumentDockWidth,
  instrumentDockWidthForLayout,
  MAX_INSTRUMENT_DOCK_WIDTH_PX,
  MIN_INSTRUMENT_DOCK_WIDTH_PX,
  maxInstrumentDockWidthForViewport,
} from './dock-width';

describe('instrument dock width', () => {
  it('clamps to the configured width range', () => {
    expect(clampInstrumentDockWidth(100, 1600)).toBe(MIN_INSTRUMENT_DOCK_WIDTH_PX);
    expect(clampInstrumentDockWidth(500, 1600)).toBe(500);
    expect(clampInstrumentDockWidth(5000, 4000)).toBe(MAX_INSTRUMENT_DOCK_WIDTH_PX);
  });

  it('opens to nearly the whole viewport so the dock can be dragged fully open', () => {
    expect(clampInstrumentDockWidth(2000, 1600)).toBe(1552);
    expect(clampInstrumentDockWidth(952, 1000)).toBe(952);
  });

  it('maps named layouts onto safe dock widths', () => {
    expect(instrumentDockWidthForLayout('half', 1200)).toBe(600);
    expect(instrumentDockWidthForLayout('quarter', 1600)).toBe(400);
    expect(instrumentDockWidthForLayout('quarter', 1000)).toBe(320);
  });

  it('derives the keyboard resize max from the viewport', () => {
    expect(maxInstrumentDockWidthForViewport(1600)).toBe(1552);
    expect(maxInstrumentDockWidthForViewport(360)).toBe(MIN_INSTRUMENT_DOCK_WIDTH_PX);
    expect(maxInstrumentDockWidthForViewport(5000)).toBe(MAX_INSTRUMENT_DOCK_WIDTH_PX);
  });
});
