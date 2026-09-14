import { describe, expect, it } from 'vitest';
import type { ActiveNotification } from '$entities/notifications';
import { isLowKeyAlarm, navigationAlarmButtonGrade } from './low-key-alarms';

describe('low-key navigation alarms', () => {
  it('covers depth, grounding, and CPA paths without swallowing other alarms or lookalike paths', () => {
    for (const path of [
      'notifications.environment.depth.belowKeel',
      'notifications.navigation.aground',
      'notifications.navigation.collision',
      'notifications.navigation.closestApproach',
    ])
      expect(isLowKeyAlarm({ path })).toBe(true);
    for (const path of [
      'notifications.mob',
      'notifications.navigation.anchor',
      'notifications.electrical.batteries',
      'notifications.environment.depthSounder',
      'notifications.navigation.collisionSensor',
    ])
      expect(isLowKeyAlarm({ path })).toBe(false);
  });
  it('shows local warnings and danger even without a server notification and preserves unrelated severity', () => {
    expect(navigationAlarmButtonGrade([], 'clear', false)).toBeUndefined();
    expect(navigationAlarmButtonGrade([], 'warning', false)).toBe('alert');
    expect(navigationAlarmButtonGrade([], 'danger', false)).toBe('alarm');
    expect(navigationAlarmButtonGrade([], 'clear', true)).toBe('alarm');
    expect(
      navigationAlarmButtonGrade([{ state: 'emergency' } as ActiveNotification], 'warning', false),
    ).toBe('alarm');
  });
});
