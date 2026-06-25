import { describe, expect, test } from "bun:test";
import { FileVendor, SmartDeviceType } from "@v5x/serial";
import {
  formatDeviceRows,
  formatSmartDeviceType,
  formatSmartDeviceVersion,
} from "./devices";
import { formatFileRows, formatFileTimestamp } from "./dir";
import { assertProjectNameArgument } from "./new";
import { formatProgramRows, parseSlotArgument } from "./programs";

describe("command output formatting", () => {
  test("formats smart devices with stable unknown labels and serial versions", () => {
    expect(formatSmartDeviceType(SmartDeviceType.MOTOR)).toBe("motor");
    expect(formatSmartDeviceType(1234)).toBe("unknown (1234)");
    expect(formatSmartDeviceVersion((1 << 14) | (2 << 8) | 3)).toBe("1.2.3");
    expect(
      formatDeviceRows([{ port: 1, type: 1234, version: (1 << 14) | 3 }]),
    ).toEqual([["1", "unknown (1234)", "1.0.3"]]);
  });

  test("formats file timestamps in UTC with an explicit locale", () => {
    expect(formatFileTimestamp(0)).toBe("01/01/1970, 00:00:00");
    expect(
      formatFileRows([
        {
          vendor: FileVendor.USER,
          filename: "program.bin",
          size: 1536,
          loadAddress: 0x3800000,
          timestamp: 0,
          crc32: 0x1234,
        },
      ]),
    ).toEqual([
      [
        "user/program.bin",
        "1.5 KB",
        "0x3800000",
        "01/01/1970, 00:00:00",
        "0x1234",
      ],
    ]);
  });

  test("formats listed programs with slots and UTC timestamps", () => {
    expect(
      formatProgramRows([
        {
          name: "driver",
          binfile: "driver.bin",
          size: 2048,
          slot: 2,
          requestedSlot: 2,
          time: new Date("2024-01-02T03:04:05Z"),
        },
      ]),
    ).toEqual([
      ["2", "2", "driver", "2.0 KB", "01/02/2024, 03:04:05", "driver.bin"],
    ]);
  });
});

test("rejects nested path attempts for new command names", () => {
  expect(() => assertProjectNameArgument("nested/robot")).toThrow("use --path");
  expect(() => assertProjectNameArgument("robot")).not.toThrow();
});

test("parses start command slot arguments", () => {
  expect(parseSlotArgument("1")).toBe(1);
  expect(parseSlotArgument("8")).toBe(8);
  expect(() => parseSlotArgument("0")).toThrow("slot must be");
  expect(() => parseSlotArgument("program.bin")).toThrow("slot must be");
});
