import { describe, expect, test } from "bun:test";
import { err } from "neverthrow";
import { FileVendor, SmartDeviceType, VexSerialError } from "@v5x/serial";
import { formatSerialFailure, unwrapSerial } from "../utils/output";
import {
  projectOutputFiles,
  toWorkflowArtifactJson,
  toWorkflowCreateJson,
  toWorkflowInstallJson,
  toWorkflowProjectJson,
} from "../utils/workflow-json";
import {
  formatDeviceRows,
  formatSmartDeviceType,
  formatSmartDeviceVersion,
  toDeviceJson,
} from "./devices";
import {
  formatFileRows,
  formatFileTimestamp,
  formatVendorListFailure,
  toDirectoryJson,
  toFileJson,
} from "./dir";
import { decodeCatText, formatCatText } from "./cat";
import {
  compareVersions,
  createDoctorReport,
  doctorExitCode,
  formatDoctorRows,
} from "./doctor";
import { toKvJson } from "./kv";
import { assertProjectNameArgument } from "./new";
import { parseToolchain } from "../utils/scaffold";
import {
  formatProgramRows,
  parseSlotArgument,
  toProgramJson,
} from "./programs";
import {
  encodeScreenshotPng,
  encodeScreenshotPpm,
  parseScreenshotFormat,
  toScreenshotJson,
} from "./screenshot";

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

  test("formats directory JSON with vendor listing errors", () => {
    const failure = formatVendorListFailure(
      FileVendor.SYS,
      new VexSerialError("protocol", "directory unavailable"),
    );

    expect(failure).toEqual({
      vendor: FileVendor.SYS,
      vendorPrefix: "sys_",
      message: "failed to list sys_/ files: protocol: directory unavailable",
    });
    expect(
      toDirectoryJson(
        [
          {
            vendor: FileVendor.USER,
            filename: "program.bin",
            size: 1536,
            loadAddress: 0x3800000,
            timestamp: 0,
            crc32: 0x1234,
          },
        ],
        [failure],
      ),
    ).toEqual({
      files: [
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
      ],
      errors: [failure],
    });
  });

  test("formats cat output for interactive text without changing bytes helper", () => {
    const bytes = new Uint8Array([0x68, 0x69]);

    expect(decodeCatText(bytes)).toBe("hi");
    expect(formatCatText(bytes)).toBe("hi\n");
    expect(formatCatText(new Uint8Array([0x68, 0x69, 0x0a]))).toBe("hi\n");
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

  test("formats workflow project and artifact result objects", () => {
    expect(
      toWorkflowProjectJson({
        path: "/work/robot",
        type: "pros",
        name: "robot",
        description: "match program",
        artifact: "/work/robot/bin/hot.package.bin",
      }),
    ).toEqual({
      path: "/work/robot",
      type: "pros",
      name: "robot",
      description: "match program",
      artifactPath: "/work/robot/bin/hot.package.bin",
    });
    expect(
      projectOutputFiles({
        path: "/work/robot",
        type: "vexide",
        name: "robot",
        description: "",
      }),
    ).toEqual([]);
    expect(
      toWorkflowArtifactJson({
        hot: { path: "/work/robot/hot.bin", size: 1024 },
        cold: { path: "/work/robot/cold.bin", size: 2048 },
      }),
    ).toEqual([
      { role: "hot", path: "/work/robot/hot.bin", size: 1024 },
      { role: "cold", path: "/work/robot/cold.bin", size: 2048 },
    ]);
  });

  test("formats workflow create and install result objects", () => {
    expect(toWorkflowCreateJson("new", "/work/robot", "vexide")).toEqual({
      command: "new",
      projectPath: "/work/robot",
      projectType: "vexide",
      created: true,
    });
    expect(toWorkflowCreateJson("init", "/work/robot", "pros")).toEqual({
      command: "init",
      projectPath: "/work/robot",
      projectType: "pros",
      created: true,
    });
    expect(toWorkflowInstallJson("pros")).toEqual({
      command: "install",
      toolchain: "pros",
      installed: true,
    });
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

  test("parses screenshot formats", () => {
    expect(parseScreenshotFormat(undefined)).toBe("png");
    expect(parseScreenshotFormat("png")).toBe("png");
    expect(parseScreenshotFormat("ppm")).toBe("ppm");
    expect(() => parseScreenshotFormat("jpeg")).toThrow(
      "--format must be png or ppm",
    );
  });

  test("formats screenshot JSON metadata", () => {
    expect(toScreenshotJson("screen.png", "png", 12345)).toEqual({
      output: "screen.png",
      format: "png",
      width: 480,
      height: 272,
      bytes: 12345,
    });
  });
});

test("rejects nested path attempts for new command names", () => {
  expect(() => assertProjectNameArgument("nested/robot")).toThrow("use --path");
  expect(() => assertProjectNameArgument("robot")).not.toThrow();
});

test("requires a project type for scaffold commands", () => {
  expect(() => parseToolchain(undefined)).toThrow("--type is required");
  expect(() => parseToolchain("bad")).toThrow("unsupported --type bad");
  expect(parseToolchain("pros")).toBe("pros");
  expect(parseToolchain("vexide")).toBe("vexide");
});

test("parses start command slot arguments", () => {
  expect(parseSlotArgument("1")).toBe(1);
  expect(parseSlotArgument("8")).toBe(8);
  expect(() => parseSlotArgument("0")).toThrow("slot must be");
  expect(() => parseSlotArgument("program.bin")).toThrow("slot must be");
});

test("compares Bun-style versions", () => {
  expect(compareVersions("1.3.14", "1.3.14")).toBe(0);
  expect(compareVersions("1.3.15", "1.3.14")).toBe(1);
  expect(compareVersions("1.2.9", "1.3.14")).toBe(-1);
  expect(compareVersions("1.3.14-canary.37", "1.3.14")).toBe(-1);
  expect(compareVersions("1.3.0-beta", "1.3.14")).toBe(-1);
  expect(compareVersions("1.3.15-canary.1", "1.3.14")).toBe(1);
});

test("reports doctor checks without requiring hardware", async () => {
  const report = await createDoctorReport({
    bunVersion: "1.3.14",
    os: "linux",
    which: (command) =>
      ["git", "cargo", "python3", "pros", "make"].includes(command)
        ? `/bin/${command}`
        : null,
    serial: {
      onconnect: () => {},
      ondisconnect: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
      getPorts: async () => [],
      requestPort: async () => {
        throw new Error("not used");
      },
    },
  });

  expect(report.status).toBe("ok");
  expect(doctorExitCode(report)).toBe(0);
  expect(formatDoctorRows(report)).toContainEqual([
    "ok",
    "Serial ports",
    "none visible",
    "Connect a powered V5 brain only when running hardware commands.",
  ]);
});

test("doctor exits nonzero only for error reports", () => {
  expect(doctorExitCode({ status: "ok", checks: [] })).toBe(0);
  expect(doctorExitCode({ status: "warn", checks: [] })).toBe(0);
  expect(doctorExitCode({ status: "error", checks: [] })).toBe(1);
});

describe("serial command failures", () => {
  test("includes serial kind and message for file operation failures", () => {
    const error = new VexSerialError("protocol", "timed out waiting for ack");

    expect(() =>
      unwrapSerial(err(error), "failed to read user/log.txt"),
    ).toThrow(
      "failed to read user/log.txt: protocol: timed out waiting for ack",
    );
    expect(() =>
      unwrapSerial(err(error), "failed to erase user/log.txt"),
    ).toThrow(
      "failed to erase user/log.txt: protocol: timed out waiting for ack",
    );
  });

  test("includes serial details for program control failures", () => {
    expect(() =>
      unwrapSerial(
        err(new VexSerialError("io", "serial port disconnected")),
        "failed to list programs",
      ),
    ).toThrow("failed to list programs: io: serial port disconnected");
    expect(() =>
      unwrapSerial(
        err(
          new VexSerialError("not-connected", "no connection to a V5 device"),
        ),
        "failed to start slot 2",
      ),
    ).toThrow(
      "failed to start slot 2: not-connected: no connection to a V5 device",
    );
    expect(() =>
      unwrapSerial(
        err(new VexSerialError("transfer", "file transfer exit failed")),
        "failed to stop program",
      ),
    ).toThrow("failed to stop program: transfer: file transfer exit failed");
  });

  test("includes serial details for screenshot and upload failures", () => {
    expect(() =>
      unwrapSerial(
        err(new VexSerialError("protocol", "screen capture timed out")),
        "failed to capture screenshot",
      ),
    ).toThrow(
      "failed to capture screenshot: protocol: screen capture timed out",
    );
    expect(
      formatSerialFailure(
        "the brain rejected the program upload",
        new VexSerialError("io", "write EIO"),
      ),
    ).toBe("the brain rejected the program upload: io: write EIO");
  });

  test("does not expose stack traces for expected serial failures", () => {
    const message = formatSerialFailure(
      "failed to list programs",
      new VexSerialError("protocol", "unexpected reply"),
    );

    expect(message).not.toContain("VexSerialError:");
    expect(message).not.toContain(" at ");
  });
});
