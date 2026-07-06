import { describe, expect, test } from "bun:test";
import { FileVendor } from "@v5x/serial";
import { parseBrainFilePath, VENDOR_PREFIXES, VENDORS } from "./brainPath";

describe("parseBrainFilePath", () => {
  test("keeps bare filenames on the default USER vendor", () => {
    expect(parseBrainFilePath("program.bin")).toEqual({
      filename: "program.bin",
      vendor: FileVendor.USER,
    });
  });

  test("maps every prefix printed by dir back to its vendor", () => {
    for (const vendor of VENDORS) {
      expect(
        parseBrainFilePath(`${VENDOR_PREFIXES[vendor]}slot_1.bin`),
      ).toEqual({ filename: "slot_1.bin", vendor });
    }
  });

  test("parses known prefixes explicitly", () => {
    expect(parseBrainFilePath("user/program.bin")).toEqual({
      filename: "program.bin",
      vendor: FileVendor.USER,
    });
    expect(parseBrainFilePath("pros/hot.bin")).toEqual({
      filename: "hot.bin",
      vendor: FileVendor.DEV2,
    });
    expect(parseBrainFilePath("sys_/vexos.sym")).toEqual({
      filename: "vexos.sym",
      vendor: FileVendor.SYS,
    });
  });

  test("only splits on the first separator", () => {
    expect(parseBrainFilePath("user/nested/file.txt")).toEqual({
      filename: "nested/file.txt",
      vendor: FileVendor.USER,
    });
  });

  test("rejects unknown vendor prefixes", () => {
    expect(() => parseBrainFilePath("nope/program.bin")).toThrow(
      'unknown vendor prefix "nope/"',
    );
    expect(() => parseBrainFilePath("/program.bin")).toThrow(
      "unknown vendor prefix",
    );
  });

  test("rejects a vendor prefix without a filename", () => {
    expect(() => parseBrainFilePath("user/")).toThrow(
      "missing filename after vendor prefix",
    );
  });
});
