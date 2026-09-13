import { BOUNDARY_SOURCES, createBoundaryOverlay } from '$features/boundaries-overlay';
import {
  createInfrastructureOverlay,
  INFRASTRUCTURE_SOURCES,
} from '$features/infrastructure-overlay';
import { createMpaOverlay, MPA_SOURCES } from '$features/mpa-overlays';
import { buildOceanSources, createOceanOverlay } from '$features/ocean-conditions';
import {
  createSatelliteImageryOverlay,
  SATELLITE_IMAGERY_SOURCE,
} from '$features/satellite-imagery';
import { createSeamarkOverlay, SEAMARK_SOURCES } from '$features/seamark-overlay';
import { createBaseMapOverlay, type OverlayModule, proxiedSources } from '$shared/map';
import { buildBathymetryOverlays } from './build-bathymetry-overlays';

// The reference layers are shared by the primary chart and any independent chart viewport. Keeping
// the stack in one builder prevents a secondary view from quietly losing a chart family or drawing
// seamarks below the areas and boundaries they annotate.
export function buildReferenceOverlays(
  map: Parameters<typeof createBaseMapOverlay>[0],
  companionBase: string | null,
): OverlayModule[] {
  return [
    createBaseMapOverlay(map),
    createSatelliteImageryOverlay(SATELLITE_IMAGERY_SOURCE),
    ...buildBathymetryOverlays({ companionBase }),
    ...buildOceanSources().map((source) => createOceanOverlay(source)),
    ...proxiedSources(BOUNDARY_SOURCES, companionBase).map((source) =>
      createBoundaryOverlay(source),
    ),
    ...proxiedSources(INFRASTRUCTURE_SOURCES, companionBase).map((source) =>
      createInfrastructureOverlay(source),
    ),
    ...proxiedSources(MPA_SOURCES, companionBase).map((source) => createMpaOverlay(source)),
    ...proxiedSources(SEAMARK_SOURCES, companionBase).map((source) => createSeamarkOverlay(source)),
  ];
}
