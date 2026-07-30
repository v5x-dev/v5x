import {
  serial,
  SerialEventTarget,
  type Serial,
  type SerialPort,
} from "@v5x/node";
import { matchesUsbFilters, V5SerialDevice } from "@v5x/serial";
import { basename } from "node:path";
import { requireOptionValue } from "./utils/guards";
import { CliError, CLI_EXIT_CODE, serialCliError } from "./errors";

export const V5X_PORT_ENV = "V5X_PORT";

export interface PortSelectionOptions {
  port?: string | boolean;
}

type Environment = Record<string, string | undefined>;

function normalizePortSelector(
  selector: string | boolean | undefined,
): string | undefined {
  const trimmed = requireOptionValue(selector, "--port")?.trim();
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

const FORWARDED_SERIAL_EVENTS = ["connect", "disconnect"] as const;

class SelectedSerialAdapter extends SerialEventTarget implements Serial {
  constructor(
    private readonly delegate: Serial,
    private readonly selector: string,
  ) {
    super();
    // Auto-reconnect waits on the Serial-level `connect` event, so an adapter
    // that only narrowed getPorts() would leave a `--port` device waiting
    // forever after a replug. The listeners live as long as this adapter,
    // which the CLI creates once per command.
    for (const type of FORWARDED_SERIAL_EVENTS) {
      this.delegate.addEventListener(type, () => {
        this.dispatchEvent(new Event(type));
      });
    }
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
      return matchesUsbFilters(candidate.getInfo(), filters);
    });
    if (port) return port;
    throw new CliError(
      `No port found matching ${this.selector}`,
      CLI_EXIT_CODE.NO_DEVICE,
    );
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
      // Not every connect failure means "nothing is plugged in": an I/O or
      // protocol error has its own exit code that scripts rely on.
      throw serialCliError(
        `v5 device not connected: ${result.error.message ?? result.error.kind}`,
        result.error,
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
