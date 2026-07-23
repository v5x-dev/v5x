import type { Sade } from "sade";
import {
  FileDownloadTarget,
  FileVendor,
  SerialDeviceType,
  type IFileHandle,
  type V5SerialDevice,
} from "@v5x/serial";
import { arch, platform, release } from "node:os";
import pkg from "../../package.json" with { type: "json" };
import { type PortSelectionOptions, withSelectedV5Device } from "../device";
import { CLI_EXIT_CODE, CliError } from "../errors";
import { requireOptionValue } from "../utils/guards";
import { printJson, renderTable, unwrapSerial } from "../utils/output";
import { encodeScreenshotPng } from "./screenshot";

const MUTATION_FILENAME = "v5x_smoke.txt";
export type SmokeDeviceKind = "brain" | "controller";
type SmokeCheckStatus = "passed" | "skipped";

export interface HardwareSmokeOptions {
  expectedDevice?: SmokeDeviceKind;
  mutate: boolean;
  output: string;
}

export interface HardwareSmokeReport {
  status: "passed";
  mode: "read-only" | "mutation";
  context: {
    platform: string;
    release: string;
    architecture: string;
    bunVersion: string;
    cliVersion: string;
    device: SmokeDeviceKind;
    port: string;
    usbVendorId: number | null;
    usbProductId: number | null;
    firmware: {
      system: string;
      cpu0: string;
      cpu1: string;
    };
  };
  checks: {
    connection: SmokeCheckStatus;
    status: SmokeCheckStatus;
    directory: {
      status: SmokeCheckStatus;
      userFileCount: number;
    };
    screenshot: {
      status: SmokeCheckStatus;
      output: string;
      width: 480;
      height: 272;
      bytes: number;
    };
    mutation: {
      status: SmokeCheckStatus;
      cleanup: SmokeCheckStatus;
    };
  };
}

interface SmokePortInfo {
  path?: string;
  usbVendorId?: number;
  usbProductId?: number;
}

function deviceKind(device: V5SerialDevice): SmokeDeviceKind {
  return device.deviceType === SerialDeviceType.V5_CONTROLLER
    ? "controller"
    : "brain";
}

function defaultScreenshotOutput(now = new Date()): string {
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  return `v5x-hardware-smoke-${timestamp}.png`;
}

export function parseExpectedDevice(
  value: string | boolean | undefined,
): SmokeDeviceKind | undefined {
  const expected = requireOptionValue(value, "--expect");
  if (
    expected === undefined ||
    expected === "brain" ||
    expected === "controller"
  ) {
    return expected;
  }
  throw new CliError(
    "--expect must be brain or controller",
    CLI_EXIT_CODE.USAGE,
  );
}

async function writeScreenshot(
  output: string,
  frame: Uint8Array,
): Promise<number> {
  if (await Bun.file(output).exists()) {
    throw new CliError(
      `refusing to overwrite existing screenshot: ${output}`,
      CLI_EXIT_CODE.IO,
    );
  }

  let png: Buffer;
  try {
    png = encodeScreenshotPng(frame);
    return await Bun.write(output, png);
  } catch (error) {
    throw new CliError(
      `failed to write smoke screenshot: ${output}`,
      CLI_EXIT_CODE.IO,
      {
        cause: error,
      },
    );
  }
}

async function runMutationCheck(
  device: V5SerialDevice,
  files: IFileHandle[],
): Promise<void> {
  if (files.some((file) => file.filename === MUTATION_FILENAME)) {
    throw new CliError(
      `refusing to overwrite existing brain file: ${MUTATION_FILENAME}`,
      CLI_EXIT_CODE.DEVICE,
    );
  }

  const expected = new TextEncoder().encode("v5x hardware smoke\n");
  let mutationAttempted = false;
  let failure: unknown;
  try {
    mutationAttempted = true;
    const written = unwrapSerial(
      await device.brain.writeFile({
        filename: MUTATION_FILENAME,
        vendor: FileVendor.USER,
        downloadTarget: FileDownloadTarget.FILE_TARGET_QSPI,
        buf: expected,
        autoRun: false,
      }),
      "hardware smoke file write failed",
    );
    if (!written) {
      throw new CliError(
        "hardware smoke file write was not acknowledged",
        CLI_EXIT_CODE.DEVICE,
      );
    }

    const actual = unwrapSerial(
      await device.brain.readFile(MUTATION_FILENAME),
      "hardware smoke file read failed",
    );
    if (!Buffer.from(actual).equals(expected)) {
      throw new CliError(
        "hardware smoke file round trip returned different bytes",
        CLI_EXIT_CODE.DEVICE,
      );
    }
  } catch (error) {
    failure = error;
  } finally {
    if (mutationAttempted) {
      const removed = await device.brain.removeFile(MUTATION_FILENAME);
      if (removed.isErr()) {
        if (failure === undefined) {
          failure = new CliError(
            `hardware smoke cleanup failed: ${removed.error.message}`,
            CLI_EXIT_CODE.DEVICE,
            { cause: removed.error },
          );
        } else {
          const originalMessage =
            failure instanceof Error
              ? failure.message
              : typeof failure === "string"
                ? failure
                : "hardware smoke mutation failed";
          failure = new CliError(
            `${originalMessage}; cleanup also failed: ${removed.error.message}`,
            CLI_EXIT_CODE.DEVICE,
            { cause: new AggregateError([failure, removed.error]) },
          );
        }
      }
    }
  }

  if (failure !== undefined) throw failure;
}

