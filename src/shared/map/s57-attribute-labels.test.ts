import { createExpression } from '@maplibre/maplibre-gl-style-spec';
import type { ExpressionSpecification } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import { clearanceLabel, seabedLabel, surveyQualityLabel } from './s57-attribute-labels';

function evaluate(
  expression: ExpressionSpecification,
  properties: Record<string, unknown>,
  unit = 'm',
) {
  const parsed = createExpression(expression, 'enc-label', null, { unit });
  if (parsed.result === 'error') throw new Error(JSON.stringify(parsed.value));
  return parsed.value.evaluate({ zoom: 12 }, { type: 'Point', properties } as never);
}

describe('ENC attribute labels', () => {
  it.each([4, '4', [4], ['4'], '(1:4)'])('decodes sand from GDAL representation %j', (NATSUR) => {
    expect(evaluate(seabedLabel(), { NATSUR })).toBe('Bottom: Sand');
  });
  it.each(['1,4', [1, 4], ['1', '4'], '(2:1,4)'])(
    'preserves mixed bottom materials %j',
    (NATSUR) => {
      expect(evaluate(seabedLabel(), { NATSUR })).toBe('Bottom: Mud Sand');
    },
  );
  it('does not confuse coral with sand or unknown bottom with good holding', () => {
    expect(evaluate(seabedLabel(), { NATSUR: 14 })).toBe('Bottom: Coral');
    expect(evaluate(seabedLabel(), {})).toBe('Bottom: unspecified');
  });
  it('distinguishes charted bridge states and converts clearance at display time', () => {
    expect(evaluate(clearanceLabel('Bridge'), { VERCCL: 4, VERCOP: 20 })).toBe(
      'Bridge · Charted closed clearance 4 m · Charted open clearance 20 m',
    );
    expect(evaluate(clearanceLabel('Cable'), { VERCSA: 10 }, 'ft')).toBe(
      'Cable · Charted safe clearance 32.8 ft',
    );
  });
  it.each([undefined, null, '', 'bad', -1])('never invents a clearance from %j', (VERCLR) => {
    expect(evaluate(clearanceLabel('Cable'), { VERCLR })).toBe('Cable · Clearance unspecified');
  });
  it('retains zero clearance and does not imply survey quality for missing data', () => {
    expect(evaluate(clearanceLabel('Bridge'), { VERCLR: 0 })).toContain('clearance 0 m');
    expect(evaluate(surveyQualityLabel(), { CATZOC: 1 })).toBe('Survey ZOC A1');
    expect(evaluate(surveyQualityLabel(), { CATZOC: '6' })).toBe('Survey ZOC unassessed');
    expect(evaluate(surveyQualityLabel(), {})).toBe('Survey quality unspecified');
  });
});
