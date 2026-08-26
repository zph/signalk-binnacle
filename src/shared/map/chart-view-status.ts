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
