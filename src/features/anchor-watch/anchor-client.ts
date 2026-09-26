import type { LatLon } from '$shared/geo';
import { postResource, putResource } from '$shared/signalk';

// The HTTP client for the signalk-anchoralarm-plugin. Every call returns whether it succeeded and
// never throws: a missing plugin, a 401, or a dead network all come back false, and the caller
// leaves the watch off. There is no separate presence probe: the drop attempt itself is detection.

const PLUGIN_BASE = '/plugins/anchoralarm';

// POST an anchor command under the degrade contract above. A body is JSON-encoded when given; the
// standard Anchor API's drop and raise take none, so those calls send a bare POST. Shared with the
// standard-API client in anchor-api-client.ts. Routes through postResource so a read-only token's
// 401/403 reaches the write-outcome listener and raises the read-only banner, rather than being
// silently absorbed as a plugin-absent degrade.
export function postAnchorCommand(
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

// Correct the drop point after a drag-to-adjust on the chart, via the plugin's PUT handler on the
// standard path.
export function putServerAnchorPosition(
  base: string,
  token: string | undefined,
  position: LatLon,
): Promise<boolean> {
  return putResource(`${base}/signalk/v1/api/vessels/self/navigation/anchor/position`, token, {
    value: { latitude: position.latitude, longitude: position.longitude },
  });
}
