import { describe, expect, it } from 'vitest';
import {
  defaultTutorialProgress,
  tutorialDeviceFor,
  tutorialFlowsFor,
  tutorialProgressCodec,
} from './tutorial';

describe('tutorial model', () => {
  it('selects a device from the phone breakpoint and pointer type', () => {
    expect(tutorialDeviceFor(390, true)).toBe('phone');
    expect(tutorialDeviceFor(834, true)).toBe('tablet');
    expect(tutorialDeviceFor(1440, false)).toBe('computer');
  });

  it('orders all common flows for each device', () => {
    expect(tutorialFlowsFor('phone').map((flow) => flow.id)).toEqual([
      'chart',
      'safety',
      'offline',
      'passage',
      'instruments',
      'review',
    ]);
    expect(tutorialFlowsFor('computer').map((flow) => flow.id)).toEqual([
      'chart',
      'passage',
      'instruments',
      'offline',
      'safety',
      'review',
    ]);
  });

  it('rejects invalid progress and normalizes duplicate completion ids', () => {
    expect(tutorialProgressCodec.decode({ version: 1, status: 'active' })).toEqual({
      state: 'invalid',
    });
    expect(
      tutorialProgressCodec.decode({
        ...defaultTutorialProgress(),
        status: 'active',
        completedFlowIds: ['chart', 'chart'],
        activeFlowId: 'passage',
        stepIndex: 2,
      }),
    ).toEqual({
      state: 'migrated',
      value: {
        version: 1,
        status: 'active',
        completedFlowIds: ['chart'],
        activeFlowId: 'passage',
        stepIndex: 2,
      },
    });
  });
});
