import { platform as hostPlatform } from "node:os";
import type { SerialBackend } from "./backend.js";
import { createBunSerialportBackend } from "./bun-serialport-backend.js";
import { createWindowsSerialBackend } from "./windows-backend.js";

/**
 * Picks the backend that can drive the host: the Win32 communications API on
 * Windows, `bun-serialport` everywhere else. Neither backend's native layer
 * loads until a port is enumerated or opened, so choosing one on the wrong
 * platform still imports cleanly.
 */
export function createDefaultSerialBackend(
  platform: string = hostPlatform(),
): SerialBackend {
  return platform === "win32"
    ? createWindowsSerialBackend()
    : createBunSerialportBackend({ platform });
}
