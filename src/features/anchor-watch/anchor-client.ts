import type { AnchorZone } from '$entities/anchor';
import type { LatLon } from '$shared/geo';
import { postResource } from '$shared/signalk';

// Hoekens owns the watch. Commands never fall back to a browser-only alarm.

const PLUGIN_BASE = '/plugins/hoekens-anchor-alarm';

// Routes through postResource so a read-only token's 401/403 reaches the write-outcome listener
// rather than being silently absorbed as a plugin-absent failure.
function postAnchorCommand(
  url: string,
  token: string | undefined,
  body?: unknown,
): Promise<boolean> {
  return postResource(url, token, body);
}

// Drop the anchor at the vessel's current position with the given watch radius. On success the
// plugin starts watching server-side and its state arrives back over the stream.
export function dropAnchorOnServer(
  base: string,
  token: string | undefined,
  position: LatLon,
  zone: AnchorZone,
): Promise<boolean> {
  return postAnchorCommand(`${base}${PLUGIN_BASE}/dropAnchor`, token, { position, zone });
}

export function setServerZone(
  base: string,
  token: string | undefined,
  zone: AnchorZone,
  position?: LatLon,
): Promise<boolean> {
  return postAnchorCommand(`${base}${PLUGIN_BASE}/setZone`, token, {
    zone,
    ...(position ? { position } : {}),
  });
}

export function raiseServerAnchor(base: string, token: string | undefined): Promise<boolean> {
  return postAnchorCommand(`${base}${PLUGIN_BASE}/raiseAnchor`, token);
}

// Correct the drop point through the plugin's own command endpoint.
export function setServerAnchorPosition(
  base: string,
  token: string | undefined,
  position: LatLon,
  zone: AnchorZone,
): Promise<boolean> {
  return setServerZone(base, token, zone, position);
}
