import type {
  CurrentEvent,
  TideEvent,
  TideSample,
  TideStationSelection,
  TidesSource,
} from '$entities/tides';
import {
  formatFixed,
  formatKnots,
  landDistanceUnit,
  METERS_PER_MILE,
  MINUTE_MS,
  metersToFeet,
  type UnitsMode,
} from '$shared/lib';

// The display edge: SI in, formatted strings out. Tide heights are shown in both meters and feet,
// with the preferred unit first, current rates in knots, the conventional units a mariner reads.

function heightMeters(meters: number): string {
  return `${formatFixed(meters, 2)} m`;
}

function heightFeet(meters: number): string {
  return `${formatFixed(metersToFeet(meters) ?? 0, 1)} ft`;
}

export function formatTideHeight(meters: number, mode: UnitsMode): string {
  return mode === 'imperial' ? heightFeet(meters) : heightMeters(meters);
}

// The other unit, shown in parentheses beside the primary height.
export function formatTideHeightSecondary(meters: number, mode: UnitsMode): string {
  return mode === 'imperial' ? heightMeters(meters) : heightFeet(meters);
}

export function formatCurrentRate(mps: number): string {
  return `${formatKnots(mps)} kn`;
}

// The distance to the nearest station for the proximity readout: whole kilometers or statute
// miles, with a "<1" floor.
export function formatStationDistance(meters: number, mode: UnitsMode): string {
  const value = mode === 'imperial' ? meters / METERS_PER_MILE : meters / 1000;
  const unit = landDistanceUnit(mode);
  return value < 1 ? `<1 ${unit}` : `${Math.round(value)} ${unit}`;
}

// The quiet provenance line under the readings: which source served the tide prediction and which
// part of the result always comes from NOAA CO-OPS.
export function tideSourceNote(
  source: TidesSource | undefined,
  selection: TideStationSelection = { mode: 'automatic' },
): string {
  if (selection.mode === 'manual') {
    return 'The manually selected tide station and all tidal-current predictions use NOAA CO-OPS.';
  }
  if (source === 'signalk-tides') {
    return 'Automatic tide predictions use the signalk-tides plugin. Tidal-current predictions use NOAA CO-OPS.';
  }
  if (source === 'noaa-coops') {
    return 'Automatic tide and tidal-current predictions use NOAA CO-OPS.';
  }
  return '';
}

// The high and low events at or after a reference time, soonest first, for the next-tide readout.
// Events arrive already sorted ascending by time (both the CO-OPS and signalk-tides parsers sort),
// and filter preserves order, so no re-sort is needed on this per-tick path.
export function upcomingEvents(events: TideEvent[], nowMs: number): TideEvent[] {
  return events.filter((event) => event.timeMs >= nowMs);
}

// The next current event at or after a reference time, slack included: slack water is the
// decisive event for a tidal-gate transit, so it must never be skipped for a later maximum.
// Events are pre-sorted ascending (see upcomingEvents), so the first match is the soonest.
export function nextCurrentEvent(events: CurrentEvent[], nowMs: number): CurrentEvent | undefined {
  return events.find((event) => event.timeMs >= nowMs);
}

// The next flood or ebb maximum at or after a reference time, for the secondary row shown when
// the soonest event is slack.
export function nextFlowEvent(events: CurrentEvent[], nowMs: number): CurrentEvent | undefined {
  return events.find((event) => event.timeMs >= nowMs && event.kind !== 'slack');
}

// The next high or low at or after a reference time, for the station marker label. Events are
// pre-sorted ascending (see upcomingEvents), so the first match is the soonest.
export function nextTideEvent(events: TideEvent[], nowMs: number): TideEvent | undefined {
  return events.find((event) => event.timeMs >= nowMs);
}

// Normalize the day's high and low turning points to a 0..1 box for an SVG tide curve: x over the
// span of events, y from the lowest tide (0) to the highest (1).
export function tideCurvePoints(events: TideEvent[]): Array<{ x: number; y: number }> {
  if (events.length === 0) return [];
  // Events are pre-sorted ascending by time, so the span ends are the first and last, no spread.
  const t0 = events[0].timeMs;
  const tSpan = events[events.length - 1].timeMs - t0 || 1;
  // One pass for the height extent, no spread into Math.min/max (which is unbounded in arg count).
  let h0 = events[0].heightMeters;
  let hMax = h0;
  for (const e of events) {
    if (e.heightMeters < h0) h0 = e.heightMeters;
    else if (e.heightMeters > hMax) hMax = e.heightMeters;
  }
  const hSpan = hMax - h0 || 1;
  return events.map((e) => ({ x: (e.timeMs - t0) / tSpan, y: (e.heightMeters - h0) / hSpan }));
}

// Estimate the tide height between two reported turning points. Tide height changes smoothly and
// is nearly level at a high or low, so cosine interpolation is a better local approximation than
// a straight line while remaining explicit about the limited high/low input available here.
export function tideHeightAt(events: TideEvent[], timeMs: number): number | undefined {
  if (events.length === 0 || timeMs < events[0].timeMs) return undefined;
  for (let index = 1; index < events.length; index++) {
    const before = events[index - 1];
    const after = events[index];
    if (timeMs > after.timeMs) continue;
    const fraction = (timeMs - before.timeMs) / (after.timeMs - before.timeMs || 1);
    const eased = (1 - Math.cos(Math.PI * fraction)) / 2;
    return before.heightMeters + (after.heightMeters - before.heightMeters) * eased;
  }
  return timeMs === events[events.length - 1].timeMs
    ? events[events.length - 1].heightMeters
    : undefined;
}

