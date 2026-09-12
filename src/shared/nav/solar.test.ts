import { describe, expect, it } from 'vitest';
import { isAfterDark } from './solar';

describe('isAfterDark', () => {
  const latitude = 43;
  const longitude = -83;

  it('keeps civil twilight light and marks deeper night dark', () => {
    expect(isAfterDark(Date.parse('2026-08-11T00:52:00Z'), latitude, longitude)).toBe(false);
    expect(isAfterDark(Date.parse('2026-08-11T01:27:00Z'), latitude, longitude)).toBe(true);
    expect(isAfterDark(Date.parse('2026-08-11T10:15:00Z'), latitude, longitude)).toBe(false);
    expect(isAfterDark(Date.parse('2026-08-11T09:30:00Z'), latitude, longitude)).toBe(true);
  });

  it('distinguishes equatorial noon and midnight', () => {
    expect(isAfterDark(Date.parse('2026-03-01T12:00:00Z'), 0, 0)).toBe(false);
    expect(isAfterDark(Date.parse('2026-03-01T00:00:00Z'), 0, 0)).toBe(true);
  });

  it('handles polar day and polar night', () => {
    expect(isAfterDark(Date.parse('2026-06-21T00:00:00Z'), 78.2232, 15.6267)).toBe(false);
    expect(isAfterDark(Date.parse('2026-12-21T12:00:00Z'), 78.2232, 15.6267)).toBe(true);
  });

  it('never marks invalid input dark', () => {
    expect(isAfterDark(Number.NaN, latitude, longitude)).toBe(false);
    expect(isAfterDark(Date.now(), Number.NaN, longitude)).toBe(false);
    expect(isAfterDark(Date.now(), 95, longitude)).toBe(false);
  });
});
