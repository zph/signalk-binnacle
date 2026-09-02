// UI history is deliberately local to this running display. It restores navigation surfaces, not
// browser URLs or mutable chart data, and therefore cannot replay a stale route edit or server action.
export interface ViewHistory<T> {
  push(view: T): void;
  back(): T | undefined;
  clear(): void;
  readonly canGoBack: boolean;
  readonly size: number;
}

export function createViewHistory<T>(limit = 12): ViewHistory<T> {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error('View history limit must be a positive integer.');
  }

  const entries: T[] = [];

  return {
    push(view): void {
      entries.push(view);
      if (entries.length > limit) entries.splice(0, entries.length - limit);
    },
    back(): T | undefined {
      return entries.pop();
    },
    clear(): void {
      entries.length = 0;
    },
    get canGoBack(): boolean {
      return entries.length > 0;
    },
    get size(): number {
      return entries.length;
    },
  };
}
