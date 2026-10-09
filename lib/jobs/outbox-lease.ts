// ENG-04: the pure parts of the outbox runner (no database, no network), so
// they can be tested on their own.

export const MAX_ATTEMPTS = 8;
export const BATCH_SIZE = 20;
export const SEND_CONCURRENCY = 4;
export const LEASE_MINUTES = 2;
export const DEFAULT_BUDGET_MS = 8_000;

export const backoffMinutes = (attempt: number) => Math.min(240, 2 ** attempt);

/** How many events to claim next: a full batch, fewer near the limit, none once the time budget is spent. */
export function nextBatchSize(o: { limit: number; claimed: number; startedAt: number; now: number; budgetMs: number }): number {
  if (o.now - o.startedAt >= o.budgetMs) return 0;
  return Math.max(0, Math.min(BATCH_SIZE, o.limit - o.claimed));
}

/** Runs `fn` over `items` with at most `concurrency` in flight. `fn` must not throw. */
export async function mapPool<T>(items: readonly T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}
