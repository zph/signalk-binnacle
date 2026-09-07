import { NOTIFICATIONS_PREFIX, type Path } from './types';

// Signal K is SI: angles in radians, speed in m/s, depth in meters, temperature
// in Kelvin. navigation.position is the exception: decimal degrees. Only the paths the
// app actually subscribes to or reads live here; instrument paths (depth, wind, STW) join
// when the instrument widgets that consume them land.
export const SK_PATHS = {
  // Server chart providers publish a resource delta whenever a chart appears, disappears, or moves
  // to a new immutable generation. The prefix is also used to recognize those event frames without
  // re-spelling the wire contract at the composition root.
  chartResourcesPrefix: 'resources.charts.',
  chartResourcesAll: 'resources.charts.*',
  position: 'navigation.position',
  headingTrue: 'navigation.headingTrue',
  courseOverGroundTrue: 'navigation.courseOverGroundTrue',
  speedOverGround: 'navigation.speedOverGround',
  closestApproach: 'navigation.closestApproach',
  depthBelowTransducer: 'environment.depth.belowTransducer',
  depthBelowKeel: 'environment.depth.belowKeel',
  depthBelowSurface: 'environment.depth.belowSurface',
  windSpeedApparent: 'environment.wind.speedApparent',
  outsidePressure: 'environment.outside.pressure',
  waterTemperature: 'environment.water.temperature',
  outsideTemperature: 'environment.outside.temperature',
  gnssSatellites: 'navigation.gnss.satellites',
  rateOfTurn: 'navigation.rateOfTurn',
  attitude: 'navigation.attitude',
  anchorPosition: 'navigation.anchor.position',
  anchorMaxRadius: 'navigation.anchor.maxRadius',
  anchorNotification: 'notifications.navigation.anchor',
  mobNotification: 'notifications.mob',
  // Wildcard subscription so every raised notification (any producer) reaches the store mirror.
  allNotifications: `${NOTIFICATIONS_PREFIX}*`,
  name: 'name',
  mmsi: 'mmsi',
  callsignVhf: 'communication.callsignVhf',
  aisShipType: 'design.aisShipType',
  vesselLength: 'design.length',
  navigationState: 'navigation.state',
  courseNextPoint: 'navigation.course.nextPoint',
  coursePreviousPoint: 'navigation.course.previousPoint',
  courseActiveRoute: 'navigation.course.activeRoute',
  courseArrivalCircle: 'navigation.course.arrivalCircle',
  courseCalcValues: 'navigation.course.calcValues',
  // The course-provider publishes calcValues one leaf per delta (navigation.course.calcValues.<field>)
  // and the core never emits the parent object, so a subscription to courseCalcValues matches no bus.
  // Subscribe to the wildcard so every calcValues field streams; the base path stays for leaf keys.
  courseCalcValuesAll: 'navigation.course.calcValues.*',
  speedThroughWater: 'navigation.speedThroughWater',
  headingMagnetic: 'navigation.headingMagnetic',
  magneticVariation: 'navigation.magneticVariation',
  windAngleApparent: 'environment.wind.angleApparent',
  windSpeedTrue: 'environment.wind.speedTrue',
  windAngleTrueWater: 'environment.wind.angleTrueWater',
  windAngleTrueGround: 'environment.wind.angleTrueGround',
  windSpeedOverGround: 'environment.wind.speedOverGround',
  windDirectionTrue: 'environment.wind.directionTrue',
} as const satisfies Record<string, Path>;
