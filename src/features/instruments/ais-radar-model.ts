import type { AisTargetView } from '$entities/ais';
import type { Assessment, Severity } from '$entities/collision';
import type { LatLon } from '$shared/geo';
import { formatKnotsOr, formatNm, formatTcpaMin, RAD_TO_DEG } from '$shared/lib';
import { haversineMeters, rhumbBearingRad } from '$shared/nav';

export const AIS_RADAR_RANGES_NM = [0.5, 1, 2, 3, 6, 12, 24] as const;
export type AisRadarRangeNm = (typeof AIS_RADAR_RANGES_NM)[number];
export const DEFAULT_AIS_RADAR_RANGE_NM: AisRadarRangeNm = 6;

export function isAisRadarRangeNm(value: unknown): value is AisRadarRangeNm {
  return AIS_RADAR_RANGES_NM.includes(value as AisRadarRangeNm);
}

export interface AisRadarContact {
  id: string;
  name: string;
  x: number;
  y: number;
  directionDeg: number;
  vectorX: number;
  vectorY: number;
  rangeMeters: number;
  bearingRad: number;
  cpaMeters?: number;
  tcpaSeconds?: number;
  sogText: string;
  cpaText: string;
  severity: Severity | 'unassessed';
}

export interface IndexedAisRadarContact extends AisRadarContact {
  index: number;
}

/** Keep a compact plot index stable for as long as each target remains in the current radar set. */
export function createAisRadarContactIndexer(): (
  contacts: readonly AisRadarContact[],
) => IndexedAisRadarContact[] {
  const assigned = new Map<string, number>();

  return (contacts) => {
    const activeIds = new Set(contacts.map((contact) => contact.id));
    for (const id of assigned.keys()) {
      if (!activeIds.has(id)) assigned.delete(id);
    }

    const used = new Set(assigned.values());
    let nextAvailable = 1;
    const indexed = contacts.map((contact) => {
      let index = assigned.get(contact.id);
      if (index === undefined) {
        while (used.has(nextAvailable)) nextAvailable += 1;
        index = nextAvailable;
        assigned.set(contact.id, index);
        used.add(index);
      }
      return { ...contact, index };
    });

    return indexed.sort((a, b) => a.index - b.index);
  };
}

interface BuildAisRadarContactsOptions {
  ownPosition: LatLon;
  targets: readonly AisTargetView[];
  assessment: Assessment;
  rangeNm: AisRadarRangeNm;
  maxContacts?: number;
}

const METERS_PER_NAUTICAL_MILE = 1852;
const VECTOR_SECONDS = 360;
const DEFAULT_MAX_CONTACTS = 96;
const NEAR_CONTACT_PRIORITY_NM = 2;

function contactName(target: AisTargetView): string {
  const name = target.name?.trim();
  if (name) return name.length > 16 ? `${name.slice(0, 15)}…` : name;
  const suffix = target.id.split(':').at(-1) ?? target.id;
  return suffix.length > 12 ? suffix.slice(-12) : suffix;
}

function riskRank(severity: AisRadarContact['severity']): number {
  if (severity === 'danger') return 0;
  if (severity === 'warning') return 1;
  if (severity === 'unassessed') return 2;
  return 3;
}

export function buildAisRadarContacts({
  ownPosition,
  targets,
  assessment,
  rangeNm,
  maxContacts = DEFAULT_MAX_CONTACTS,
}: BuildAisRadarContactsOptions): AisRadarContact[] {
  const rangeMeters = rangeNm * METERS_PER_NAUTICAL_MILE;
  const assessed = new Map(assessment.contacts.map((contact) => [contact.id, contact]));
  const unassessed = new Set(assessment.unassessed.map((contact) => contact.id));
  const contacts: AisRadarContact[] = [];

  for (const target of targets) {
    const distance = haversineMeters(
      ownPosition.latitude,
      ownPosition.longitude,
      target.position.latitude,
      target.position.longitude,
    );
    if (distance > rangeMeters) continue;

    const bearing = rhumbBearingRad(ownPosition, target.position);
    const normalizedDistance = distance / rangeMeters;
    const risk = assessed.get(target.id);
    const cpaMeters = target.cpaMeters ?? risk?.cpaMeters;
    const tcpaSeconds = target.tcpaSeconds ?? risk?.tcpaSeconds;
    const course = target.cogRad;
    const sogMps = target.sogMps;
    const projected = course === undefined ? 0 : ((sogMps ?? 0) * VECTOR_SECONDS) / rangeMeters;

    contacts.push({
      id: target.id,
      name: contactName(target),
      x: Math.sin(bearing) * normalizedDistance,
      y: -Math.cos(bearing) * normalizedDistance,
      directionDeg: (target.headingRad ?? target.cogRad ?? 0) * RAD_TO_DEG,
      vectorX: course === undefined ? 0 : Math.sin(course) * projected,
      vectorY: course === undefined ? 0 : -Math.cos(course) * projected,
      rangeMeters: distance,
      bearingRad: bearing,
      cpaMeters,
      tcpaSeconds,
      sogText: sogMps === undefined ? 'SOG --' : `SOG ${formatKnotsOr(sogMps)} kn`,
      cpaText:
        cpaMeters === undefined || tcpaSeconds === undefined
          ? 'CPA -- / --'
          : `CPA ${formatNm(cpaMeters)} nm / ${formatTcpaMin(tcpaSeconds)} min`,
      severity: risk?.severity ?? (unassessed.has(target.id) ? 'unassessed' : 'clear'),
    });
  }

  contacts.sort(
    (a, b) => riskRank(a.severity) - riskRank(b.severity) || a.rangeMeters - b.rangeMeters,
  );
  if (contacts.length <= maxContacts) return contacts;

  // The plot cap protects instrument rendering in dense traffic, but distant risk-ranked contacts
  // must never evict a nearby vessel. Admit every contact in the near ring first, then fill the
  // remaining capacity in the existing risk-first order. If the near ring alone exceeds the cap,
  // the closest contacts win.
  const nearRangeMeters = Math.min(rangeNm, NEAR_CONTACT_PRIORITY_NM) * METERS_PER_NAUTICAL_MILE;
  const near = contacts
    .filter((contact) => contact.rangeMeters <= nearRangeMeters)
    .sort((a, b) => a.rangeMeters - b.rangeMeters);
  if (near.length >= maxContacts) return near.slice(0, maxContacts);

  const selected = new Set(near.map((contact) => contact.id));
  const admitted = [...near];
  for (const contact of contacts) {
    if (selected.has(contact.id)) continue;
    admitted.push(contact);
    if (admitted.length === maxContacts) break;
  }
  return admitted;
}
