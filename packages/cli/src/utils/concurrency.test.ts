import { expect, test } from "bun:test";
import { mapWithConcurrency } from "./concurrency";

test("maps with bounded concurrency while preserving input order", async () => {
  let active = 0;
  let maximumActive = 0;
  const values = Array.from({ length: 100 }, (_, index) => index);

  const results = await mapWithConcurrency(values, 6, async (value) => {
    active++;
    maximumActive = Math.max(maximumActive, active);
    await Bun.sleep(value % 3);
    active--;
    return value * 2;
  });

  expect(maximumActive).toBe(6);
  expect(results).toEqual(values.map((value) => value * 2));
});

test("waits for active work to settle before reporting a failure", async () => {
  let active = 0;
  const operation = mapWithConcurrency([0, 1, 2, 3], 3, async (value) => {
    active++;
    if (value === 1) {
      await Bun.sleep(1);
      active--;
      throw new Error("write failed");
    }
    await Bun.sleep(5);
    active--;
    return value;
  });

  await expect(operation).rejects.toThrow("write failed");
  expect(active).toBe(0);
});
