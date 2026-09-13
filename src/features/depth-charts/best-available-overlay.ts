import type { OverlayModule } from '$shared/map';
import { createRasterOverlay } from '$shared/map';
import type { StreamingChartSource } from './streaming-sources';

export const BEST_AVAILABLE_BATHYMETRY_ID = 'depth-best-available';

const PRIORITY_SOURCE_IDS = ['depth-gebco', 'depth-emodnet', 'depth-bluetopo'] as const;

function requireSource(
  sources: readonly StreamingChartSource[],
  id: (typeof PRIORITY_SOURCE_IDS)[number],
): StreamingChartSource {
  const source = sources.find((candidate) => candidate.id === id);
  if (!source) throw new TypeError(`Missing best-available bathymetry source ${id}`);
  return source;
}

export function createBestAvailableBathymetryOverlay(
  sources: readonly StreamingChartSource[],
): OverlayModule {
  const providers = PRIORITY_SOURCE_IDS.map((id) => {
    const source = requireSource(sources, id);
    return createRasterOverlay(
      { ...source, id: `${BEST_AVAILABLE_BATHYMETRY_ID}-${source.id}` },
      'bathymetry',
    );
  });

  return {
    id: BEST_AVAILABLE_BATHYMETRY_ID,
    title: 'Best available bathymetry',
    description:
      'Highest-detail available reference depth shading, with BlueTopo in US waters, EMODnet in European waters, and GEBCO elsewhere. Not for navigation.',
    band: 'bathymetry',
    region: 'Global',
    supportsOpacity: true,
    defaultVisible: false,
    defaultOpacity: 1,
    layerIds: providers.flatMap((provider) => provider.layerIds),
    async add(ctx) {
      for (const provider of providers) await provider.add(ctx);
    },
    remove(ctx) {
      for (const provider of providers.toReversed()) provider.remove(ctx);
    },
    setVisible(ctx, visible) {
      for (const provider of providers) provider.setVisible(ctx, visible);
    },
    setOpacity(ctx, opacity) {
      for (const provider of providers) provider.setOpacity?.(ctx, opacity);
    },
    applyTheme(ctx, paint) {
      for (const provider of providers) provider.applyTheme?.(ctx, paint);
    },
  };
}
