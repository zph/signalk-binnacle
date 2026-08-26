import { describe, expect, it } from 'vitest';
import { hasVisibleNavigationChart } from './chart-view-status';

describe('hasVisibleNavigationChart', () => {
  it('recognizes enabled server and coverage-backed navigation charts', () => {
    expect(hasVisibleNavigationChart([{ visible: true, chart: {} }])).toBe(true);
    expect(hasVisibleNavigationChart([{ visible: true, chartCoverage: {} }])).toBe(true);
  });

  it('rejects disabled charts and non-chart overlays', () => {
    expect(hasVisibleNavigationChart([{ visible: false, chart: {} }, { visible: true }])).toBe(
      false,
    );
  });
});
