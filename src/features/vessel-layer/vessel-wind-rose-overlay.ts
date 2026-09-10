import { type Map as MapLibreMap, Marker } from 'maplibre-gl';

import type { OwnVessel } from '$entities/vessel';
import { formatSignedAngleOr, headingDegrees, prefersReducedMotion, RAD_TO_DEG } from '$shared/lib';
import {
  type MapThemePaint,
  mapThemePaint,
  type OverlayContext,
  type OverlayModule,
  rgbaCss,
} from '$shared/map';
import {
  createWindAngleAnimator,
  createWindDirectionRangeTracker,
  createWindSectorTracker,
  type WindDirectionRange,
  type WindSectorReference,
  windRoseSectorGeometry,
} from '$shared/nav';
import {
  DEFAULT_WIND_ROSE_ARC_MARGIN_RAD,
  DEFAULT_WIND_ROSE_NO_GO_ANGLE_RAD,
} from '$shared/settings';

export const OWN_VESSEL_WIND_ROSE_OVERLAY_ID = 'own-vessel-wind-rose';

type WindRoseVessel = Pick<
  OwnVessel,
  | 'position'
  | 'positionStale'
  | 'headingRad'
  | 'headingStale'
  | 'cogRad'
  | 'cogStale'
  | 'windAngleApparentRad'
  | 'windAngleApparentStale'
  | 'windAngleTrueRad'
  | 'windAngleTrueStale'
  | 'windDirectionTrueRad'
  | 'windDirectionTrueStale'
> &
  Partial<
    Pick<
      OwnVessel,
      | 'headingEpochMs'
      | 'cogEpochMs'
      | 'windAngleApparentEpochMs'
      | 'windAngleTrueEpochMs'
      | 'windDirectionTrueEpochMs'
    >
  >;

export interface VesselWindRoseAngles {
  headingDeg?: number;
  boatDeg?: number;
  apparentDeg?: number;
  trueDeg?: number;
  sectorDeg?: number;
}

export interface VesselWindRoseOptions {
  noGoAngleRad?: () => number;
  arcMarginRad?: () => number;
  reviewActive?: () => boolean;
}

interface RoseDom {
  root: HTMLDivElement;
  card: SVGGElement;
  cardinalLabels: Array<{ angle: number; text: SVGTextElement }>;
  sector: SVGGElement;
  sectorFill: SVGPathElement;
  portArc: SVGPathElement;
  starboardArc: SVGPathElement;
  portBoundary: SVGPathElement;
  starboardBoundary: SVGPathElement;
  boat: SVGGElement;
  apparent: SVGGElement;
  apparentLabel: SVGTextElement;
  trueWind: SVGGElement;
  trueLabel: SVGTextElement;
  ring: SVGCircleElement;
  dialParts: SVGElement[];
  boatPath: SVGPathElement;
  apparentPath: SVGPathElement;
  truePath: SVGPathElement;
  twaReadout: SVGTextElement;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, name);
}

function attributes(element: Element, values: Record<string, string>): void {
  for (const [name, value] of Object.entries(values)) element.setAttribute(name, value);
}

