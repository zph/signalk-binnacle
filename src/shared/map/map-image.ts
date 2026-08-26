import type { Map as MapLibreMap } from 'maplibre-gl';

// Register a map image, or replace it in place when it already exists (the path a theme recolor
// takes). Shared by the symbol overlays and the note category and navaid icons so the
// add-or-update branch and the pixelRatio handling live in one place.
export function setMapImage(map: MapLibreMap, id: string, image: ImageData, pixelRatio = 1): void {
  if (map.hasImage(id)) map.updateImage(id, image);
  else map.addImage(id, image, { pixelRatio });
}
