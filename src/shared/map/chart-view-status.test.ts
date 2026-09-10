import { describe, expect, it } from 'vitest';
import { hasNavigationChartForView, hasVisibleNavigationChart } from './chart-view-status';

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

describe('hasNavigationChartForView', () => {
  const viewport: [number, number, number, number] = [-123, 37, -122, 38];

  it('recognizes a visible chart whose bounds and zoom cover the viewport', () => {
    expect(
      hasNavigationChartForView(
        [
          {
            visible: true,
            chart: {
              identifier: 'bay',
              source: 'server',
              kind: 'raster',
              type: 'tilelayer',
              bounds: [-124, 36, -121, 39],
              minzoom: 4,
              maxzoom: 14,
            },
          },
        ],
        viewport,
        10,
      ),
    ).toBe(true);
  });

  it('rejects charts outside the viewport or rendered zoom range', () => {
    const chart = {
      visible: true,
      chartCoverage: { coverage: [[-80, 20, -70, 30]] as const, minzoom: 3, maxzoom: 8 },
    };
    expect(hasNavigationChartForView([chart], viewport, 6)).toBe(false);
    expect(hasNavigationChartForView([chart], [-75, 22, -74, 23], 10)).toBe(false);
    expect(hasNavigationChartForView([chart], [-75, 22, -74, 23], 9)).toBe(true);
  });

  it('handles coverage and viewports crossing the antimeridian', () => {
    expect(
      hasNavigationChartForView(
        [{ visible: true, chartCoverage: { coverage: [[170, -20, -170, 20]] } }],
        [178, -5, 182, 5],
        4,
      ),
    ).toBe(true);
  });
});
