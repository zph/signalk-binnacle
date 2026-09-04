import type { LatLon } from '$shared/geo';
import {
  compareNavIdentity,
  defaultNavSort,
  filterNavRows,
  type NavSortState,
  navMetrics,
  SEARCH_COLLATOR,
  type SortableNavRow,
  type SortDir,
  sortNavRows,
} from '$shared/nav';
import type { MooringPoint } from './moorings-types';

export type MooringSort = 'name' | 'status' | 'distance' | 'bearing';

export interface MooringRow extends SortableNavRow {
  mooring: MooringPoint;
}

const STATUS_ORDER = { 'likely-occupied': 0, possible: 1, unknown: 2 } as const;

export function toRows(moorings: readonly MooringPoint[], vessel?: LatLon): MooringRow[] {
  return moorings.map((mooring) => ({
    mooring,
    id: mooring.id,
    name: mooring.name,
    ...navMetrics(vessel, mooring.position),
  }));
}

export function filterRows(rows: readonly MooringRow[], query: string): readonly MooringRow[] {
  return filterNavRows(rows, query, (row) => [
    row.mooring.name,
    row.mooring.category,
    row.mooring.information,
    row.mooring.encCell,
    row.mooring.assessment.vesselName,
    row.mooring.assessment.status.replace('-', ' '),
    ...row.mooring.assessment.evidence,
  ]);
}

export function sortRows(
  rows: readonly MooringRow[],
  key: MooringSort,
  dir: SortDir,
): MooringRow[] {
  if (key !== 'status') return sortNavRows(rows, key, dir);
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort(
    (left, right) =>
      sign *
      (STATUS_ORDER[left.mooring.assessment.status] -
        STATUS_ORDER[right.mooring.assessment.status] ||
        SEARCH_COLLATOR.compare(left.name, right.name) ||
        compareNavIdentity(left, right)),
  );
}

export function defaultSort(hasFix: boolean): NavSortState<MooringSort> {
  return defaultNavSort(hasFix);
}
