import { describe, expect, test } from "bun:test";
import { resolveArchiveDestination } from "./archive-path";

describe("resolveArchiveDestination", () => {
  test("keeps normal archive entries inside the output directory", () => {
    expect(resolveArchiveDestination("/tmp/site", "guide/index.html")).toBe(
      "/tmp/site/guide/index.html",
    );
  });

  test("rejects traversal and absolute paths", () => {
    expect(() => resolveArchiveDestination("/tmp/site", "../secret")).toThrow(
      "unsafe path",
    );
    expect(() =>
      resolveArchiveDestination("/tmp/site", "a\\..\\secret"),
    ).toThrow("unsafe path");
    expect(() => resolveArchiveDestination("/tmp/site", "/etc/passwd")).toThrow(
      "unsafe path",
    );
  });
});
