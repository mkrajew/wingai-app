/**
 * Async utilities.
 */

/**
 * Maps an async worker over `items` with a bounded number of concurrent
 * executions. Uses a sliding window: each of the `limit` runners pulls the
 * next item as soon as it finishes, keeping the pool full without starting
 * everything at once. Results preserve input order.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function run() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }

  const poolSize = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: poolSize }, run));
  return results;
}
