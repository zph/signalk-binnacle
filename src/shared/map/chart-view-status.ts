import { type Bbox4, splitAtAntimeridian } from '$shared/geo';
import type { ChartCoverageInfo, ChartLayerInfo } from './types';

// createChartOverlay deliberately permits one zoom level of overscale before hiding a chart. Keep
// the fallback decision on the same boundary so Seascape does not appear underneath a chart that
// MapLibre is still rendering.
export const NAVIGATION_CHART_OVERZOOM_LEVELS = 1;

// Whether any visible layer is a real navigation chart, the one predicate behind both the Charts
// tab's no-chart-on explanation and the region-aware chart prompt. Depth shading carries neither
// field, so it correctly never counts as a chart.
export function hasVisibleNavigationChart(
  items: readonly {
    visible: boolean;
    chart?: unknown;
    chartCoverage?: unknown;
  }[],
): boolean {
  return items.some(
    (item) => item.visible && (item.chart !== undefined || item.chartCoverage !== undefined),
  );
}

export interface NavigationChartViewItem {
  visible: boolean;
  available?: boolean;
  chart?: ChartLayerInfo;
  chartCoverage?: ChartCoverageInfo;
}

function boxesOverlap(a: Bbox4, b: Bbox4): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function coverageOverlapsViewport(coverage: readonly Readonly<Bbox4>[], viewport: Bbox4): boolean {
  const viewportParts = splitAtAntimeridian(viewport);
  return coverage.some((box) =>
    splitAtAntimeridian([box[0], box[1], box[2] < box[0] ? box[2] + 360 : box[2], box[3]]).some(
      (coveragePart) =>
        viewportParts.some((viewportPart) => boxesOverlap(coveragePart, viewportPart)),
    ),
  );
}

// Whether a visible navigation chart can actually render somewhere in the current viewport at the
// current zoom. A chart with no declared geographic coverage is worldwide by the chart contract.
// This is intentionally an overlap test, not full containment: Seascape is the empty-view fallback,
// and should not tint the water behind a real chart merely because one edge of the viewport extends
// beyond that chart.
export function hasNavigationChartForView(
  items: readonly NavigationChartViewItem[],
  viewport: Bbox4,
  zoom: number,
): boolean {
  return items.some((item) => {
    if (!item.visible || item.available === false) return false;
    const descriptor = item.chartCoverage ?? item.chart;
    if (!descriptor) return false;
    const minimumZoom = descriptor.minzoom ?? 0;
    const maximumZoom = descriptor.maxzoom ?? Number.POSITIVE_INFINITY;
    if (zoom < minimumZoom || zoom > maximumZoom + NAVIGATION_CHART_OVERZOOM_LEVELS) return false;
    const coverage =
      item.chartCoverage?.coverage ?? (item.chart?.bounds ? [item.chart.bounds] : undefined);
    return coverage === undefined || coverageOverlapsViewport(coverage, viewport);
  });
}
