import type { ExpressionSpecification } from 'maplibre-gl';

function hasCode(attribute: string, code: number): ExpressionSpecification {
  const value: ExpressionSpecification = ['to-string', ['coalesce', ['get', attribute], '']];
  // GDAL can emit scalar values, JSON arrays, comma lists, or counted lists such as (2:1,4).
  return [
    'any',
    ['==', value, String(code)],
    ...[
      `,${code},`,
      `[${code},`,
      `,${code}]`,
      `[${code}]`,
      `:${code},`,
      `,${code})`,
      `:${code})`,
      `"${code}"`,
    ].map((token): ExpressionSpecification => ['in', token, ['concat', ',', value, ',']]),
  ];
}

export function seabedLabel(): ExpressionSpecification {
  const materials = [
    [1, 'Mud'],
    [2, 'Clay'],
    [3, 'Silt'],
    [4, 'Sand'],
    [5, 'Stone'],
    [6, 'Gravel'],
    [7, 'Pebbles'],
    [8, 'Cobbles'],
    [9, 'Rock'],
    [11, 'Lava'],
    [14, 'Coral'],
    [17, 'Shells'],
    [18, 'Boulders'],
  ] as const;
  const known = materials.map(([code]) => hasCode('NATSUR', code));
  return [
    'case',
    ['any', ...known],
    [
      'concat',
      'Bottom:',
      ...materials.map(
        ([code, title]): ExpressionSpecification => [
          'case',
          hasCode('NATSUR', code),
          ` ${title}`,
          '',
        ],
      ),
    ],
    'Bottom: unspecified',
  ];
}

export function surveyQualityLabel(): ExpressionSpecification {
  return [
    'match',
    ['to-number', ['get', 'CATZOC'], 0],
    1,
    'Survey ZOC A1',
    2,
    'Survey ZOC A2',
    3,
    'Survey ZOC B',
    4,
    'Survey ZOC C',
    5,
    'Survey ZOC D',
    6,
    'Survey ZOC unassessed',
    'Survey quality unspecified',
  ];
}

function clearanceValue(attribute: string): ExpressionSpecification {
  return [
    'case',
    ['==', ['to-string', ['coalesce', ['get', attribute], '']], ''],
    -1,
    ['to-number', ['get', attribute], -1],
  ];
}

function measurement(value: ExpressionSpecification): ExpressionSpecification {
  const feet: ExpressionSpecification = ['==', ['global-state', 'unit'], 'ft'];
  const converted: ExpressionSpecification = ['case', feet, ['*', value, 3.280839895], value];
  return [
    'concat',
    ['number-format', ['/', ['floor', ['*', converted, 10]], 10], { 'max-fraction-digits': 1 }],
    ['case', feet, ' ft', ' m'],
  ];
}

export function clearanceLabel(title: string): ExpressionSpecification {
  const fields = [
    ['VERCSA', 'safe clearance'],
    ['VERCLR', 'clearance'],
    ['VERCCL', 'closed clearance'],
    ['VERCOP', 'open clearance'],
  ] as const;
  return [
    'concat',
    title,
    [
      'case',
      ['!=', ['to-string', ['coalesce', ['get', 'OBJNAM'], '']], ''],
      ['concat', ': ', ['to-string', ['get', 'OBJNAM']]],
      '',
    ],
    ...fields.map(
      ([field, label]): ExpressionSpecification => [
        'case',
        ['>=', clearanceValue(field), 0],
        ['concat', ` · Charted ${label} `, measurement(clearanceValue(field))],
        '',
      ],
    ),
    [
      'case',
      [
        'any',
        ...fields.map(([field]): ExpressionSpecification => ['>=', clearanceValue(field), 0]),
      ],
      '',
      ' · Clearance unspecified',
    ],
  ];
}
