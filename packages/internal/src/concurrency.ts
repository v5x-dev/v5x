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
