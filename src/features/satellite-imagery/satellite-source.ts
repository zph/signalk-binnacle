import { createRasterOverlay, type OverlayModule, type RasterOverlaySource } from '$shared/map';

// Esri's public World Imagery MapServer is the best keyless global imagery source available here:
// Google requires an authenticated, billed Map Tiles API project, and OpenStreetMap does not serve
// satellite imagery. The layer stays off by default and beneath every depth or nautical chart. It
// is visual context only, never a navigation chart or a source for route safety decisions.
export const SATELLITE_IMAGERY_SOURCE: RasterOverlaySource = {
  id: 'satellite-imagery',
  title: 'Satellite imagery',
  description:
    'Recent satellite and aerial imagery for visual reference. It is not a nautical chart.',
  tiles: [
    'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
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
