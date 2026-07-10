import { describe, expect, test } from "bun:test";
import { VexSerialError } from "@v5x/serial";
import {
  CliError,
  CLI_EXIT_CODE,
  cliExitCode,
  exitCodeForSerialError,
  formatCliError,
  isVerbose,
} from "./errors";

describe("CLI errors", () => {
  test("uses stable exit codes for serial failure categories", () => {
    expect(exitCodeForSerialError("invalid-argument")).toBe(2);
    expect(exitCodeForSerialError("not-connected")).toBe(3);
    expect(exitCodeForSerialError("protocol")).toBe(4);
    expect(exitCodeForSerialError("io")).toBe(5);
  });

  test("preserves an explicit CLI exit code", () => {
    expect(cliExitCode(new CliError("bad usage", CLI_EXIT_CODE.USAGE))).toBe(2);
    expect(cliExitCode(new Error("unknown"))).toBe(1);
  });

  test("enables verbose errors from a flag or environment", () => {
    expect(isVerbose(["bun", "v5x", "--verbose"], {})).toBe(true);
    expect(isVerbose(["bun", "v5x"], { V5X_DEBUG: "1" })).toBe(true);
    expect(isVerbose(["bun", "v5x"], {})).toBe(false);
  });

  test("prints a concise error by default and a stack when verbose", () => {
    const error = new VexSerialError("io", "port closed");
    expect(formatCliError(error, false)).toContain("error: port closed");
    expect(formatCliError(error, false)).not.toContain("VexSerialError:");
    expect(formatCliError(error, true)).toContain(
      "VexSerialError: port closed",
    );
  });
});
