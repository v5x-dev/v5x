export const VEX_USB_VID = 0x2888;
export const V5_BRAIN_USB_PID = 0x0501;
export const EXP_BRAIN_USB_PID = 0x0600;
export const V5_CONTROLLER_USB_PID = 0x0503;
export const AIR_HORNET_USB_PID = 0x0a00;
export const AIR_CONTROLLER_USB_PID = 0x0a10;
export const AIM_USB_PID = 0x0700;
export const AIV_USB_PID = 0x0800;
export const V5_SERIAL_BAUDRATE = 115200;

export enum VexSerialPortType {
  User = "user",
  System = "system",
  Controller = "controller",
}

export interface SerialPortMetadata {
  vid?: number;
  pid?: number;
  interfaceNumber?: number;
  manufacturer?: string;
  product?: string;
  serialNumber?: string;
}

export interface SerialPortInfo {
  path: string;
  metadata?: SerialPortMetadata;
  raw?: unknown;
}

export interface SerialPortAdapter<Port = unknown> {
  open(
    port: Port | SerialPortInfo | string,
    options?: { baudRate?: number; timeoutMs?: number },
  ): Promise<import("./index").SerialPortIO>;
}

export interface SerialPortListAdapter {
  list(): Promise<SerialPortInfo[]>;
}

export interface VexSerialPort {
  info: SerialPortInfo;
  type: VexSerialPortType;
}

export interface VexSerialDevice {
  systemPort: VexSerialPort;
  userPort?: VexSerialPort;
}

const brainPids = new Set([
  V5_BRAIN_USB_PID,
  EXP_BRAIN_USB_PID,
  AIR_CONTROLLER_USB_PID,
  AIR_HORNET_USB_PID,
  AIM_USB_PID,
  AIV_USB_PID,
]);

export function filterVexPorts(ports: SerialPortInfo[]): VexSerialPort[] {
  const filtered = ports.filter((port) => port.metadata?.vid === VEX_USB_VID);
  const byLocation = typesByLocation(filtered);
  if (byLocation.length > 0) return byLocation;
  if (process.platform === "darwin") return typesByNameDarwin(filtered);
  return typesByNameOrder(filtered);
}

export function findDevicesFromPorts(
  ports: SerialPortInfo[],
): VexSerialDevice[] {
  const vexPorts = filterVexPorts(ports);
  const devices: VexSerialDevice[] = [];
  const remaining = [...vexPorts];

  while (remaining.length > 0) {
    const port = remaining.shift()!;
    if (port.type === VexSerialPortType.Controller) {
      devices.push({ systemPort: port });
      continue;
    }

    if (port.type === VexSerialPortType.System) {
      const userIndex = remaining.findIndex(
        (candidate) => candidate.type === VexSerialPortType.User,
      );
      const userPort =
        userIndex >= 0 ? remaining.splice(userIndex, 1)[0] : undefined;
      devices.push({ systemPort: port, userPort });
      continue;
    }

    const systemIndex = remaining.findIndex(
      (candidate) => candidate.type === VexSerialPortType.System,
    );
    if (systemIndex >= 0) {
      devices.push({
        systemPort: remaining.splice(systemIndex, 1)[0]!,
        userPort: port,
      });
    }
  }

  return devices;
}

function typesByLocation(ports: SerialPortInfo[]): VexSerialPort[] {
  const out: VexSerialPort[] = [];
  for (const port of ports) {
    const pid = port.metadata?.pid;
    if (pid === V5_CONTROLLER_USB_PID) {
      out.push({ info: port, type: VexSerialPortType.Controller });
      continue;
    }
    if (!pid || !brainPids.has(pid)) continue;
    let location = port.metadata?.interfaceNumber;
    if (location == null) continue;
    if (process.platform === "darwin") location -= 1;
    if (location === 0)
      out.push({ info: port, type: VexSerialPortType.System });
    if (location === 2) out.push({ info: port, type: VexSerialPortType.User });
  }
  return out;
}

function typesByNameDarwin(ports: SerialPortInfo[]): VexSerialPort[] {
  const out: VexSerialPort[] = [];
  for (const port of ports) {
    if (port.path.startsWith("/dev/tty.")) continue;
    const suffix = port.path.at(-1);
    if (suffix === "1")
      out.push({ info: port, type: VexSerialPortType.System });
    if (suffix === "2")
      out.push({ info: port, type: VexSerialPortType.Controller });
    if (suffix === "3") out.push({ info: port, type: VexSerialPortType.User });
  }
  return out;
}

function typesByNameOrder(ports: SerialPortInfo[]): VexSerialPort[] {
  if (ports.length === 1 && ports[0]?.metadata?.pid === V5_CONTROLLER_USB_PID) {
    return [{ info: ports[0], type: VexSerialPortType.Controller }];
  }
  if (ports.length !== 2) return [];
  const [systemPort, userPort] = [...ports].sort((a, b) =>
    a.path.localeCompare(b.path),
  );
  return [
    { info: systemPort!, type: VexSerialPortType.System },
    { info: userPort!, type: VexSerialPortType.User },
  ];
}