function finite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function trueWindAngleRad(
  vessel: WindRoseVessel,
  headingRad: number | undefined,
): number | undefined {
  if (!vessel.windAngleTrueStale && finite(vessel.windAngleTrueRad)) {
    return vessel.windAngleTrueRad;
  }
  if (
    headingRad !== undefined &&
    !vessel.windDirectionTrueStale &&
    finite(vessel.windDirectionTrueRad)
  ) {
    const difference = vessel.windDirectionTrueRad - headingRad;
    return ((((difference + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  }
  return undefined;
}

// The map bearing is the amount true north has rotated clockwise away from screen-up. Subtracting
// it from every absolute boat/wind bearing therefore gives the on-screen direction in every camera
// mode. In heading-up follow, map bearing equals heading and boatDeg becomes zero: the same normal
// bow-up presentation as the full instrument, without a mode-specific branch or visual jump.
export function resolveVesselWindRoseAngles(
  vessel: WindRoseVessel,
  mapBearingDeg: number,
): VesselWindRoseAngles {
  const headingRad = !vessel.headingStale
    ? vessel.headingRad
    : !vessel.cogStale
      ? vessel.cogRad
      : undefined;
  const fallbackCogRad = !vessel.cogStale ? vessel.cogRad : undefined;
  const referenceRad = headingRad ?? fallbackCogRad;
  const headingDeg = finite(referenceRad) ? headingDegrees(referenceRad, undefined) : undefined;
  const boatDeg =
    headingDeg === undefined ? undefined : normalizeDegrees(headingDeg - mapBearingDeg);

  const apparentDeg =
    headingDeg !== undefined &&
    !vessel.windAngleApparentStale &&
    finite(vessel.windAngleApparentRad)
      ? normalizeDegrees(headingDeg + vessel.windAngleApparentRad * RAD_TO_DEG - mapBearingDeg)
      : undefined;

  let trueAbsoluteDeg: number | undefined;
  if (!vessel.windDirectionTrueStale && finite(vessel.windDirectionTrueRad)) {
    trueAbsoluteDeg = vessel.windDirectionTrueRad * RAD_TO_DEG;
  } else if (
    headingDeg !== undefined &&
    !vessel.windAngleTrueStale &&
    finite(vessel.windAngleTrueRad)
  ) {
    trueAbsoluteDeg = headingDeg + vessel.windAngleTrueRad * RAD_TO_DEG;
  }
  const trueDeg =
    trueAbsoluteDeg === undefined ? undefined : normalizeDegrees(trueAbsoluteDeg - mapBearingDeg);

  return {
    headingDeg,
    boatDeg,
    apparentDeg,
    trueDeg,
    sectorDeg: trueDeg ?? apparentDeg,
  };
}

function createRoseDom(): RoseDom {
  const root = document.createElement('div');
  root.className = 'vessel-wind-rose-marker';
  root.dataset.overlay = OWN_VESSEL_WIND_ROSE_OVERLAY_ID;
  root.setAttribute('aria-hidden', 'true');
  Object.assign(root.style, {
    width: 'clamp(7rem, 11vmin, 9rem)',
    height: 'clamp(7rem, 11vmin, 9rem)',
    pointerEvents: 'none',
    userSelect: 'none',
    filter: 'drop-shadow(0 1px 2px rgb(0 0 0 / 0.45))',
    transition: 'opacity 180ms ease',
  });

  const face = svg('svg');
  attributes(face, { viewBox: '0 0 1000 1000', width: '100%', height: '100%' });
  face.style.overflow = 'visible';
  root.append(face);

  const card = svg('g');
  card.classList.add('vessel-wind-rose-card');
  const ring = svg('circle');
  attributes(ring, { cx: '500', cy: '500', r: '444', 'stroke-width': '14' });
  // Keep chart and hazards readable beneath the vessel-attached instrument. The dial furniture
  // stays opaque, so reducing only the face fill does not weaken bearings or wind-range arcs.
  ring.style.fillOpacity = '0.4';
  card.append(ring);

  const dialParts: SVGElement[] = [ring];
  for (let angle = 0; angle < 360; angle += 10) {
    const tick = svg('line');
    const major = angle % 30 === 0;
    attributes(tick, {
      x1: '500',
      y1: major ? '58' : '70',
      x2: '500',
      y2: major ? '104' : '91',
      'stroke-width': major ? '13' : '7',
      transform: `rotate(${angle} 500 500)`,
    });
    tick.style.strokeLinecap = 'round';
    card.append(tick);
    dialParts.push(tick);
  }

  const cardinalLabels: Array<{ angle: number; text: SVGTextElement }> = [];
  for (const [angle, label] of [
    [0, 'N'],
    [90, 'E'],
    [180, 'S'],
    [270, 'W'],
  ] as const) {
    const position = svg('g');
    attributes(position, { transform: `rotate(${angle} 500 500)` });
    const text = svg('text');
    attributes(text, {
      x: '500',
      y: '166',
      'text-anchor': 'middle',
      'font-size': '86',
      'font-weight': '750',
    });
    text.textContent = label;
    position.append(text);
    card.append(position);
    dialParts.push(text);
    cardinalLabels.push({ angle, text });
  }
  face.append(card);

  const sector = svg('g');
  sector.classList.add('vessel-wind-rose-sector');
  const sectorFill = svg('path');
  sectorFill.style.fillOpacity = '0.13';
  const portArc = svg('path');
  const starboardArc = svg('path');
  const portBoundary = svg('path');
  const starboardBoundary = svg('path');
  for (const line of [portArc, starboardArc, portBoundary, starboardBoundary]) {
    line.style.fill = 'none';
    line.style.strokeLinecap = 'round';
    line.style.strokeWidth = '17';
  }
  sector.append(sectorFill, portArc, starboardArc, portBoundary, starboardBoundary);
  face.append(sector);

  const apparent = svg('g');
  apparent.classList.add('vessel-wind-rose-apparent');
  const apparentPath = svg('path');
  attributes(apparentPath, {
    d: 'M438 75 L500 18 L562 75 L522 292 Q500 342 478 292 Z',
    'stroke-width': '12',
    'stroke-linejoin': 'round',
  });
  const apparentLabel = svg('text');
  attributes(apparentLabel, {
    x: '500',
    y: '126',
    'text-anchor': 'middle',
    'font-size': '72',
    'font-weight': '850',
  });
  apparentLabel.textContent = 'A';
  apparent.append(apparentPath, apparentLabel);
  face.append(apparent);

  const trueWind = svg('g');
  trueWind.classList.add('vessel-wind-rose-true');
  const truePath = svg('path');
  attributes(truePath, {
    d: 'M466 75 L500 41 L534 75 L510 250 Q500 282 490 250 Z',
    'stroke-width': '9',
    'stroke-linejoin': 'round',
  });
  const trueLabel = svg('text');
  attributes(trueLabel, {
    x: '500',
    y: '119',
    'text-anchor': 'middle',
    'font-size': '58',
    'font-weight': '850',
  });
  trueLabel.textContent = 'T';
  trueWind.append(truePath, trueLabel);
  face.append(trueWind);

  const twaReadout = svg('text');
  attributes(twaReadout, {
    x: '500',
    y: '925',
    'text-anchor': 'middle',
    'font-size': '66',
    'font-weight': '800',
  });
  twaReadout.classList.add('vessel-wind-rose-twa');
  face.append(twaReadout);

  const boat = svg('g');
  boat.classList.add('vessel-wind-rose-boat');
  const boatPath = svg('path');
  attributes(boatPath, {
    d: 'M500 315 C438 392 416 548 428 674 Q434 720 466 744 H534 Q566 720 572 674 C584 548 562 392 500 315 Z',
    'stroke-width': '18',
    'stroke-linejoin': 'round',
  });
  boat.append(boatPath);
  face.append(boat);

  for (const group of [card, sector, apparent, trueWind, boat]) {
    group.style.transformBox = 'view-box';
    group.style.transformOrigin = 'center';
  }
  card.style.transition = 'transform 260ms linear';

  return {
    root,
    card,
    cardinalLabels,
    sector,
    sectorFill,
    portArc,
    starboardArc,
    portBoundary,
    starboardBoundary,
    boat,
    apparent,
    apparentLabel,
    trueWind,
    trueLabel,
    ring,
    dialParts,
    boatPath,
    apparentPath,
    truePath,
    twaReadout,
  };
}

function setRotation(group: SVGGElement, degrees: number): void {
  group.style.transform = `rotate(${degrees}deg)`;
}

function nearestRotation(target: number, current: number | undefined): number {
  if (current === undefined) return target;
  const delta = ((target - current + 540) % 360) - 180;
  return current + delta;
}

function applyTheme(dom: RoseDom, paint: MapThemePaint): void {
  dom.ring.style.fill = paint.background;
  dom.ring.style.stroke = paint.label;
  for (const part of dom.dialParts) part.style.stroke = paint.label;
  for (const { text } of dom.cardinalLabels) text.style.fill = paint.label;

  // Match the full-size wind rose's established encodings: port red, starboard green, apparent
  // orange, and true wind yellow. The theme palette collapses these to distinct orange/red shades
  // in night mode so this geographic instrument preserves the pure-red display contract.
  dom.sectorFill.style.fill = paint.warning;
  dom.portArc.style.stroke = paint.navStarboard;
  dom.portBoundary.style.stroke = paint.navStarboard;
  dom.starboardArc.style.stroke = paint.navPort;
  dom.starboardBoundary.style.stroke = paint.navPort;
  dom.boatPath.style.fill = rgbaCss(paint.ownVessel);
  dom.boatPath.style.stroke = paint.background;
  dom.apparentPath.style.fill = paint.routeHighlight;
  dom.apparentPath.style.stroke = paint.background;
  dom.apparentLabel.style.fill = paint.background;
  dom.truePath.style.fill = paint.warning;
  dom.truePath.style.stroke = paint.background;
  dom.trueLabel.style.fill = paint.background;
  dom.twaReadout.style.fill = paint.label;
}

function applySectorGeometry(
  dom: RoseDom,
  noGoAngleRad: number,
  arcRange: number | WindDirectionRange,
): void {
  const geometry = windRoseSectorGeometry(noGoAngleRad, arcRange);
  dom.sectorFill.setAttribute('d', geometry.fillPath);
  dom.portArc.setAttribute('d', geometry.portArcPath);
  dom.starboardArc.setAttribute('d', geometry.starboardArcPath);
  dom.portBoundary.setAttribute('d', geometry.portBoundaryPath);
  dom.starboardBoundary.setAttribute('d', geometry.starboardBoundaryPath);
}

export function createVesselWindRoseOverlay(
  vessel: WindRoseVessel,
  options: VesselWindRoseOptions = {},
): OverlayModule & { sync(ctx: OverlayContext): void } {
  let map: MapLibreMap | undefined;
  let marker: Marker | undefined;
  let dom: RoseDom | undefined;
  let visible = false;
  let acceptedOpacity = 1;
  let paint = mapThemePaint('day');
  let lastLon: number | undefined;
  let lastLat: number | undefined;
  let lastNoGoAngleRad: number | undefined;
  let lastArcMarginRad: number | undefined;
  let cardRotation: number | undefined;
  let boatRotation: number | undefined;
  let apparentRotation: number | undefined;
  let trueRotation: number | undefined;
  let sectorRotation: number | undefined;
  let displayedBoatRad: number | undefined;
  let displayedApparentRad: number | undefined;
  let displayedTrueRad: number | undefined;
  let displayedSectorRad: number | undefined;
  let sectorReference: WindSectorReference | undefined;
  let windDirectionRange: WindDirectionRange | undefined;
  const sectorTracker = createWindSectorTracker();
  const directionRangeTracker = createWindDirectionRangeTracker();

  const renderOrientation = (): void => {
    if (!dom || !map) return;
    const mapBearing = map.getBearing();
    const screenDegrees = (angleRad: number | undefined): number | undefined =>
      angleRad === undefined ? undefined : normalizeDegrees(angleRad * RAD_TO_DEG - mapBearing);
    const boatDeg = screenDegrees(displayedBoatRad);
    const apparentDeg = screenDegrees(displayedApparentRad);
    const trueDeg = screenDegrees(displayedTrueRad);
    const sectorDeg = screenDegrees(displayedSectorRad);
    dom.root.dataset.mapBearing = mapBearing.toFixed(2);
    dom.root.dataset.boatBearing = boatDeg?.toFixed(2) ?? '';
    dom.root.dataset.apparentBearing = apparentDeg?.toFixed(2) ?? '';
    dom.root.dataset.trueBearing = trueDeg?.toFixed(2) ?? '';
    dom.root.dataset.rangeWindowSeconds = windDirectionRange ? '60' : '';
    dom.root.dataset.portRangeDegrees = windDirectionRange
      ? (windDirectionRange.portRad * RAD_TO_DEG).toFixed(1)
      : '';
    dom.root.dataset.starboardRangeDegrees = windDirectionRange
      ? (windDirectionRange.starboardRad * RAD_TO_DEG).toFixed(1)
      : '';

    cardRotation = nearestRotation(-mapBearing, cardRotation);
    setRotation(dom.card, cardRotation);
    for (const { angle, text } of dom.cardinalLabels) {
      text.setAttribute('transform', `rotate(${-cardRotation - angle} 500 166)`);
    }

    const applyOptionalRotation = (
      group: SVGGElement,
      label: SVGTextElement | undefined,
      next: number | undefined,
      current: number | undefined,
    ): number | undefined => {
      group.style.display = next === undefined ? 'none' : '';
      if (next === undefined) return current;
      const rotation = nearestRotation(next, current);
      setRotation(group, rotation);
      if (label) label.setAttribute('transform', `rotate(${-rotation} 500 120)`);
      return rotation;
    };

    boatRotation = applyOptionalRotation(dom.boat, undefined, boatDeg, boatRotation);
    apparentRotation = applyOptionalRotation(
      dom.apparent,
      dom.apparentLabel,
      apparentDeg,
      apparentRotation,
    );
    trueRotation = applyOptionalRotation(dom.trueWind, dom.trueLabel, trueDeg, trueRotation);
    sectorRotation = applyOptionalRotation(dom.sector, undefined, sectorDeg, sectorRotation);
  };

  const motionOptions = { reducedMotion: prefersReducedMotion };
  const boatAnimator = createWindAngleAnimator((angleRad) => {
    displayedBoatRad = angleRad;
    renderOrientation();
  }, motionOptions);
  const apparentAnimator = createWindAngleAnimator((angleRad) => {
    displayedApparentRad = angleRad;
    renderOrientation();
  }, motionOptions);
  const trueAnimator = createWindAngleAnimator((angleRad) => {
    displayedTrueRad = angleRad;
    renderOrientation();
  }, motionOptions);
  const sectorAnimator = createWindAngleAnimator((angleRad) => {
    displayedSectorRad = angleRad;
    windDirectionRange =
      angleRad !== undefined && sectorReference === 'true'
        ? directionRangeTracker.rangeAround(angleRad)
        : undefined;
    if (dom) {
      applySectorGeometry(
        dom,
        lastNoGoAngleRad ?? DEFAULT_WIND_ROSE_NO_GO_ANGLE_RAD,
        windDirectionRange ?? lastArcMarginRad ?? DEFAULT_WIND_ROSE_ARC_MARGIN_RAD,
      );
    }
    renderOrientation();
  }, motionOptions);

  function updateVisibility(): void {
    if (!dom) return;
    const hasPosition = vessel.position !== undefined;
    dom.root.style.display = visible && hasPosition ? '' : 'none';
    const reviewOpacity = options.reviewActive?.() ? 0.35 : 1;
    dom.root.style.opacity = String(
      acceptedOpacity * reviewOpacity * (vessel.positionStale ? 0.55 : 1),
    );
    dom.root.dataset.stale = String(vessel.positionStale);
  }

  function updateMotionTargets(): void {
    const now = Date.now();
    const headingRad = !vessel.headingStale
      ? vessel.headingRad
      : !vessel.cogStale
        ? vessel.cogRad
        : undefined;
    const headingEpoch = !vessel.headingStale ? vessel.headingEpochMs : vessel.cogEpochMs;
    const twaRad = trueWindAngleRad(vessel, headingRad);
    if (dom) {
      dom.twaReadout.textContent = `TWA ${twaRad === undefined ? '---' : `${formatSignedAngleOr(twaRad)}°`}`;
    }
    const apparentRad =
      headingRad !== undefined &&
      !vessel.windAngleApparentStale &&
      finite(vessel.windAngleApparentRad)
        ? headingRad + vessel.windAngleApparentRad
        : undefined;
    const apparentEpoch = Math.max(headingEpoch ?? 0, vessel.windAngleApparentEpochMs ?? 0);
    let trueRad: number | undefined;
    let trueEpoch = 0;
    if (!vessel.windDirectionTrueStale && finite(vessel.windDirectionTrueRad)) {
      trueRad = vessel.windDirectionTrueRad;
      trueEpoch = vessel.windDirectionTrueEpochMs ?? 0;
    } else if (
      headingRad !== undefined &&
      !vessel.windAngleTrueStale &&
      finite(vessel.windAngleTrueRad)
    ) {
      trueRad = headingRad + vessel.windAngleTrueRad;
      trueEpoch = Math.max(headingEpoch ?? 0, vessel.windAngleTrueEpochMs ?? 0);
    }

    if (headingRad === undefined) boatAnimator.reset();
    else boatAnimator.push(headingRad, headingEpoch || now);
    if (apparentRad === undefined) apparentAnimator.reset();
    else apparentAnimator.push(apparentRad, apparentEpoch || now);
    if (trueRad === undefined) trueAnimator.reset();
    else trueAnimator.push(trueRad, trueEpoch || now);

    const nextReference: WindSectorReference | undefined =
      trueRad !== undefined ? 'true' : apparentRad !== undefined ? 'apparent' : undefined;
    const sectorTarget = trueRad ?? apparentRad;
    const sectorEpoch = trueRad !== undefined ? trueEpoch : apparentEpoch;
    if (nextReference === undefined || sectorTarget === undefined) {
      sectorReference = undefined;
      sectorTracker.reset();
      directionRangeTracker.reset();
      windDirectionRange = undefined;
      sectorAnimator.reset();
      return;
    }
    sectorReference = nextReference;
    const filtered = sectorTracker.push(sectorTarget, sectorEpoch || now, nextReference);
    if (nextReference === 'true') directionRangeTracker.push(sectorTarget, sectorEpoch || now);
    else directionRangeTracker.reset();
    sectorAnimator.push(filtered, sectorEpoch || now);
  }

  const onRotate = (): void => renderOrientation();

  return {
    id: OWN_VESSEL_WIND_ROSE_OVERLAY_ID,
    title: 'Vessel wind rose',
    description:
      'A chart-anchored wind rose that follows the boat and stays correct in north-up, course-up, and heading-up views.',
    band: 'vessel',
    listed: true,
    defaultVisible: false,
    supportsOpacity: false,
    layerIds: [],
    add(ctx) {
      map = ctx.map;
      dom = createRoseDom();
      applyTheme(dom, paint);
      marker = new Marker({ element: dom.root, anchor: 'center' }).setLngLat([0, 0]).addTo(ctx.map);
      map.on('rotate', onRotate);
      this.sync(ctx);
    },
    sync() {
      if (!dom || !marker || !map) return;
      const position = vessel.position;
      if (position && (position.longitude !== lastLon || position.latitude !== lastLat)) {
        lastLon = position.longitude;
        lastLat = position.latitude;
        marker.setLngLat([position.longitude, position.latitude]);
      }

      const noGoAngleRad = options.noGoAngleRad?.() ?? DEFAULT_WIND_ROSE_NO_GO_ANGLE_RAD;
      const arcMarginRad = options.arcMarginRad?.() ?? DEFAULT_WIND_ROSE_ARC_MARGIN_RAD;
      if (noGoAngleRad !== lastNoGoAngleRad || arcMarginRad !== lastArcMarginRad) {
        lastNoGoAngleRad = noGoAngleRad;
        lastArcMarginRad = arcMarginRad;
        applySectorGeometry(dom, noGoAngleRad, windDirectionRange ?? arcMarginRad);
      }
      updateVisibility();
      updateMotionTargets();
    },
    setVisible(_ctx, next) {
      visible = next;
      updateVisibility();
    },
    setOpacity(_ctx, next) {
      acceptedOpacity = next;
      updateVisibility();
    },
    applyTheme(_ctx, next) {
      paint = next;
      if (dom) applyTheme(dom, paint);
    },
    remove() {
      map?.off('rotate', onRotate);
      boatAnimator.destroy();
      apparentAnimator.destroy();
      trueAnimator.destroy();
      sectorAnimator.destroy();
      marker?.remove();
      marker = undefined;
      dom = undefined;
      map = undefined;
    },
    reset() {
      lastLon = undefined;
      lastLat = undefined;
      lastNoGoAngleRad = undefined;
      lastArcMarginRad = undefined;
      cardRotation = undefined;
      boatRotation = undefined;
      apparentRotation = undefined;
      trueRotation = undefined;
      sectorRotation = undefined;
      sectorReference = undefined;
      windDirectionRange = undefined;
      sectorTracker.reset();
      directionRangeTracker.reset();
      boatAnimator.reset();
      apparentAnimator.reset();
      trueAnimator.reset();
      sectorAnimator.reset();
    },
  };
}
