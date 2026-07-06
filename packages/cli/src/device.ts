import { V5SerialDevice } from "@v5x/serial";
import { basename } from "node:path";
import { serial, type Serial, type SerialPort } from "./adapter";

export const V5X_PORT_ENV = "V5X_PORT";

export interface PortSelectionOptions {
  port?: string;
}

type Environment = Record<string, string | undefined>;

function normalizePortSelector(
  selector: string | undefined,
): string | undefined {
  const trimmed = selector?.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function resolvePortSelector(
  options: PortSelectionOptions = {},
  environment: Environment = process.env,
): string | undefined {
  return (
    normalizePortSelector(options.port) ??
    normalizePortSelector(environment[V5X_PORT_ENV])
  );
}

function portIdentifiers(port: SerialPort): string[] {
  const info = port.getInfo();
  return [
    info.path,
    info.id,
    info.serialNumber,
    info.path === undefined ? undefined : basename(info.path),
  ].filter((value): value is string => value !== undefined && value !== "");
}

export function matchesPortSelector(
  port: SerialPort,
  selector: string,
): boolean {
  return portIdentifiers(port).includes(selector);
}

class SelectedSerialAdapter extends EventTarget implements Serial {
  onconnect: (event: Event) => void = () => {};
  ondisconnect: (event: Event) => void = () => {};

  constructor(
    private readonly delegate: Serial,
    private readonly selector: string,
  ) {
    super();
  }

  async getPorts(): Promise<SerialPort[]> {
    return (await this.delegate.getPorts()).filter((port) =>
      matchesPortSelector(port, this.selector),
    );
  }

  async requestPort(
    options?: Parameters<Serial["requestPort"]>[0],
  ): Promise<SerialPort> {
    const filters = options?.filters;
    const ports = await this.getPorts();
    const port = ports.find((candidate) => {
      if (candidate.readable !== null) return false;
      if (!filters?.length) return true;
      const info = candidate.getInfo();
      return filters.some(
        (filter) =>
          (filter.usbVendorId === undefined ||
            filter.usbVendorId === info.usbVendorId) &&
          (filter.usbProductId === undefined ||
            filter.usbProductId === info.usbProductId),
      );
    });
    if (port) return port;
    throw new Error(`No port found matching ${this.selector}`);
  }
}

export function selectSerialPort(
  baseSerial: Serial,
  selector: string | undefined,
): Serial {
  return selector === undefined
    ? baseSerial
    : new SelectedSerialAdapter(baseSerial, selector);
}

export function createV5Device(
  options: PortSelectionOptions = {},
): V5SerialDevice {
  return new V5SerialDevice(
    selectSerialPort(serial, resolvePortSelector(options)),
  );
}

export async function connectV5Device(
  device = createV5Device(),
): Promise<V5SerialDevice> {
  device.autoRefresh = false;
  try {
    const result = await device.connect();
    if (result.isErr()) {
      throw new Error(
        `v5 device not connected: ${result.error.message ?? result.error.kind}`,
      );
    }
    return device;
  } catch (error) {
    await device.dispose();
    throw error;
  }
}

export async function withV5Device<Result>(
  operation: (device: V5SerialDevice) => Promise<Result>,
  device = createV5Device(),
): Promise<Result> {
  const connectedDevice = await connectV5Device(device);
  try {
    return await operation(connectedDevice);
  } finally {
    await connectedDevice.dispose();
  }
}

export async function withSelectedV5Device<Result>(
  options: PortSelectionOptions,
  operation: (device: V5SerialDevice) => Promise<Result>,
): Promise<Result> {
  return await withV5Device(operation, createV5Device(options));
}
