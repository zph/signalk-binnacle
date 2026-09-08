// Sail Wayfinder orchestration for readiness, calculation progress, cancellation, and route saving.

import type { Route } from '$entities/route';
import { ErrorState } from '$shared/lib';
import {
  cancelWayfinderPlan,
  fetchWayfinderCapabilities,
  fetchWayfinderRouteGeometry,
  fetchWayfinderStatus,
  saveWayfinderPlan,
  startWayfinderPlan,
  type WayfinderCapabilities,
  type WayfinderConstraints,
  type WayfinderRouteGeometry,
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
  let previewRoute = $state<Route | undefined>();
  let routes = $state<WayfinderRouteGeometry[]>([]);
  let frontiers = $state<Array<NonNullable<WayfinderStatus['frontier']>>>([]);
  let selectedAlternativeIndex = $state(0);
  let lastFrontierProgress = -1;
  let operation = 0;
  const error = new ErrorState();

  async function refresh(draftPath?: string): Promise<void> {
    checking = true;
    error.clear();
    try {
      const next = await fetchWayfinderCapabilities(deps.origin, deps.getToken(), draftPath);
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
    previewRoute = route;
    routes = [];
    frontiers = [];
    lastFrontierProgress = -1;
    selectedAlternativeIndex = 0;
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
      if (
        next.state === 'calculating' &&
        next.frontier?.length &&
        next.progress !== lastFrontierProgress
      ) {
        lastFrontierProgress = next.progress;
        frontiers = [...frontiers, next.frontier].slice(-64);
      }
      status = next;
      if (next.state !== 'calculating') {
        busy = false;
        if (next.state === 'complete') {
          const indexes = next.alternatives
            ?.filter((alternative) => alternative.complete)
            .map((alternative) => alternative.index) ?? [0];
          routes = (
            await Promise.all(
              indexes.map((index) =>
                fetchWayfinderRouteGeometry(deps.origin, deps.getToken(), index),
              ),
            )
          ).filter((route): route is WayfinderRouteGeometry => route !== undefined);
        }
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
    routes = [];
    frontiers = [];
    if (!cancelled) error.flag('Sail Wayfinder could not cancel the calculation.');
  }

  async function save(name: string, alternativeIndex = 0): Promise<void> {
    if (busy || status.state !== 'complete') return;
    busy = true;
    error.clear();
    const routeId = await saveWayfinderPlan(deps.origin, deps.getToken(), name, alternativeIndex);
    if (!routeId) {
      busy = false;
      error.flag('Sail Wayfinder could not save the planned route.');
      return;
    }
    await deps.onSaved(routeId);
    busy = false;
    status = { state: 'idle', progress: 0, message: 'Route saved. Navigation was not started.' };
    previewRoute = undefined;
    routes = [];
    frontiers = [];
  }

  function preview(route: Route | undefined): void {
    if (busy) return;
    previewRoute = route;
    routes = [];
    frontiers = [];
    lastFrontierProgress = -1;
    selectedAlternativeIndex = 0;
  }

  function selectAlternative(index: number): void {
    if (routes.some((route) => route.index === index)) selectedAlternativeIndex = index;
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
    get previewRoute() {
      return previewRoute;
    },
    get routes() {
      return routes;
    },
    get frontiers() {
      return frontiers;
    },
    get selectedAlternativeIndex() {
      return selectedAlternativeIndex;
    },
    get error() {
      return error.message;
    },
    refresh,
    plan,
    cancel,
    save,
    preview,
    selectAlternative,
  };
}
