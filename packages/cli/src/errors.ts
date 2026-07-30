import chalk from "chalk";
import { VexSerialError, type VexSerialErrorKind } from "@v5x/serial";

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

/**
 * Wrap a serial failure in a {@link CliError} that keeps the typed cause and
 * the exit code mapped from its {@link VexSerialError.kind}.
 *
 * Boundaries that only need to add human-readable context must go through
 * this instead of `new Error(...)`, otherwise the category is flattened into
 * the generic failure code.
 */
export function serialCliError(
  message: string,
  error: VexSerialError,
): CliError {
  return new CliError(message, exitCodeForSerialError(error.kind), {
    cause: error,
  });
}

/**
 * Resolve the process exit code for a thrown value.
 *
 * A `CliError` states its own code. Otherwise the cause chain is searched for
 * a `VexSerialError` so wrapping a typed serial failure for context still
 * yields its category-specific code rather than the generic failure code.
 */
export function cliExitCode(error: unknown): number {
  if (error instanceof CliError) return error.exitCode;
  const serialError = findSerialError(error);
  return serialError === undefined
    ? CLI_EXIT_CODE.FAILURE
    : exitCodeForSerialError(serialError.kind);
}

function findSerialError(
  error: unknown,
  depth = 8,
): VexSerialError | undefined {
  if (error instanceof VexSerialError) return error;
  if (depth === 0 || !(error instanceof Error)) return undefined;
  return findSerialError(error.cause, depth - 1);
}
