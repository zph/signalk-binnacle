// Sail Wayfinder orchestration for readiness, calculation progress, cancellation, and route saving.

import type { Route } from '$entities/route';
import { ErrorState } from '$shared/lib';
import {
  cancelWayfinderPlan,
  fetchWayfinderCapabilities,
  fetchWayfinderStatus,
  saveWayfinderPlan,
  startWayfinderPlan,
  type WayfinderCapabilities,
  type WayfinderConstraints,
  type WayfinderStatus,
} from './wayfinder-client';

const POLL_MS = 750;

export function createWayfindingController(deps: {
  origin: string;
  getToken: () => string | undefined;
  onSaved: (routeId: string) => Promise<void>;
  wait?: (ms: number) => Promise<void>;
}) {
  let capabilities = $state<WayfinderCapabilities | undefined>();
  let status = $state<WayfinderStatus>({ state: 'idle', progress: 0 });
  let checking = $state(false);
  let busy = $state(false);
  let operation = 0;
  const error = new ErrorState();

  async function refresh(): Promise<void> {
    checking = true;
    error.clear();
    try {
      const next = await fetchWayfinderCapabilities(deps.origin, deps.getToken());
      capabilities = next;
      if (!next) {
        error.flag(
          'Sail Wayfinder could not be reached. Check that the plugin is installed and running.',
        );
      }
    } finally {
      checking = false;
    }
  }

  async function plan(
    route: Route,
    departureTime: string,
    constraints: WayfinderConstraints,
  ): Promise<void> {
    if (busy) return;
    const sequence = ++operation;
    busy = true;
    error.clear();
    status = { state: 'calculating', progress: 0 };
    const startResult = await startWayfinderPlan(
      deps.origin,
      deps.getToken(),
      route,
      departureTime,
      constraints,
    );
    if (!startResult.started) {
      if (sequence === operation) {
        busy = false;
        status = { state: 'failed', progress: 0 };
        error.flag(
          startResult.error ??
            'Sail Wayfinder refused the plan. Check its forecast coverage and configuration.',
        );
      }
      return;
    }
    const wait =
      deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    while (sequence === operation) {
      await wait(POLL_MS);
      const next = await fetchWayfinderStatus(deps.origin, deps.getToken());
      if (sequence !== operation) return;
      if (!next) {
        busy = false;
        status = { state: 'failed', progress: status.progress };
        error.flag(
          'Sail Wayfinder status could not be read. The calculation may still be running.',
        );
        return;
      }
      status = next;
      if (next.state !== 'calculating') {
        busy = false;
        if (next.state === 'failed')
          error.flag(next.message ?? 'Sail Wayfinder could not calculate a route.');
        return;
      }
    }
  }

  async function cancel(): Promise<void> {
    operation += 1;
    const cancelled = await cancelWayfinderPlan(deps.origin, deps.getToken());
    busy = false;
    status = { state: 'idle', progress: 0 };
    if (!cancelled) error.flag('Sail Wayfinder could not cancel the calculation.');
  }

  async function save(name: string): Promise<void> {
    if (busy || status.state !== 'complete') return;
    busy = true;
    error.clear();
    const routeId = await saveWayfinderPlan(deps.origin, deps.getToken(), name);
    if (!routeId) {
      busy = false;
      error.flag('Sail Wayfinder could not save the planned route.');
      return;
    }
    await deps.onSaved(routeId);
    busy = false;
    status = { state: 'idle', progress: 0, message: 'Route saved. Navigation was not started.' };
  }

  return {
    get capabilities() {
      return capabilities;
    },
    get status() {
      return status;
    },
    get checking() {
      return checking;
    },
    get busy() {
      return busy;
    },
    get error() {
      return error.message;
    },
    refresh,
    plan,
    cancel,
    save,
  };
}
