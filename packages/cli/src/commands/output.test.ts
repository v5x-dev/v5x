import { describe, expect, test } from "bun:test";
import { FileVendor, SmartDeviceType } from "@v5x/serial";
import {
  formatDeviceRows,
  formatSmartDeviceType,
  formatSmartDeviceVersion,
  toDeviceJson,
} from "./devices";
import { formatFileRows, formatFileTimestamp, toFileJson } from "./dir";
import { toKvJson } from "./kv";
import { assertProjectNameArgument } from "./new";
import {
  formatProgramRows,
  parseSlotArgument,
  toProgramJson,
} from "./programs";
import { encodeScreenshotPng, encodeScreenshotPpm } from "./screenshot";

describe("command output formatting", () => {
  test("formats smart devices with stable unknown labels and serial versions", () => {
    expect(formatSmartDeviceType(SmartDeviceType.MOTOR)).toBe("motor");
    expect(formatSmartDeviceType(1234)).toBe("unknown (1234)");
    expect(formatSmartDeviceVersion((1 << 14) | (2 << 8) | 3)).toBe("1.2.3");
    expect(
      formatDeviceRows([{ port: 1, type: 1234, version: (1 << 14) | 3 }]),
    ).toEqual([["1", "unknown (1234)", "1.0.3"]]);
    expect(
      toDeviceJson([{ port: 2, type: SmartDeviceType.MOTOR, version: 7 }]),
    ).toEqual([
      {
        port: 2,
        type: SmartDeviceType.MOTOR,
        typeLabel: "motor",
        version: 7,
        versionString: "0.0.7",
      },
    ]);
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
    expect(
      toFileJson([
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
      {
        vendor: FileVendor.USER,
        vendorPrefix: "user",
        filename: "program.bin",
        path: "user/program.bin",
        size: 1536,
        loadAddress: 0x3800000,
        timestamp: 0,
        timestampIso: "1970-01-01T00:00:00.000Z",
        crc32: 0x1234,
      },
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
    expect(
      toProgramJson([
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
      {
        slot: 2,
        requestedSlot: 2,
        name: "driver",
        size: 2048,
        time: "2024-01-02T03:04:05.000Z",
        binfile: "driver.bin",
      },
    ]);
  });

  test("formats key/value output as JSON with explicit unset values", () => {
    expect(
      toKvJson([
        { key: "teamnumber", value: "1234A" },
        { key: "robotname", value: undefined },
      ]),
    ).toEqual([
      { key: "teamnumber", value: "1234A" },
      { key: "robotname", value: null },
    ]);
  });

  test("encodes screenshots as PNG and PPM files", () => {
    const rgb = new Uint8Array(480 * 272 * 3);
    const png = encodeScreenshotPng(rgb);
    const ppm = encodeScreenshotPpm(rgb);

    expect(Array.from(png.subarray(0, 8))).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(png.readUInt32BE(16)).toBe(480);
    expect(png.readUInt32BE(20)).toBe(272);
    expect(ppm.subarray(0, 15).toString("ascii")).toBe("P6\n480 272\n255\n");
  });

  test("rejects bad screenshot framebuffer sizes", () => {
    expect(() => encodeScreenshotPng(new Uint8Array([0]))).toThrow(
      "bad screenshot size: 1",
    );
    expect(() => encodeScreenshotPpm(new Uint8Array([0]))).toThrow(
      "bad screenshot size: 1",
    );
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
