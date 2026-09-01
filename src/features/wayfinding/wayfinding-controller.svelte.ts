import { ErrorState } from '$shared/lib';
import { fetchWayfinderCapabilities, type WayfinderCapabilities } from './wayfinder-client';

export function createWayfindingController(deps: {
  origin: string;
  getToken: () => string | undefined;
}) {
  let capabilities = $state<WayfinderCapabilities | undefined>();
  let checking = $state(false);
  const error = new ErrorState();

  async function refresh(): Promise<void> {
    checking = true;
    error.clear();
    try {
      const next = await fetchWayfinderCapabilities(deps.origin, deps.getToken());
      capabilities = next;
      if (!next)
        error.flag(
          'Wayfinder could not be reached. Check that the plugin is installed and running.',
        );
    } finally {
      checking = false;
    }
  }

  return {
    get capabilities(): WayfinderCapabilities | undefined {
      return capabilities;
    },
    get checking(): boolean {
      return checking;
    },
    get error(): string | undefined {
      return error.message;
    },
    refresh,
  };
}