// Fill the space between high and low turning points with a bounded smooth series for the chart.
// This is derived presentation data, not a replacement for the provider's authoritative extrema.
export function tideCurveSamples(events: TideEvent[], stepMs = 15 * MINUTE_MS): TideSample[] {
  if (events.length === 0 || !Number.isFinite(stepMs) || stepMs <= 0) return [];
  const samples: TideSample[] = [];
  for (let index = 1; index < events.length; index++) {
    const before = events[index - 1];
    const after = events[index];
    if (index === 1) samples.push({ timeMs: before.timeMs, heightMeters: before.heightMeters });
    for (let timeMs = before.timeMs + stepMs; timeMs < after.timeMs; timeMs += stepMs) {
      const heightMeters = tideHeightAt([before, after], timeMs);
      if (heightMeters !== undefined) samples.push({ timeMs, heightMeters });
    }
    samples.push({ timeMs: after.timeMs, heightMeters: after.heightMeters });
  }
  if (events.length === 1) {
    samples.push({ timeMs: events[0].timeMs, heightMeters: events[0].heightMeters });
  }
  return samples;
}

export interface TideDepthCurve {
  tide: Array<{ x: number; y: number }>;
  estimatedDepth: Array<{ x: number; y: number }>;
  minimumMeters: number;
  maximumMeters: number;
  tideNowMeters: number;
}

// Put predicted tide height and sounder-based estimated depth on one physical meter scale. The
// estimated depth is the live whole-water-column sounder reading plus the predicted tide change
// from now to each turning point. It is an estimate, not surveyed bathymetry.
export function tideDepthCurvePoints(
  events: TideEvent[],
  nowMs: number,
  depthMeters: number,
  detailedSamples?: TideSample[],
): TideDepthCurve | undefined {
  const tideNow = detailedSamples?.length
    ? nearestTideSample(detailedSamples, nowMs)?.heightMeters
    : tideHeightAt(events, nowMs);
  if (tideNow === undefined || !Number.isFinite(depthMeters)) return undefined;

  const samples = detailedSamples?.length ? detailedSamples : tideCurveSamples(events);
  if (samples.length === 0) return undefined;
  const t0 = samples[0].timeMs;
  const tSpan = samples[samples.length - 1].timeMs - t0 || 1;
  const depthValues = samples.map((sample) => depthMeters + (sample.heightMeters - tideNow));
  let minimum = Math.min(samples[0].heightMeters, depthValues[0]);
  let maximum = Math.max(samples[0].heightMeters, depthValues[0]);
  for (let index = 1; index < samples.length; index++) {
    minimum = Math.min(minimum, samples[index].heightMeters, depthValues[index]);
    maximum = Math.max(maximum, samples[index].heightMeters, depthValues[index]);
  }
  const span = maximum - minimum || 1;
  const point = (sample: TideSample, value: number) => ({
    x: (sample.timeMs - t0) / tSpan,
    y: (value - minimum) / span,
  });
  return {
    tide: samples.map((sample) => point(sample, sample.heightMeters)),
    estimatedDepth: samples.map((sample, index) => point(sample, depthValues[index])),
    minimumMeters: minimum,
    maximumMeters: maximum,
    tideNowMeters: tideNow,
  };
}

export interface TideHoverReading {
  timeMs: number;
  tideHeightMeters: number;
  estimatedDepthMeters?: number;
}

export function tideHoverReading(
  events: TideEvent[],
  timeMs: number,
  depthMeters?: number,
  nowMs?: number,
  detailedSamples?: TideSample[],
): TideHoverReading | undefined {
  const detailed = detailedSamples?.length ? nearestTideSample(detailedSamples, timeMs) : undefined;
  const tideHeightMeters = detailed?.heightMeters ?? tideHeightAt(events, timeMs);
  if (tideHeightMeters === undefined) return undefined;
  const tideNow =
    nowMs === undefined
      ? undefined
      : detailedSamples?.length
        ? nearestTideSample(detailedSamples, nowMs)?.heightMeters
        : tideHeightAt(events, nowMs);
  return {
    timeMs: detailed?.timeMs ?? timeMs,
    tideHeightMeters,
    estimatedDepthMeters:
      depthMeters !== undefined && tideNow !== undefined
        ? depthMeters + (tideHeightMeters - tideNow)
        : undefined,
  };
}

function nearestTideSample(samples: TideSample[], timeMs: number): TideSample | undefined {
  if (samples.length === 0) return undefined;
  let low = 0;
  let high = samples.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (samples[middle].timeMs < timeMs) low = middle + 1;
    else high = middle;
  }
  const after = samples[low];
  const before = samples[low - 1];
  return before && Math.abs(before.timeMs - timeMs) <= Math.abs(after.timeMs - timeMs)
    ? before
    : after;
}

// Where "now" falls along the tide curve's x axis, or undefined when it is outside the event span.
export function nowFraction(events: TideEvent[], nowMs: number): number | undefined {
  if (events.length === 0) return undefined;
  // Pre-sorted ascending by time, so the span ends are the first and last entries.
  const t0 = events[0].timeMs;
  const t1 = events[events.length - 1].timeMs;
  if (nowMs < t0 || nowMs > t1) return undefined;
  return (nowMs - t0) / (t1 - t0 || 1);
}
