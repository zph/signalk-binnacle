import { createRasterOverlay, type OverlayModule, type RasterOverlaySource } from '$shared/map';

// Esri's public World Imagery MapServer is the best keyless global imagery source available here:
// Google requires an authenticated, billed Map Tiles API project, and OpenStreetMap does not serve
// satellite imagery. Native detail varies by location even though the service advertises zoom 23.
// blankTile=false turns Esri's opaque "map data not yet available" JPEG into a 404, so MapLibre can
// retain and linearly overzoom the deepest real parent tile instead of painting and caching the
// placeholder as imagery. The layer stays off by default and beneath every depth or nautical chart.
// It is visual context only, never a navigation chart or a source for route safety decisions.
export const SATELLITE_IMAGERY_SOURCE: RasterOverlaySource = {
  id: 'satellite-imagery',
  title: 'Satellite imagery',
  description:
    'Global satellite and aerial imagery using the deepest real local detail available. It is not a nautical chart.',
  tiles: [
    'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?blankTile=false',
  ],
  tileSize: 256,
  minzoom: 0,
  maxzoom: 23,
  attribution: 'Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community',
  region: 'Global',
  category: 'charts',
  defaultVisible: false,
};

export function createSatelliteImageryOverlay(
  source: RasterOverlaySource = SATELLITE_IMAGERY_SOURCE,
): OverlayModule {
  return createRasterOverlay(source, 'basemap');
}
