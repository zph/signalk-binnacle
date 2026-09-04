import { describe, expect, it } from 'vitest';
import { filterRows, sortRows, toRows } from './mooring-rows';
import type { MooringPoint } from './moorings-types';

function mooring(
  id: string,
  name: string,
  status: MooringPoint['assessment']['status'],
): MooringPoint {
  return {
    id,
    name,
    position: { latitude: 41, longitude: -71 },
    category: 'mooring buoy',
    information: 'Guest harbor mooring',
    encCell: 'US5TEST',
    scaleBand: 'harbour',
    assessment: {
      status,
      score: 0,
      vesselName: id === 'a' ? 'Sea Bird' : undefined,
      evidence: id === 'b' ? ['Nearest current AIS target is 111 m away'] : [],
    },
  };
}

describe('mooring rows', () => {
  const rows = toRows([
    mooring('a', 'Alpha', 'likely-occupied'),
    mooring('b', 'Bravo', 'unknown'),
    mooring('c', 'Charlie', 'possible'),
  ]);

  it('searches NOAA details, observed vessels, and occupancy state', () => {
    expect(filterRows(rows, 'guest')).toHaveLength(3);
    expect(filterRows(rows, 'sea bird').map((row) => row.id)).toEqual(['a']);
    expect(filterRows(rows, 'likely occupied').map((row) => row.id)).toEqual(['a']);
    expect(filterRows(rows, '111 m away').map((row) => row.id)).toEqual(['b']);
    expect(filterRows(rows, 'US5TEST')).toHaveLength(3);
  });

  it('sorts likely, possible, and unknown observations deterministically', () => {
    expect(sortRows(rows, 'status', 'asc').map((row) => row.id)).toEqual(['a', 'c', 'b']);
    expect(sortRows(rows, 'status', 'desc').map((row) => row.id)).toEqual(['b', 'c', 'a']);
  });
});
