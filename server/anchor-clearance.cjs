'use strict';

const PATH = 'navigation.anchor.distanceToWatchBoundary';
const INPUT_PATHS = [
  'navigation.position',
  'navigation.anchor.state',
  'navigation.anchor.position',
  'navigation.anchor.watchZone',
  'navigation.anchor.maxRadius',
];
const EARTH_RADIUS_M = 6_371_008.8;
const MAX_FIX_AGE_MS = 30_000;

function validPosition(value) {
  return (
    value &&
    typeof value === 'object' &&
    Number.isFinite(value.latitude) &&
    Number.isFinite(value.longitude) &&
    Math.abs(value.latitude) <= 90 &&
    Math.abs(value.longitude) <= 180
  );
}

function validDistance(value, allowZero = false) {
  return Number.isFinite(value) && value >= (allowZero ? 0 : Number.EPSILON) && value <= 1_000_000;
}

function validBearing(value) {
  return Number.isFinite(value) && value >= 0 && value <= 360;
}

function pointFromBearing(bearing, distance) {
  const angle = (bearing * Math.PI) / 180;
  return { x: Math.sin(angle) * distance, y: Math.cos(angle) * distance };
}

function vesselOffset(anchor, vessel) {
  const lat1 = (anchor.latitude * Math.PI) / 180;
  const lat2 = (vessel.latitude * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLon = ((vessel.longitude - anchor.longitude) * Math.PI) / 180;
  const haversine =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const distance = 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, haversine)));
  const bearing = Math.atan2(
    Math.sin(dLon) * Math.cos(lat2),
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon),
  );
  return { x: Math.sin(bearing) * distance, y: Math.cos(bearing) * distance };
}

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
  );
  return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy);
}

function polygonClearance(point, vertices) {
  if (!Array.isArray(vertices) || vertices.length < 3 || vertices.length > 24) return undefined;
  const polygon = [];
  for (const vertex of vertices) {
    if (!vertex || !validBearing(vertex.bearing) || !validDistance(vertex.distance, true)) {
      return undefined;
    }
    polygon.push(pointFromBearing(vertex.bearing, vertex.distance));
  }
  let area = 0;
  let inside = false;
  let distance = Infinity;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    area += start.x * end.y - end.x * start.y;
    distance = Math.min(distance, distanceToSegment(point, start, end));
    if (
      start.y > point.y !== end.y > point.y &&
      point.x < ((end.x - start.x) * (point.y - start.y)) / (end.y - start.y) + start.x
    ) {
      inside = !inside;
    }
  }
  if (Math.abs(area) < 0.001) return undefined;
  return distance < 1e-8 ? 0 : inside ? distance : -distance;
}

function sectorClearance(point, zone) {
  const { radius, startAngle, endAngle } = zone;
  if (!validDistance(radius) || !validBearing(startAngle) || !validBearing(endAngle)) {
    return undefined;
  }
  const sweep = (((endAngle - startAngle) % 360) + 360) % 360;
  if (sweep === 0) return undefined;
  const distance = Math.hypot(point.x, point.y);
  const bearing = ((Math.atan2(point.x, point.y) * 180) / Math.PI + 360) % 360;
  const angleFromStart = (((bearing - startAngle) % 360) + 360) % 360;
  const inArc = angleFromStart <= sweep;
  const start = pointFromBearing(startAngle, radius);
  const end = pointFromBearing(endAngle, radius);
  const origin = { x: 0, y: 0 };
  const arcDistance = inArc
    ? Math.abs(radius - distance)
    : Math.min(
        Math.hypot(point.x - start.x, point.y - start.y),
        Math.hypot(point.x - end.x, point.y - end.y),
      );
  const edgeDistance = Math.min(
    arcDistance,
    distanceToSegment(point, origin, start),
    distanceToSegment(point, origin, end),
  );
  if (edgeDistance < 1e-8) return 0;
  return distance <= radius && inArc ? edgeDistance : -edgeDistance;
}

function signedClearance(anchor, vessel, zone) {
  if (!validPosition(anchor) || !validPosition(vessel) || !zone || typeof zone !== 'object') {
    return undefined;
  }
  const point = vesselOffset(anchor, vessel);
  if (zone.type === 'circle') {
    return validDistance(zone.radius) ? zone.radius - Math.hypot(point.x, point.y) : undefined;
  }
  if (zone.type === 'sector') return sectorClearance(point, zone);
  if (zone.type === 'polygon') return polygonClearance(point, zone.vertices);
  return undefined;
}

function unwrapCell(cell) {
  return cell && typeof cell === 'object' && Object.hasOwn(cell, 'value') ? cell.value : cell;
}

function createAnchorClearancePublisher(app) {
  let cells = {};
  let positionAt = 0;
  let published;
  let stopped = true;
  let timer;
  let unsubscribes = [];

  function publish(value) {
    if (
      value === published ||
      (Number.isFinite(value) && Number.isFinite(published) && Math.abs(value - published) < 0.1)
    )
      return;
    published = value;
    app.handleMessage('binnacle-custom', {
      context: 'vessels.self',
      updates: [{ values: [{ path: PATH, value }] }],
    });
  }

  function refresh() {
    if (stopped) return;
    const zone =
      cells['navigation.anchor.watchZone'] ??
      (validDistance(cells['navigation.anchor.maxRadius'])
        ? { type: 'circle', radius: cells['navigation.anchor.maxRadius'] }
        : undefined);
    const value =
      cells['navigation.anchor.state'] === 'on' && Date.now() - positionAt < MAX_FIX_AGE_MS
        ? signedClearance(cells['navigation.anchor.position'], cells['navigation.position'], zone)
        : undefined;
    publish(value === undefined ? null : value);
  }

  return {
    start() {
      stopped = false;
      cells = {};
      positionAt = 0;
      published = undefined;
      for (const input of INPUT_PATHS) {
        const cell = app.getSelfPath?.(input);
        cells[input] = unwrapCell(cell);
        if (input === 'navigation.position') {
          const timestamp = cell?.timestamp;
          positionAt =
            timestamp && Number.isFinite(Date.parse(timestamp)) ? Date.parse(timestamp) : 0;
        }
      }
      publish(null);
      refresh();
      unsubscribes = [];
      app.subscriptionmanager.subscribe(
        {
          context: 'vessels.self',
          excludeSelf: true,
          subscribe: INPUT_PATHS.map((input) => ({ path: input, policy: 'instant' })),
        },
        unsubscribes,
        (error) => app.error?.(`Anchor clearance subscription failed: ${error}`),
        (delta) => {
          if (stopped) return;
          for (const update of delta.updates ?? []) {
            if (update.$source === 'binnacle-custom') continue;
            for (const entry of update.values ?? []) {
              if (!INPUT_PATHS.includes(entry.path)) continue;
              cells[entry.path] = entry.value;
              if (entry.path === 'navigation.position') {
                const timestamp = update.timestamp;
                positionAt =
                  timestamp && Number.isFinite(Date.parse(timestamp))
                    ? Date.parse(timestamp)
                    : Date.now();
              }
            }
          }
          refresh();
        },
      );
      timer = setInterval(refresh, 5_000);
      timer.unref?.();
    },
    stop() {
      clearInterval(timer);
      for (const unsubscribe of unsubscribes) unsubscribe();
      unsubscribes = [];
      if (!stopped) publish(null);
      stopped = true;
    },
  };
}

module.exports = { PATH, createAnchorClearancePublisher };
