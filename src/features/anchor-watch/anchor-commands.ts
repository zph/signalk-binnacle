import type { LatLon } from '$shared/geo';
import {
  dropAnchorOnServer,
  raiseServerAnchor,
  setServerAnchorPosition,
  setServerRadius,
} from './anchor-client';

// A command succeeds only when the server accepts it. The live Signal K paths and notification
// remain the authority for whether a watch is actually active or alarming.
export interface AnchorCommands {
  drop(radiusMeters: number): Promise<boolean>;
  raise(): Promise<boolean>;
  setRadius(radiusMeters: number): Promise<boolean>;
  setPosition(position: LatLon): Promise<boolean>;
}

export function createPluginAnchorCommands(
  origin: string,
  getToken: () => string | undefined,
): AnchorCommands {
  return {
    drop: (radiusMeters) => dropAnchorOnServer(origin, getToken(), radiusMeters),
    raise: () => raiseServerAnchor(origin, getToken()),
    setRadius: (radiusMeters) => setServerRadius(origin, getToken(), radiusMeters),
    setPosition: (position) => setServerAnchorPosition(origin, getToken(), position),
  };
}
