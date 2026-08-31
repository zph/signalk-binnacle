/**
 * Binnacle's supported layout contract. CSS media queries cannot interpolate these values, so a
 * matching literal in CSS must cite this module in an adjacent comment.
 */
export const PLATFORM_BREAKPOINTS = {
  phoneMaxPx: 600,
  compactHelmMaxPx: 900,
} as const;

export const PLATFORM_VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  ipadPortrait: { width: 834, height: 1194 },
  ipadLandscape: { width: 1194, height: 834 },
  phonePortrait: { width: 390, height: 844 },
  phoneLandscape: { width: 844, height: 390 },
} as const;
