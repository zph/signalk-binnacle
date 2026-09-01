import { describe, expect, it } from 'vitest';
import { parseCapabilities, parseJob } from './wayfinder-client';

describe('wayfinder API parsing', () => {
  it('accepts a ready capability response', () => {
    expect(
      parseCapabilities({
        apiVersion: '1.0',
        ready: true,
        objectives: ['fastest', 'leastMotoring'],
      }),
    ).toEqual({
      apiVersion: '1.0',
      ready: true,
      objectives: ['fastest', 'leastMotoring'],
      unavailableReason: undefined,
    });
  });

  it('rejects malformed capability and job responses', () => {
    expect(
      parseCapabilities({ apiVersion: '1.0', ready: true, objectives: ['unsafe'] }),
    ).toBeUndefined();
    expect(parseJob({ id: 'guessable', state: 'routing' })).toBeUndefined();
  });

  it('accepts only documented job states', () => {
    expect(parseJob({ id: 'job-1', state: 'validatingSafety', message: 'Checking depth' })).toEqual(
      { id: 'job-1', state: 'validatingSafety', message: 'Checking depth' },
    );
  });
});
