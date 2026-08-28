export const MAP_RENDERING_QUALITIES = ['performance', 'balanced', 'native'] as const;

export type MapRenderingQuality = (typeof MAP_RENDERING_QUALITIES)[number];

export const DEFAULT_MAP_RENDERING_QUALITY: MapRenderingQuality = 'performance';

export function mapRenderingPixelRatio(
  quality: MapRenderingQuality,
  devicePixelRatio: number,
): number {
  const native = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  if (quality === 'performance') return 1;
  if (quality === 'balanced') return Math.min(native, 1.5);
  return native;
}
