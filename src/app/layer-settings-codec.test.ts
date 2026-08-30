import { describe, expect, it } from 'vitest';
import { layerSettingsCodec } from './layer-settings-codec';

// The codec guards the trust boundary between storage JSON and the layer settings both layer
// stores share, so a malformed entry is replaced wholesale (invalid) while a well-formed one whose
// shape drifted decodes as migrated: the store keeps the cleaned value and rewrites storage.
describe('layerSettingsCodec', () => {
  it('accepts a plain visible-and-opacity entry unchanged', () => {
    const result = layerSettingsCodec.decode({
      'chart:server:enc': { visible: true, opacity: 0.8 },
    });
    expect(result.state).toBe('valid');
    if (result.state === 'invalid') return;
    expect(result.value['chart:server:enc']).toEqual({ visible: true, opacity: 0.8 });
  });

  it('retains a cellSizeScale on decode', () => {
    const result = layerSettingsCodec.decode({
      cells: { visible: true, opacity: 0.8, cellSizeScale: 2 },
    });
    expect(result.state).toBe('valid');
    if (result.state === 'invalid') return;
    expect(result.value.cells).toEqual({ visible: true, opacity: 0.8, cellSizeScale: 2 });
  });

  it('retains labelSizeScale so the label-size control survives a reload', () => {
    const result = layerSettingsCodec.decode({
      cells: { visible: true, opacity: 0.8, labelSizeScale: 1.5 },
    });
    expect(result.state).toBe('valid');
    if (result.state === 'invalid') return;
    expect(result.value.cells).toEqual({ visible: true, opacity: 0.8, labelSizeScale: 1.5 });
  });

  it('retains valid displayDepth and cellPortrayal values', () => {
    const result = layerSettingsCodec.decode({
      cells: {
        visible: true,
        opacity: 1,
        displayDepth: 'predicted',
        cellPortrayal: 'text',
      },
    });
    expect(result.state).toBe('valid');
    if (result.state === 'invalid') return;
    expect(result.value.cells).toEqual({
      visible: true,
      opacity: 1,
      displayDepth: 'predicted',
      cellPortrayal: 'text',
    });
  });

  it('retains conservative and shaded without flagging them migrated', () => {
    const result = layerSettingsCodec.decode({
      cells: {
        visible: true,
        opacity: 1,
        displayDepth: 'conservative',
        cellPortrayal: 'shaded',
      },
    });
    expect(result.state).toBe('valid');
    if (result.state === 'invalid') return;
    expect(result.value.cells).toEqual({
      visible: true,
      opacity: 1,
      displayDepth: 'conservative',
      cellPortrayal: 'shaded',
    });
  });

  it('keeps every optional key without a perpetual migrated flag', () => {
    const result = layerSettingsCodec.decode({
      cells: {
        visible: true,
        opacity: 0.9,
        cellSizeScale: 2,
        labelSizeScale: 1.5,
        displayDepth: 'predicted',
        cellPortrayal: 'shaded',
      },
    });
    expect(result.state).toBe('valid');
  });

  it('drops an unknown displayDepth or cellPortrayal value and flags the entry migrated', () => {
    const result = layerSettingsCodec.decode({
      cells: {
        visible: true,
        opacity: 1,
        displayDepth: 'instantaneous',
        cellPortrayal: 'wireframe',
      },
    });
    expect(result.state).toBe('migrated');
    if (result.state === 'invalid') return;
    expect(result.value.cells).toEqual({ visible: true, opacity: 1 });
  });

  it('drops a non-string displayDepth or cellPortrayal value', () => {
    const result = layerSettingsCodec.decode({
      cells: { visible: true, opacity: 1, displayDepth: 1, cellPortrayal: true },
    });
    expect(result.state).toBe('migrated');
    if (result.state === 'invalid') return;
    expect(result.value.cells).toEqual({ visible: true, opacity: 1 });
  });

  it('keeps a valid optional field beside a dropped unknown key', () => {
    const result = layerSettingsCodec.decode({
      cells: { visible: true, opacity: 1, cellSizeScale: 2, tint: 'blue' },
    });
    expect(result.state).toBe('migrated');
    if (result.state === 'invalid') return;
    expect(result.value.cells).toEqual({ visible: true, opacity: 1, cellSizeScale: 2 });
  });

  it('rejects an out-of-range cellSizeScale', () => {
    expect(
      layerSettingsCodec.decode({ cells: { visible: true, opacity: 1, cellSizeScale: 32 } }).state,
    ).toBe('invalid');
    expect(
      layerSettingsCodec.decode({ cells: { visible: true, opacity: 1, cellSizeScale: 0 } }).state,
    ).toBe('invalid');
  });

  it('rejects an out-of-range labelSizeScale', () => {
    expect(
      layerSettingsCodec.decode({ cells: { visible: true, opacity: 1, labelSizeScale: 4 } }).state,
    ).toBe('invalid');
    expect(
      layerSettingsCodec.decode({ cells: { visible: true, opacity: 1, labelSizeScale: 0.25 } })
        .state,
    ).toBe('invalid');
  });

  it('rejects a malformed entry outright', () => {
    expect(layerSettingsCodec.decode({ cells: { visible: true } }).state).toBe('invalid');
    expect(layerSettingsCodec.decode({ cells: { visible: 'yes', opacity: 1 } }).state).toBe(
      'invalid',
    );
    expect(layerSettingsCodec.decode({ cells: { visible: true, opacity: 3 } }).state).toBe(
      'invalid',
    );
    expect(layerSettingsCodec.decode({ cells: 'nope' }).state).toBe('invalid');
    expect(layerSettingsCodec.decode(7).state).toBe('invalid');
  });

  it('round-trips through set-style decode after a full manager snapshot', () => {
    const snapshot = {
      'chart:server:enc': { visible: false, opacity: 0.8, cellSizeScale: 2 },
      cells: { visible: true, opacity: 1, labelSizeScale: 1.2, displayDepth: 'predicted' },
    };
    const result = layerSettingsCodec.decode(snapshot);
    expect(result.state).toBe('valid');
    if (result.state === 'invalid') return;
    expect(result.value).toEqual(snapshot);
  });
});
