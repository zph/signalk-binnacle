import { describe, expect, it } from 'vitest';
import { parseCapabilities, parseStatus } from './wayfinder-client';

describe('wayfinder API parsing', () => {
  it('accepts a ready capability response', () => {
    expect(
      parseCapabilities({
        apiVersion: '1.0',
        ready: true,
        objectives: ['fastest'],
      }),
    ).toEqual({
      apiVersion: '1.0',
      ready: true,
      objectives: ['fastest'],
      unavailableReason: undefined,
    });
  });

  it('rejects malformed capability and status responses', () => {
    expect(
      parseCapabilities({ apiVersion: '1.0', ready: true, objectives: ['unsafe'] }),
    ).toBeUndefined();
    expect(parseStatus({ status: 'routing' })).toBeUndefined();
  });

  it('normalizes the plugin calculation states', () => {
    expect(parseStatus({ status: 'calculating', progress: 42 })).toEqual({
      state: 'calculating',
      progress: 42,
    });
    expect(parseStatus({ status: 'warning', progress: 100, warning: 'Partial route' })).toEqual({
      state: 'complete',
      progress: 100,
      message: 'Partial route',
    });
  });
});
