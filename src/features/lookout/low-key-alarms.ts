import type { Severity } from '$entities/collision';
import type { ActiveNotification } from '$entities/notifications';
import { NOTIFICATION_PATH } from './collision-notification';
import { type AlarmButtonGrade, alarmButtonGrade } from './notification-actions';

const QUIET_PATHS = [
  NOTIFICATION_PATH,
  'notifications.navigation.closestApproach',
  'notifications.navigation.aground',
  'notifications.navigation.depth',
  'notifications.environment.depth',
];

export function isLowKeyAlarm(notification: Pick<ActiveNotification, 'path'>): boolean {
  return QUIET_PATHS.some(
    (path) => notification.path === path || notification.path.startsWith(`${path}.`),
  );
}

export function navigationAlarmButtonGrade(
  notifications: readonly ActiveNotification[],
  collision: Severity,
  shallow: boolean,
): AlarmButtonGrade {
  const notificationGrade = alarmButtonGrade(notifications);
  if (notificationGrade === 'alarm' || collision === 'danger' || shallow) return 'alarm';
  return notificationGrade === 'alert' || collision === 'warning' ? 'alert' : undefined;
}
