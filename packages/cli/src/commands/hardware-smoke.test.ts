import { afterEach, expect, test } from "bun:test";
import {
  SerialDeviceType,
  VexFirmwareVersion,
  type IFileWriteRequest,
  type V5SerialDevice,
} from "@v5x/serial";
import { okAsync } from "neverthrow";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseExpectedDevice, runHardwareSmoke } from "./hardware-smoke";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function screenshotPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "v5x-hardware-smoke-"));
  temporaryDirectories.push(directory);
  return join(directory, "screen.png");
}

function fakeDevice(
  overrides: {
    deviceType?: SerialDeviceType;
    writeFile?: (request: IFileWriteRequest) => void;
    removeFile?: (filename: string) => void;
  } = {},
): V5SerialDevice {
  const expectedBytes = new TextEncoder().encode("v5x hardware smoke\n");
  return {
    deviceType: overrides.deviceType ?? SerialDeviceType.V5_BRAIN,
    connection: {
      port: {
        getInfo: () => ({
          path: "/dev/ttyACM0",
          usbVendorId: 10376,
          usbProductId: overrides.deviceType ?? SerialDeviceType.V5_BRAIN,
        }),
      },
    },
    brain: {
      isAvailable: true,
      systemVersion: new VexFirmwareVersion(1, 2, 3, 0),
      cpu0Version: new VexFirmwareVersion(2, 0, 0, 0),
      cpu1Version: new VexFirmwareVersion(3, 0, 0, 0),
      listFiles: () => okAsync([]),
      captureScreen: () => okAsync(new Uint8Array(480 * 272 * 3)),
      writeFile: (request: IFileWriteRequest) => {
        overrides.writeFile?.(request);
        return okAsync(true);
      },
      readFile: () => okAsync(expectedBytes),
      removeFile: (filename: string) => {
        overrides.removeFile?.(filename);
        return okAsync(undefined);
      },
    },
  } as unknown as V5SerialDevice;
}

test("hardware smoke is read-only unless mutations are explicitly enabled", async () => {
  let writes = 0;
  let removals = 0;
  const output = await screenshotPath();

  const report = await runHardwareSmoke(
    fakeDevice({
      writeFile: () => writes++,
      removeFile: () => removals++,
    }),
    { mutate: false, output },
  );

  expect(report.mode).toBe("read-only");
  expect(report.checks.mutation).toEqual({
    status: "skipped",
    cleanup: "skipped",
  });
  expect(report.context).not.toHaveProperty("serialNumber");
  expect(report.context).not.toHaveProperty("uniqueId");
  expect(writes).toBe(0);
  expect(removals).toBe(0);
  expect((await readFile(output)).subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
});

test("opt-in mutation round-trips a temporary file and cleans it up", async () => {
  let writtenFilename = "";
  let removedFilename = "";
  const output = await screenshotPath();

  const report = await runHardwareSmoke(
    fakeDevice({
      deviceType: SerialDeviceType.V5_CONTROLLER,
      writeFile: (request) => {
        writtenFilename = request.filename;
      },
      removeFile: (filename) => {
        removedFilename = filename;
      },
    }),
    { expectedDevice: "controller", mutate: true, output },
  );

  expect(report.mode).toBe("mutation");
  expect(report.context.device).toBe("controller");
  expect(report.checks.mutation).toEqual({
    status: "passed",
    cleanup: "passed",
  });
  expect(writtenFilename).toBe("v5x_smoke.txt");
  expect(removedFilename).toBe(writtenFilename);
});

test("expected device parsing rejects unknown paths", () => {
  expect(parseExpectedDevice("brain")).toBe("brain");
  expect(parseExpectedDevice("controller")).toBe("controller");
  expect(() => parseExpectedDevice("radio")).toThrow(
    "--expect must be brain or controller",
  );
});
