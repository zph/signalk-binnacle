import { describe, expect, it } from 'vitest';
import { createViewHistory } from './view-history';

describe('createViewHistory', () => {
  it('returns views in reverse navigation order', () => {
    const history = createViewHistory<string>();
    history.push('chart');
    history.push('menu');

    expect(history.back()).toBe('menu');
    expect(history.back()).toBe('chart');
    expect(history.back()).toBeUndefined();
  });

  it('bounds history to the configured number of recovery steps', () => {
    const history = createViewHistory<number>(2);
    history.push(1);
    history.push(2);
    history.push(3);

    expect(history.size).toBe(2);
    expect(history.back()).toBe(3);
    expect(history.back()).toBe(2);
  });

  it('clears history after an explicit dismissal', () => {
    const history = createViewHistory<string>();
    history.push('chart');
    history.clear();

    expect(history.canGoBack).toBe(false);
    expect(history.back()).toBeUndefined();
  });

  it('rejects an unusable limit', () => {
    expect(() => createViewHistory(0)).toThrow('positive integer');
  });
});
