import type { LatLon } from '$shared/geo';

// A route waypoint. Position is decimal degrees (the SI exception); name is optional. Named
// RouteWaypoint to distinguish it from the waypoint entity's richer Waypoint (id, required name, icon).
export interface RouteWaypoint {
  position: LatLon;
  name?: string;
  // Optional Sail Wayfinder passage evidence. Binnacle does not navigate from these forecast
  // values, but retaining them prevents a harmless rename from stripping the passage record.
  wayfinder?: {
    time?: string;
    windDir?: number;
    heading?: number;
    twa?: number;
    tws?: number;
    boatSpeed?: number;
    legCalcMs?: number;
    waveHeight?: number;
    gribFile?: string;
  };
}

// A planned route: an ordered list of waypoints with a stable client id and a name.
export interface Route {
  id: string;
  name: string;
  waypoints: RouteWaypoint[];
}

// Which part of the working route is highlighted for the cross-highlight between the leg list and the
// chart. A leg lights its segment and both end dots; a waypoint lights itself and the legs it joins.
export type RouteHighlight = { kind: 'leg'; index: number } | { kind: 'waypoint'; index: number };
