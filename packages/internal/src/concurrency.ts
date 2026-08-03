export async function mapWithConcurrency<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  mapper: (value: Input, index: number) => Promise<Output>,
): Promise<Output[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("concurrency must be a positive integer");
  }
  if (values.length === 0) return [];

  const results = new Array<Output>(values.length);
  let nextIndex = 0;
  let failed = false;

  async function worker(): Promise<void> {
    while (!failed) {
      const index = nextIndex++;
      if (index >= values.length) return;
      const value = values[index]!;

      try {
        results[index] = await mapper(value, index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    () => worker(),
  );
  const settled = await Promise.allSettled(workers);
  const rejection = settled.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (rejection !== undefined) throw rejection.reason;
  return results;
}

/**
 * Map a contiguous integer range without first allocating an array containing
 * every page number. Results retain input order, just like mapWithConcurrency.
 */
export async function mapRangeWithConcurrency<Output>(
  start: number,
  endExclusive: number,
  concurrency: number,
  mapper: (value: number, index: number) => Promise<Output>,
): Promise<Output[]> {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(endExclusive)) {
    throw new Error("range bounds must be safe integers");
  }
  if (endExclusive < start) {
    throw new Error("range end must not be less than range start");
  }
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("concurrency must be a positive integer");
  }

  const length = endExclusive - start;
  if (length === 0) return [];

  const results = new Array<Output>(length);
  let nextIndex = 0;
  let failed = false;

  async function worker(): Promise<void> {
    while (!failed) {
      const index = nextIndex++;
      if (index >= length) return;
      try {
        results[index] = await mapper(start + index, index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, length) }, () =>
    worker(),
  );
  const settled = await Promise.allSettled(workers);
  const rejection = settled.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (rejection !== undefined) throw rejection.reason;
  return results;
}
