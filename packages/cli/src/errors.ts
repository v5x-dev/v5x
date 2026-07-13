import chalk from "chalk";
import type { VexSerialErrorKind } from "@v5x/serial";

export const CLI_EXIT_CODE = {
  FAILURE: 1,
  USAGE: 2,
  NO_DEVICE: 3,
  DEVICE: 4,
  IO: 5,
} as const;

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: number = CLI_EXIT_CODE.FAILURE,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CliError";
  }
}

export function exitCodeForSerialError(kind: VexSerialErrorKind): number {
  switch (kind) {
    case "invalid-argument":
      return CLI_EXIT_CODE.USAGE;
    case "not-connected":
      return CLI_EXIT_CODE.NO_DEVICE;
    case "protocol":
    case "transfer":
    case "firmware":
      return CLI_EXIT_CODE.DEVICE;
    case "download":
    case "io":
      return CLI_EXIT_CODE.IO;
  }
}

export function isVerbose(
  argv: string[] = process.argv,
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return argv.includes("--verbose") || environment.V5X_DEBUG === "1";
}

export function isJsonOutput(argv: string[] = process.argv): boolean {
  return argv.includes("--json");
}

export function formatCliJsonError(error: unknown): string {
  return JSON.stringify({
    error: {
      message: error instanceof Error ? error.message : String(error),
      exitCode: cliExitCode(error),
    },
  });
}

export function formatCliError(error: unknown, verbose: boolean): string {
  const detail =
    verbose && error instanceof Error && error.stack
      ? error.stack
      : error instanceof Error
        ? error.message
        : String(error);
  return `${chalk.red("error:")} ${detail}`;
}

export function cliExitCode(error: unknown): number {
  return error instanceof CliError ? error.exitCode : CLI_EXIT_CODE.FAILURE;
}
