export type {
  Serial,
  SerialPort,
  SerialPortFilter,
  SerialPortInfo,
} from "./types.js";
export { SerialEventTarget } from "./event-target.js";
export { SerialConnectionEvent } from "./connection-event.js";
export { NodeSerialPort } from "./port.js";
export {
  createNodeSerial,
  NodeSerial,
  serial,
  type NodeSerialOptions,
} from "./serial.js";
export type {
  NativeOpenOptions,
  NativePort,
  NativePortDescriptor,
  NativePortEventMap,
  SerialBackend,
} from "./backend.js";
export {
  BUN_SERIALPORT_PLATFORMS,
  createBunSerialportBackend,
  type BunSerialportBackendOptions,
} from "./bun-serialport-backend.js";
export {
  LINUX_DISCOVERY_CONCURRENCY,
  linuxDiscoveryOperations,
  listLinuxPorts,
  readLinuxUsbDeviceAttributes,
  type LinuxDiscoveryOperations,
  type ReadTextFile,
  type UsbAttributes,
} from "./linux-discovery.js";
