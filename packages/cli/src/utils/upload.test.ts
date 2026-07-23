import { describe, expect, test } from "bun:test";
import {
  reportProgress,
  resolveBuildOption,
  resolveSlotOption,
  uploadProgramFromCommand,
  withUploadProgress,
  type UploadCommandOptions,
} from "./upload";

function baseCommandOptions(
  overrides: Partial<UploadCommandOptions> = {},
): UploadCommandOptions {
  return {
    slot: "1",
    icon: "default.bmp",
    ...overrides,
  };
}

describe("resolveSlotOption", () => {
  test("parses a numeric slot string", () => {
    expect(resolveSlotOption("3")).toBe(3);
  });

  test("rejects a bare --slot flag parsed as a boolean", () => {
    expect(() => resolveSlotOption(true)).toThrow("--slot requires a value");
  });
});

describe("resolveBuildOption", () => {
  test("defaults to building when no --file is given", () => {
    expect(resolveBuildOption(undefined, undefined)).toBe(true);
  });

  test("skips the build by default when --file is given", () => {
    expect(resolveBuildOption(undefined, "program.bin")).toBe(false);
  });

  test("still builds when --build is explicitly passed alongside --file", () => {
    expect(resolveBuildOption(true, "program.bin")).toBe(true);
  });

  test("still skips the build when --no-build is explicitly passed", () => {
    expect(resolveBuildOption(false, undefined)).toBe(false);
  });
});

describe("uploadProgramFromCommand", () => {
  test("rejects a bare --slot flag before touching the project or device", async () => {
    await expect(
      uploadProgramFromCommand(
        "/nonexistent/path",
        baseCommandOptions({ slot: true }),
        false,
      ),
    ).rejects.toThrow("--slot requires a value");
  });

  test.each([
    ["--name", { name: true }],
    ["--description", { description: true }],
    ["--icon", { icon: true }],
    ["--file", { file: true }],
  ])(
    "rejects a bare %s flag before touching the project or device",
    async (flag, overrides) => {
      await expect(
        uploadProgramFromCommand(
          "/nonexistent/path",
          baseCommandOptions(overrides),
          false,
        ),
      ).rejects.toThrow(`${flag} requires a value`);
    },
  );
});

describe("reportProgress", () => {
  function withMockedStderr(run: () => void, isTTY = true) {
    const writes: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    const originalIsTTY = process.stderr.isTTY;
    (process.stderr as { isTTY: boolean }).isTTY = isTTY;
    process.stderr.write = ((chunk: string) => {
      writes.push(chunk.toString());
      return true;
    }) as typeof process.stderr.write;
    try {
      run();
    } finally {
      process.stderr.write = original;
      (process.stderr as { isTTY: boolean }).isTTY = originalIsTTY;
    }
    return writes;
  }

  test("clears the line so a short state does not leave residue from a longer one", () => {
    const writes = withMockedStderr(() => {
      const progress = reportProgress();
      progress("CHANNEL", 1, 1);
      progress("BIN", 0, 100);
    });

    // Each write on a TTY must clear the rest of the line after the carriage
    // return, otherwise leftover characters from a longer previous state
    // (e.g. "channel") would remain visible after a shorter one (e.g. "bin").
    for (const write of writes) {
      if (write.startsWith("\r")) {
        expect(write.startsWith("\r\x1b[K")).toBe(true);
      }
    }
  });

  test("pads state labels to the longest state name seen so far", () => {
    const writes = withMockedStderr(() => {
      const progress = reportProgress();
      progress("CHANNEL", 0, 1);
      progress("BIN", 0, 100);
    });

    const binWrite = writes.find((write) => write.includes("bin"));
    expect(binWrite).toContain("bin".padEnd("channel".length));
  });

  test("finish adds a trailing newline once a state has been reported", () => {
    const writes = withMockedStderr(() => {
      const progress = reportProgress();
      progress("BIN", 1, 1);
      progress.finish();
    });

    expect(writes.at(-1)).toBe("\n");
  });
});

describe("withUploadProgress", () => {
  async function captureStderr(
    isTTY: boolean,
    run: () => Promise<void>,
  ): Promise<string[]> {
    const writes: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    const originalIsTTY = process.stderr.isTTY;
    (process.stderr as { isTTY: boolean }).isTTY = isTTY;
    process.stderr.write = ((chunk: string) => {
      writes.push(chunk.toString());
      return true;
    }) as typeof process.stderr.write;
    try {
      await run();
    } finally {
      process.stderr.write = original;
      (process.stderr as { isTTY: boolean }).isTTY = originalIsTTY;
    }
    return writes;
  }

  test.each([true, false])(
    "finalizes progress after a thrown upload failure when isTTY=%s",
    async (isTTY) => {
      const failure = new Error("upload failed");
      let caught: unknown;
      const writes = await captureStderr(isTTY, async () => {
        try {
          await withUploadProgress(async (progress) => {
            progress("BIN", 1, 2);
            throw failure;
          });
        } catch (error) {
          caught = error;
        }
      });

      expect(caught).toBe(failure);
      expect(writes.at(-1)).toBe("\n");
      expect(writes.filter((write) => write === "\n")).toHaveLength(1);
    },
  );

  test("finalizes progress after a Result-channel upload failure", async () => {
    const failure = new Error("brain rejected upload");
    let caught: unknown;
    const writes = await captureStderr(true, async () => {
      try {
        await withUploadProgress(async (progress) => {
          progress("BIN", 1, 2);
          const uploaded = { ok: false as const, error: failure };
          if (!uploaded.ok) throw uploaded.error;
        });
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBe(failure);
    expect(writes.at(-1)).toBe("\n");
    expect(writes.filter((write) => write === "\n")).toHaveLength(1);
  });

  test("does not let progress cleanup replace the upload failure", async () => {
    const failure = new Error("upload failed");
    const original = process.stderr.write.bind(process.stderr);
    let writes = 0;
    process.stderr.write = (() => {
      writes++;
      if (writes > 1) throw new Error("cleanup failed");
      return true;
    }) as typeof process.stderr.write;
    try {
      await expect(
        withUploadProgress(async (progress) => {
          progress("BIN", 1, 2);
          throw failure;
        }),
      ).rejects.toBe(failure);
    } finally {
      process.stderr.write = original;
    }
  });
});
