import type { Sade } from "sade";
import { platform } from "node:os";
import pkg from "../../package.json" with { type: "json" };
import { serial, type Serial } from "../adapter";
import { printJson, renderTable } from "../utils/output";

export type DoctorStatus = "ok" | "warn" | "error";

export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  value: string;
  action: string;
}

export interface DoctorReport {
  status: DoctorStatus;
  checks: DoctorCheck[];
}

export interface DoctorOptions {
  bunVersion?: string;
  os?: NodeJS.Platform;
  serial?: Serial;
  which?: (command: string) => string | null;
}

const SUPPORTED_PLATFORMS = new Set<NodeJS.Platform>(["darwin", "linux"]);
const TOOLCHAINS = [
  {
    name: "git",
    commands: ["git"],
    action: "Install Git and make sure it is on PATH.",
  },
  {
    name: "Cargo",
    commands: ["cargo"],
    action: "Install Rust and Cargo for vexide projects.",
  },
  {
    name: "Python",
    commands: ["python3", "python"],
    action: "Install Python 3 for PROS projects.",
  },
  {
    name: "PROS CLI",
    commands: ["pros"],
    action: "Run `v5x install pros` or install pros-cli.",
  },
  {
    name: "Make",
    commands: ["make"],
    action: "Install Make for VEXcode C++ projects.",
  },
] as const;

function minimumBunVersion(): string {
  const engine = pkg.engines.bun;
  return engine.replace(/^[^\d]*/, "");
}

export function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map((part) => Number(part));
  const rightParts = right.split(".").map((part) => Number(part));
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index++) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }

  return 0;
}

function worstStatus(statuses: DoctorStatus[]): DoctorStatus {
  if (statuses.includes("error")) return "error";
  if (statuses.includes("warn")) return "warn";
  return "ok";
}

function formatSerialPortSummary(ports: Awaited<ReturnType<Serial["getPorts"]>>): string {
  if (ports.length === 0) return "none visible";

  const usbIds = ports
    .map((port) => {
      const info = port.getInfo();
      const vendor = info.usbVendorId?.toString(16).padStart(4, "0");
      const product = info.usbProductId?.toString(16).padStart(4, "0");
      return vendor && product ? `${vendor}:${product}` : null;
    })
    .filter((id) => id !== null);

  if (usbIds.length === 0) return `${ports.length} visible`;

  const shown = usbIds.slice(0, 5).join(", ");
  const extra = usbIds.length > 5 ? `, +${usbIds.length - 5} more` : "";
  return `${ports.length} visible (${shown}${extra})`;
}

function formatFoundCommands(
  commands: readonly string[],
  which: (command: string) => string | null,
): string {
  return commands.filter((command) => which(command) !== null).join(", ");
}

async function checkSerialPorts(serialAdapter: Serial): Promise<DoctorCheck> {
  try {
    const ports = await serialAdapter.getPorts();

    return {
      name: "Serial ports",
      status: "ok",
      value: formatSerialPortSummary(ports),
      action:
        ports.length === 0
          ? "Connect a powered V5 brain only when running hardware commands."
          : "Close competing serial applications before using hardware commands.",
    };
  } catch (error) {
    return {
      name: "Serial ports",
      status: "warn",
      value: error instanceof Error ? error.message : String(error),
      action: "Check serial permissions and close applications that may own the port.",
    };
  }
}

export async function createDoctorReport(
  options: DoctorOptions = {},
): Promise<DoctorReport> {
  const bunVersion =
    options.bunVersion ?? process.versions.bun ?? globalThis.Bun?.version ?? "unknown";
  const os = options.os ?? platform();
  const which = options.which ?? Bun.which;
  const minimumBun = minimumBunVersion();
  const checks: DoctorCheck[] = [];

  checks.push({
    name: "Bun",
    status: bunVersion !== "unknown" && compareVersions(bunVersion, minimumBun) >= 0 ? "ok" : "error",
    value: bunVersion,
    action: bunVersion !== "unknown" && compareVersions(bunVersion, minimumBun) >= 0
      ? "No action needed."
      : bunVersion === "unknown"
        ? `Run v5x with Bun ${minimumBun} or newer.`
        : `Install Bun ${minimumBun} or newer.`,
  });

  checks.push({
    name: "Platform",
    status: SUPPORTED_PLATFORMS.has(os) ? "ok" : "error",
    value: os,
    action: SUPPORTED_PLATFORMS.has(os)
      ? "No action needed."
      : "Use Linux or macOS for CLI serial access.",
  });

  for (const toolchain of TOOLCHAINS) {
    const found = formatFoundCommands(toolchain.commands, which);
    checks.push({
      name: toolchain.name,
      status: found.length > 0 ? "ok" : "warn",
      value: found.length > 0 ? found : "not found",
      action: found.length > 0 ? "No action needed." : toolchain.action,
    });
  }

  checks.push(await checkSerialPorts(options.serial ?? serial));

  return {
    status: worstStatus(checks.map((check) => check.status)),
    checks,
  };
}

export function formatDoctorRows(report: DoctorReport): string[][] {
  return report.checks.map((check) => [
    check.status,
    check.name,
    check.value,
    check.action,
  ]);
}

export default function registerDoctorCommand(program: Sade) {
  program
    .command("doctor", "check local v5x environment")
    .option("--json", "print machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      const report = await createDoctorReport();
      if (options.json === true) printJson(report);
      else {
        console.log(
          renderTable(
            ["status", "check", "value", "next action"],
            formatDoctorRows(report),
          ),
        );
      }
    });
}
