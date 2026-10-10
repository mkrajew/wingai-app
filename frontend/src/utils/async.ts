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

export type PipelineOptions<T, P, R> = {
  /** First stage, e.g. the crop in the browser. */
  prepare: (item: T, index: number) => Promise<P>;
  /** Second stage, e.g. the request to the backend. It gets what `prepare` returned. */
  analyze: (prepared: P, item: T, index: number) => Promise<R>;
  /** How many items each stage works on at the same time. */
  prepareLimit: number;
  analyzeLimit: number;
  /** Called as soon as an item is prepared, before its analysis starts. */
  onPrepared?: (prepared: P, item: T, index: number) => void;
  /** Called as soon as an item is analysed. */
  onAnalyzed?: (result: R, item: T, index: number) => void;
  signal?: AbortSignal;
};

/**
 * Works through `items` in two stages that run at the same time. Both stages take the items in order, each with
 * its own limit. An item is analysed as soon as it is prepared, without waiting for the other items, and
 * preparing does not wait for the analysis, so the first stage runs ahead of the second.
 *
 * Resolves with the results of `analyze` in the order of the items. It rejects at once, without waiting for work
 * that is still running, when `signal` is aborted (with its reason) or when a stage throws. After that nothing new
 * starts and no callback is called.
 */
export async function runPipeline<T, P, R>(
  items: T[],
  options: PipelineOptions<T, P, R>,
): Promise<R[]> {
  const { prepare, analyze, onPrepared, onAnalyzed, signal } = options;
  const results = new Array<R>(items.length);
  if (items.length === 0) return results;

  let stopped = false;
  let rejectRun: (reason: unknown) => void = () => {};
  const failed = new Promise<never>((_, reject) => {
    rejectRun = reject;
  });
  failed.catch(() => {});

  // One promise per item that settles when the item is prepared.
  const settlers: Array<{ resolve: (value: P) => void; reject: (reason: unknown) => void }> = [];
  const ready = items.map(
    (_, i) =>
      new Promise<P>((resolve, reject) => {
        settlers[i] = { resolve, reject };
      }),
  );
  ready.forEach((promise) => promise.catch(() => {}));

  const stop = (reason: unknown) => {
    if (stopped) return;
    stopped = true;
    rejectRun(reason);
    settlers.forEach((settler) => settler.reject(reason));
  };
  if (signal?.aborted) stop(signal.reason);
  else signal?.addEventListener("abort", () => stop(signal.reason), { once: true });

  let nextToPrepare = 0;
  const prepareWorker = async () => {
    while (!stopped) {
      const i = nextToPrepare++;
      if (i >= items.length) return;
      try {
        const prepared = await prepare(items[i], i);
        if (stopped) return;
        onPrepared?.(prepared, items[i], i);
        settlers[i].resolve(prepared);
      } catch (error) {
        stop(error);
        return;
      }
    }
  };

  let nextToAnalyze = 0;
  const analyzeWorker = async () => {
    while (!stopped) {
      const i = nextToAnalyze++;
      if (i >= items.length) return;
      try {
        const prepared = await ready[i];
        if (stopped) return;
        const result = await analyze(prepared, items[i], i);
        if (stopped) return;
        results[i] = result;
        onAnalyzed?.(result, items[i], i);
      } catch (error) {
        stop(error);
        return;
      }
    }
  };

  const count = (limit: number) => Math.max(1, Math.min(limit, items.length));
  const workers = [
    ...Array.from({ length: count(options.prepareLimit) }, prepareWorker),
    ...Array.from({ length: count(options.analyzeLimit) }, analyzeWorker),
  ];
  await Promise.race([Promise.all(workers), failed]);
  return results;
}
