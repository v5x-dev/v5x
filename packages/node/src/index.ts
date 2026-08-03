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
  NODE_SERIALPORT_PLATFORMS,
  createNodeSerialportBackend,
  type NodeSerialportBackendOptions,
} from "./node-serialport-backend.js";
export { createDefaultSerialBackend } from "./default-backend.js";
export {
  createWindowsSerialBackend,
  WINDOWS_SERIAL_PLATFORMS,
  type WindowsSerialBackendOptions,
} from "./windows-backend.js";
export {
  createWindowsPortLister,
  parseComPortNames,
  parseUsbPortAttributes,
  windowsDiscoveryOperations,
  type WindowsDiscoveryOperations,
} from "./windows-discovery.js";
export {
  openWindowsSerialPort,
  toWindowsDevicePath,
  WindowsSerialPort,
  type Kernel32,
  type Kernel32Symbols,
  type WindowsSerialPortOptions,
} from "./windows-serial.js";
export {
  LINUX_DISCOVERY_CONCURRENCY,
  createLinuxPortLister,
  linuxDiscoveryOperations,
  listLinuxPorts,
  readLinuxUsbDeviceAttributes,
  type LinuxDiscoveryOperations,
  type ReadTextFile,
  type UsbAttributes,
} from "./linux-discovery.js";