export async function runHardwareSmoke(
  device: V5SerialDevice,
  options: HardwareSmokeOptions,
): Promise<HardwareSmokeReport> {
  const kind = deviceKind(device);
  if (options.expectedDevice !== undefined && options.expectedDevice !== kind) {
    throw new CliError(
      `expected a ${options.expectedDevice} connection, found ${kind}`,
      CLI_EXIT_CODE.DEVICE,
    );
  }
  if (!device.brain.isAvailable) {
    throw new CliError(
      "connected serial device did not report an available V5 brain",
      CLI_EXIT_CODE.DEVICE,
    );
  }

  const files = unwrapSerial(
    await device.brain.listFiles(FileVendor.USER),
    "hardware smoke directory inspection failed",
  );
  const frame = unwrapSerial(
    await device.brain.captureScreen(),
    "hardware smoke screenshot capture failed",
  );
  const screenshotBytes = await writeScreenshot(options.output, frame);

  if (options.mutate) await runMutationCheck(device, files);

  const info = device.connection?.port?.getInfo() as SmokePortInfo | undefined;
  return {
    status: "passed",
    mode: options.mutate ? "mutation" : "read-only",
    context: {
      platform: platform(),
      release: release(),
      architecture: arch(),
      bunVersion: Bun.version,
      cliVersion: pkg.version,
      device: kind,
      port: info?.path ?? "unavailable",
      usbVendorId: info?.usbVendorId ?? null,
      usbProductId: info?.usbProductId ?? null,
      firmware: {
        system: device.brain.systemVersion.toUserString(),
        cpu0: device.brain.cpu0Version.toUserString(),
        cpu1: device.brain.cpu1Version.toUserString(),
      },
    },
    checks: {
      connection: "passed",
      status: "passed",
      directory: { status: "passed", userFileCount: files.length },
      screenshot: {
        status: "passed",
        output: options.output,
        width: 480,
        height: 272,
        bytes: screenshotBytes,
      },
      mutation: {
        status: options.mutate ? "passed" : "skipped",
        cleanup: options.mutate ? "passed" : "skipped",
      },
    },
  };
}

export function formatHardwareSmokeRows(
  report: HardwareSmokeReport,
): string[][] {
  return [
    ["mode", report.mode],
    [
      "platform",
      `${report.context.platform} ${report.context.release} (${report.context.architecture})`,
    ],
    ["device", report.context.device],
    ["port", report.context.port],
    [
      "USB",
      `${report.context.usbVendorId ?? "unknown"}:${report.context.usbProductId ?? "unknown"}`,
    ],
    ["firmware", report.context.firmware.system],
    ["directory", `${report.checks.directory.userFileCount} user files`],
    ["screenshot", report.checks.screenshot.output],
    ["mutation", report.checks.mutation.status],
  ];
}

export default function registerHardwareSmokeCommand(program: Sade) {
  program
    .command("hardware-smoke", "run opt-in V5 hardware checks")
    .option("--port", "serial port path or id, defaults to V5X_PORT")
    .option("--expect", "require a brain or controller connection")
    .option("--output", "screenshot output path")
    .option("--mutate", "run a temporary write/read/delete check")
    .option("--json", "print machine-readable JSON")
    .action(
      async (
        options: {
          expect?: string | boolean;
          output?: string | boolean;
          mutate?: boolean;
          json?: boolean;
        } & PortSelectionOptions,
      ) => {
        const output =
          requireOptionValue(options.output, "--output") ??
          defaultScreenshotOutput();
        const expectedDevice = parseExpectedDevice(options.expect);
        await withSelectedV5Device(options, async (device) => {
          const report = await runHardwareSmoke(device, {
            expectedDevice,
            mutate: options.mutate === true,
            output,
          });
          if (options.json === true) printJson(report);
          else
            console.log(
              renderTable(["field", "value"], formatHardwareSmokeRows(report)),
            );
        });
      },
    );
}
