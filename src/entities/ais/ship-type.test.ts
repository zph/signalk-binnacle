import { describe, expect, it } from 'vitest';
import { aisShipTypeLabel, aisVesselKind } from './ship-type';

describe('aisVesselKind', () => {
  it('groups AIS ship types into recognizable chart symbols', () => {
    expect(aisVesselKind(83)).toBe('tanker');
    expect(aisVesselKind(52)).toBe('tug');
    expect(aisVesselKind(31)).toBe('tug');
    expect(aisVesselKind(32)).toBe('tug');
    expect(aisVesselKind(36)).toBe('sailboat');
    expect(aisVesselKind(37)).toBe('motorboat');
    expect(aisVesselKind(42)).toBe('motorboat');
    expect(aisVesselKind(30)).toBe('fishing');
    expect(aisVesselKind(50)).toBe('service');
    expect(aisVesselKind(61)).toBe('passenger');
    expect(aisVesselKind(74)).toBe('cargo');
  });

  it('uses the general ship symbol when AIS does not identify a specialized kind', () => {
    expect(aisVesselKind(0)).toBe('ship');
    expect(aisVesselKind(95)).toBe('ship');
    expect(aisVesselKind(83.5)).toBe('ship');
    expect(aisVesselKind(undefined)).toBe('ship');
  });
});

describe('aisShipTypeLabel', () => {
  it('names exact operational vessel types', () => {
    expect(aisShipTypeLabel(30)).toBe('Fishing vessel');
    expect(aisShipTypeLabel(36)).toBe('Sailing vessel');
    expect(aisShipTypeLabel(52)).toBe('Tug');
  });

  it('names the shared AIS ship classes', () => {
    expect(aisShipTypeLabel(42)).toBe('High-speed craft');
    expect(aisShipTypeLabel(61)).toBe('Passenger ship');
    expect(aisShipTypeLabel(74)).toBe('Cargo ship');
    expect(aisShipTypeLabel(83)).toBe('Tanker');
    expect(aisShipTypeLabel(95)).toBe('Other vessel');
  });

  it('keeps unavailable and unsupported ids honest', () => {
    expect(aisShipTypeLabel(0)).toBe('Not available');
    expect(aisShipTypeLabel(12)).toBe('Unknown ship type');
    expect(aisShipTypeLabel(100)).toBe('Unknown ship type');
    expect(aisShipTypeLabel(Number.NaN)).toBe('Unknown ship type');
  });
});
