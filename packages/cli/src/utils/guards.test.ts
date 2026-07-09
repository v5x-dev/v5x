import { expect, test } from "bun:test";
import { requireOptionValue } from "./guards";

test("requires a value for bare string options", () => {
  expect(requireOptionValue("brain-a", "--port")).toBe("brain-a");
  expect(requireOptionValue(undefined, "--port")).toBeUndefined();
  expect(() => requireOptionValue(true, "--port")).toThrow(
    "--port requires a value",
  );
});
