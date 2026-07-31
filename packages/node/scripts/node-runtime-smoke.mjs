import {
  createDefaultSerialBackend,
  createNodeSerialportBackend,
} from "../dist/index.js";

const defaultBackend = createDefaultSerialBackend(process.platform);
if (defaultBackend.name !== "node-serialport") {
  throw new Error(
    `Node selected ${defaultBackend.name}; expected node-serialport`,
  );
}

const listedPorts = await defaultBackend.list();
if (!Array.isArray(listedPorts)) {
  throw new Error("Node serialport enumeration did not return an array");
}

const windowsBackend = createDefaultSerialBackend("win32");
if (windowsBackend.name !== "node-serialport") {
  throw new Error(
    `Node selected ${windowsBackend.name} for Windows; expected node-serialport`,
  );
}

const windowsList = createNodeSerialportBackend({
  platform: "win32",
  windowsDiscovery: {
    readSerialComm: async () => "",
    readUsbPortNames: async () => "",
  },
});
if (
  !(await windowsList.list()).every((port) => typeof port.path === "string")
) {
  throw new Error("Node Windows discovery did not return valid port records");
}

console.log("@v5x/node Node.js runtime smoke passed");
