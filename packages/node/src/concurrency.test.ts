import { expect, test } from "bun:test";
import { mapWithConcurrency } from "./concurrency.js";

test("bounds in-flight work and preserves input order", async () => {
  const values = [0, 1, 2, 3, 4, 5, 6, 7];
  let active = 0;
  let maximumActive = 0;

  const results = await mapWithConcurrency(values, 6, async (value) => {
    active++;
    maximumActive = Math.max(maximumActive, active);
    await Bun.sleep(1);
    active--;
    return value * 2;
  });

  expect(results).toEqual(values.map((value) => value * 2));
  expect(maximumActive).toBeLessThanOrEqual(6);
});

test("rejects with the first failure after in-flight work settles", async () => {
  let settled = 0;

  const operation = mapWithConcurrency([0, 1, 2, 3], 3, async (value) => {
    await Bun.sleep(1);
    settled++;
    if (value === 1) throw new Error("mapper failed");
    return value;
  });

  await expect(operation).rejects.toThrow("mapper failed");
  expect(settled).toBeGreaterThan(0);
});

test("rejects an invalid concurrency", async () => {
  await expect(
    mapWithConcurrency([1], 0, async (value) => value),
  ).rejects.toThrow("concurrency must be a positive integer");
});

test("returns immediately for an empty input", async () => {
  expect(
    await mapWithConcurrency([], 4, async () => {
      throw new Error("should not run");
    }),
  ).toEqual([]);
});
