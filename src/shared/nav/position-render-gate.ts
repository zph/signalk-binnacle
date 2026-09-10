import type { LatLon } from '$shared/geo';
import { haversineMeters } from './distance';

// Display-only floor shared by map cameras and vessel overlays. Navigation calculations continue
// to consume every raw Signal K fix; this gate only avoids camera and source invalidations for GPS
// scatter that cannot move a rendered mark meaningfully.
export const POSITION_RENDER_DEADBAND_METERS = 0.75;

interface PositionRenderGateOptions {
  minDistanceMeters?: number;
  maxIntervalMs?: number;
  // A layout or camera-mode change can require a render even at an unchanged coordinate.
  variant?: string | number;
}

export interface PositionRenderGate {
  shouldRender(position: LatLon, options?: PositionRenderGateOptions): boolean;
  reset(): void;
}

export function createPositionRenderGate(now: () => number = Date.now): PositionRenderGate {
  let renderedPosition: LatLon | undefined;
  let renderedAt = Number.NEGATIVE_INFINITY;
  let renderedVariant: string | number | undefined;

  return {
    shouldRender(position, options = {}) {
      const minDistanceMeters = Math.max(
        0,
        options.minDistanceMeters ?? POSITION_RENDER_DEADBAND_METERS,
      );
      const maxIntervalMs =
        options.maxIntervalMs === undefined ? undefined : Math.max(0, options.maxIntervalMs);
      const distanceMeters = renderedPosition
        ? haversineMeters(
            renderedPosition.latitude,
            renderedPosition.longitude,
            position.latitude,
            position.longitude,
          )
        : Number.POSITIVE_INFINITY;
      const variantChanged = options.variant !== renderedVariant;
      const overdueMovedPosition =
        distanceMeters > 0 && maxIntervalMs !== undefined && now() - renderedAt >= maxIntervalMs;
      if (
        renderedPosition &&
        !variantChanged &&
        distanceMeters < minDistanceMeters &&
        !overdueMovedPosition
      ) {
        return false;
      }
      renderedPosition = { ...position };
      renderedAt = now();
      renderedVariant = options.variant;
      return true;
    },
    reset() {
      renderedPosition = undefined;
      renderedAt = Number.NEGATIVE_INFINITY;
      renderedVariant = undefined;
    },
  };
}
