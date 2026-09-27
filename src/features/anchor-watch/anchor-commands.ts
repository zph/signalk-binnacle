import type { AnchorZone } from '$entities/anchor';
import type { LatLon } from '$shared/geo';
import {
  dropAnchorOnServer,
  raiseServerAnchor,
  setServerAnchorPosition,
  setServerZone,
} from './anchor-client';

// A command succeeds only when the server accepts it. The live Signal K paths and notification
// remain the authority for whether a watch is actually active or alarming.
export interface AnchorCommands {
  drop(position: LatLon, zone: AnchorZone): Promise<boolean>;
  raise(): Promise<boolean>;
  setZone(zone: AnchorZone, position?: LatLon): Promise<boolean>;
}

export function createPluginAnchorCommands(
  origin: string,
  getToken: () => string | undefined,
): AnchorCommands {
  return {
    drop: (position, zone) => dropAnchorOnServer(origin, getToken(), position, zone),
    raise: () => raiseServerAnchor(origin, getToken()),
    setZone: (zone, position) =>
      position
        ? setServerAnchorPosition(origin, getToken(), position, zone)
        : setServerZone(origin, getToken(), zone),
  };
}
