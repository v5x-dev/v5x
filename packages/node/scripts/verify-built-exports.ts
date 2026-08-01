/**
 * The bundler tree-shakes a re-export-only entry point down to bare export
 * names when the package is marked side-effect free, which builds cleanly and
 * fails at import time. Check the built entry point actually carries values.
 */
import * as built from "../dist/index.js";

const expectedFunctions = [
  "createNodeSerial",
  "createDefaultSerialBackend",
  "createBunSerialportBackend",
  "createNodeSerialportBackend",
  "listLinuxPorts",
  "readLinuxUsbDeviceAttributes",
  "createWindowsSerialBackend",
  "createWindowsPortLister",
  "openWindowsSerialPort",
  "parseComPortNames",
  "parseUsbPortAttributes",
  "toWindowsDevicePath",
] as const;

for (const name of expectedFunctions) {
  if (typeof built[name] !== "function") {
    throw new Error(`@v5x/node dist/index.js is missing ${name}`);
  }
}

for (const name of [
  "NodeSerial",
  "NodeSerialPort",
  "SerialEventTarget",
  "WindowsSerialPort",
]) {
  if (typeof (built as Record<string, unknown>)[name] !== "function") {
    throw new Error(`@v5x/node dist/index.js is missing the ${name} class`);
  }
}

if (!(built.serial instanceof built.NodeSerial)) {
  throw new Error(
    "@v5x/node dist/index.js does not export a NodeSerial instance",
  );
}

const port = await built
  .createNodeSerial({
    platform: "win32",
    backend: {
      name: "verify",
      platforms: ["linux"],
      list: async () => [],
      open: async () => {
        throw new Error("unreachable");
      },
    },
  })
  .getPorts()
  .then(
    () => "resolved",
    (error: unknown) =>
      error instanceof Error ? error.message : String(error),
  );

if (!port.includes("does not support win32")) {
  throw new Error(
    "@v5x/node dist/index.js does not enforce backend platform support",
  );
}
