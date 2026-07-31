import { describe, expect, test } from "bun:test";
import { createDefaultSerialBackend } from "./default-backend.js";
import { NodeSerial } from "./serial.js";

describe("createDefaultSerialBackend", () => {
  test("drives the Win32 communications API on Windows", () => {
    const backend = createDefaultSerialBackend("win32");

    expect(backend.name).toBe("windows-serial");
    expect(backend.platforms).toEqual(["win32"]);
  });

  test("drives bun-serialport everywhere else", () => {
    for (const platform of ["darwin", "linux"]) {
      expect(createDefaultSerialBackend(platform).name).toBe("bun-serialport");
    }
  });
});

describe("NodeSerial", () => {
  test("enumerates on Windows without a backend of its own", async () => {
    const serial = new NodeSerial({
      platform: "win32",
      backend: createDefaultSerialBackend("win32"),
    });

    // The Windows backend declares win32, so enumeration reaches the registry
    // rather than being refused for an unsupported platform.
    await expect(serial.getPorts()).resolves.toBeArray();
  });
});
