import { platform as hostPlatform } from "node:os";
import type { SerialBackend } from "./backend.js";
import { createBunSerialportBackend } from "./bun-serialport-backend.js";
import { createNodeSerialportBackend } from "./node-serialport-backend.js";
import { createWindowsSerialBackend } from "./windows-backend.js";

function isBunRuntime(): boolean {
  return "Bun" in globalThis;
}

/**
 * Picks the backend that can drive the host. Bun keeps its existing native
 * adapters; Node uses `serialport` on every supported operating system, so
 * the default never asks Node to load Bun-only modules. Neither native layer
 * loads until a port is enumerated or opened.
 */
export function createDefaultSerialBackend(
  platform: string = hostPlatform(),
): SerialBackend {
  if (isBunRuntime()) {
    return platform === "win32"
      ? createWindowsSerialBackend()
      : createBunSerialportBackend({ platform });
  }
  return createNodeSerialportBackend({ platform });
}
