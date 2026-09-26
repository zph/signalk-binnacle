import type { LatLon } from '$shared/geo';
import { postResource } from '$shared/signalk';

// The HTTP client for the signalk-anchoralarm-plugin. Every call returns whether it succeeded and
// never throws: a missing plugin, a 401, or a dead network all come back false, and the caller
// leaves the watch off. There is no separate presence probe: the drop attempt itself is detection.

const PLUGIN_BASE = '/plugins/anchoralarm';

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
  radiusMeters: number,
): Promise<boolean> {
  return postAnchorCommand(`${base}${PLUGIN_BASE}/dropAnchor`, token, { radius: radiusMeters });
}

export function setServerRadius(
  base: string,
  token: string | undefined,
  radiusMeters: number,
): Promise<boolean> {
  return postAnchorCommand(`${base}${PLUGIN_BASE}/setRadius`, token, { radius: radiusMeters });
}

export function raiseServerAnchor(base: string, token: string | undefined): Promise<boolean> {
  return postAnchorCommand(`${base}${PLUGIN_BASE}/raiseAnchor`, token);
}

// Correct the drop point through the plugin's own command endpoint.
export function setServerAnchorPosition(
  base: string,
  token: string | undefined,
  position: LatLon,
): Promise<boolean> {
  return postAnchorCommand(`${base}${PLUGIN_BASE}/setAnchorPosition`, token, {
    position: { latitude: position.latitude, longitude: position.longitude },
  });
}
