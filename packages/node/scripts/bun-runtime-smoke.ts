import {
  createDefaultSerialBackend,
  createNodeSerialportBackend,
} from "../src/index.js";

const defaultBackend = createDefaultSerialBackend(process.platform);
const expectedDefault =
  process.platform === "win32" ? "windows-serial" : "bun-serialport";
if (defaultBackend.name !== expectedDefault) {
  throw new Error(
    `Bun selected ${defaultBackend.name}; expected ${expectedDefault}`,
  );
}

const simulatedNodeBackend = createNodeSerialportBackend({
  platform: "win32",
  windowsDiscovery: {
    readSerialComm: async () => "",
    readUsbPortNames: async () => "",
  },
});
if (simulatedNodeBackend.name !== "node-serialport") {
  throw new Error("Bun smoke test could not construct the Node backend");
}

console.log("@v5x/node Bun runtime smoke passed");
