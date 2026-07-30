import { describe, expect, test } from "bun:test";
import { VexSerialError } from "@v5x/serial";
import {
  CliError,
  CLI_EXIT_CODE,
  cliExitCode,
  exitCodeForSerialError,
  formatCliError,
  formatCliJsonError,
  isJsonOutput,
  isVerbose,
  serialCliError,
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

  test("maps a serial failure through serialCliError", () => {
    const failure = new VexSerialError("io", "port closed");
    const error = serialCliError("upload failed", failure);

    expect(error.exitCode).toBe(CLI_EXIT_CODE.IO);
    expect(error.cause).toBe(failure);
    expect(error.message).toBe("upload failed");
  });

  test("recovers a serial category from a wrapped cause", () => {
    const failure = new VexSerialError("protocol", "bad response");

    expect(cliExitCode(failure)).toBe(CLI_EXIT_CODE.DEVICE);
    expect(cliExitCode(new Error("context", { cause: failure }))).toBe(
      CLI_EXIT_CODE.DEVICE,
    );
    expect(
      cliExitCode(
        new Error("outer", { cause: new Error("inner", { cause: failure }) }),
      ),
    ).toBe(CLI_EXIT_CODE.DEVICE);
  });

  test("enables verbose errors from a flag or environment", () => {
    expect(isVerbose(["bun", "v5x", "--verbose"], {})).toBe(true);
    expect(isVerbose(["bun", "v5x"], { V5X_DEBUG: "1" })).toBe(true);
    expect(isVerbose(["bun", "v5x"], {})).toBe(false);
  });

  test("detects JSON output regardless of argument position", () => {
    expect(isJsonOutput(["bun", "v5x", "devices", "--json"])).toBe(true);
    expect(isJsonOutput(["bun", "v5x", "devices"])).toBe(false);
  });

  test.each([
    ["usage", new CliError("missing slot", CLI_EXIT_CODE.USAGE), 2],
    [
      "no-device",
      new CliError("no V5 device found", CLI_EXIT_CODE.NO_DEVICE),
      3,
    ],
    [
      "serial/device",
      new CliError("read failed: protocol", CLI_EXIT_CODE.DEVICE, {
        cause: new VexSerialError("protocol", "bad response"),
      }),
      4,
    ],
    ["generic", new Error("unexpected failure"), 1],
  ])("formats %s failures with the stable JSON shape", (_, error, exitCode) => {
    expect(JSON.parse(formatCliJsonError(error))).toEqual({
      error: { message: error.message, exitCode },
    });
  });

  test("does not expose stack traces or serial error kinds in JSON", () => {
    const error = new CliError("device operation failed", CLI_EXIT_CODE.IO, {
      cause: new VexSerialError("io", "port closed"),
    });
    const output = formatCliJsonError(error);

    expect(output).not.toContain("stack");
    expect(output).not.toContain('"kind"');
    expect(output).not.toContain("port closed");
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
