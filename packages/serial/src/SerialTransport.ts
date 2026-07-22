import {
  VexIoError,
  type VexSerialError,
  toVexSerialError,
} from "./VexError.js";
import { err, ok, type Result } from "neverthrow";
import { ReaderClosedError } from "./ReaderClosedError.js";

export type SerialTransportOpenResult = "opened" | "busy" | "no-port";

interface SerialTransportCallbacks {
  hasPendingRequests: () => boolean;
  beforeClose: () => void;
  startReader: () => void;
  connected: () => void;
  disconnected: () => void;
  warning: (message: string, details?: unknown) => void;
}

function isPortSelectionCanceled(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotFoundError";
}

/** Owns port selection, stream locks, and transport teardown. */
export class SerialTransport {
  writer: WritableStreamDefaultWriter<unknown> | undefined;
  reader: ReadableStreamDefaultReader<unknown> | undefined;
  port: SerialPort | undefined;

  private closePromise: Promise<void> | null = null;
  private openPromise: Promise<
    Result<SerialTransportOpenResult, VexSerialError>
  > | null = null;
  private onPortDisconnect: (() => void) | null = null;
  private closing = false;
  private wasConnected = false;

  constructor(
    private readonly getSerial: () => Serial,
    private readonly getFilters: () => SerialPortFilter[],
    private readonly callbacks: SerialTransportCallbacks,
  ) {}

  get isConnected(): boolean {
    return (
      this.port !== undefined &&
      this.reader !== undefined &&
      this.writer !== undefined
    );
  }

  get isClosing(): boolean {
    return this.closing;
  }

  open(
    use: number,
    askUser: boolean,
  ): Promise<Result<SerialTransportOpenResult, VexSerialError>> {
    if (this.openPromise !== null) return this.openPromise;

    const opening = this.openPort(use, askUser);
    this.openPromise = opening;
    void opening.then(
      () => {
        if (this.openPromise === opening) this.openPromise = null;
      },
      () => {
        if (this.openPromise === opening) this.openPromise = null;
      },
    );
    return opening;
  }

  async close(): Promise<void> {
    if (this.closePromise !== null) return this.closePromise;

    this.closing = true;
    const closing = this.closeAfterOpen();
    this.closePromise = closing;
    try {
      await closing;
    } finally {
      if (this.closePromise === closing) this.closePromise = null;
      this.closing = false;
    }
  }

  async readData(
    cache: { byteLength: number; append(data: Uint8Array): void },
    expectedSize: number,
  ): Promise<void> {
    if (this.reader == null) throw new Error("No reader");

    while (cache.byteLength < expectedSize) {
      const { value, done } = await this.reader.read();
      if (done) throw new ReaderClosedError();
      cache.append(value as Uint8Array);
    }
  }

  private async openPort(
    use: number,
    askUser: boolean,
  ): Promise<Result<SerialTransportOpenResult, VexSerialError>> {
    if (this.closePromise !== null) await this.closePromise;
    if (this.port !== undefined)
      return err(new VexIoError("Already connected."));

    let filters: SerialPortFilter[];
    let serial: Serial;
    let ports: SerialPort[];
    try {
      filters = this.getFilters();
      serial = this.getSerial();
      ports = (await serial.getPorts())
        .filter((port) => {
          const info = port.getInfo();
          return filters.some(
            (filter) =>
              (filter.usbVendorId === undefined ||
                filter.usbVendorId === info.usbVendorId) &&
              (filter.usbProductId === undefined ||
                filter.usbProductId === info.usbProductId),
          );
        })
        .filter((candidate) => candidate.readable === null);
    } catch (error) {
      return err(toVexSerialError(error, "io"));
    }

    let port: SerialPort | undefined = ports[use];
    if (port == null && askUser) {
      try {
        port = await serial.requestPort({ filters });
      } catch (error) {
        if (!isPortSelectionCanceled(error)) {
          return err(toVexSerialError(error, "io"));
        }
      }
    }

    if (port == null) return ok("no-port");
    if (port.readable != null) return ok("busy");

    try {
      this.port = port;
      await port.open({ baudRate: 115200 });
      this.onPortDisconnect = () => void this.close();
      port.addEventListener("disconnect", this.onPortDisconnect);
      this.writer = this.port.writable.getWriter();
      this.reader = this.port.readable.getReader();
      this.callbacks.startReader();
      this.wasConnected = true;
      this.callbacks.connected();
      return ok("opened");
    } catch (error) {
      await this.doClose();
      return err(toVexSerialError(error, "io"));
    }
  }

  private async closeAfterOpen(): Promise<void> {
    const opening = this.openPromise;
    if (opening !== null) await opening;
    if (!this.hasOpenResources()) return;
    await this.doClose();
  }

  private hasOpenResources(): boolean {
    return (
      this.port !== undefined ||
      this.reader !== undefined ||
      this.writer !== undefined ||
      this.onPortDisconnect !== null ||
      this.callbacks.hasPendingRequests()
    );
  }

  private async doClose(): Promise<void> {
    this.callbacks.beforeClose();

    const onDisconnect = this.onPortDisconnect;
    this.onPortDisconnect = null;
    if (onDisconnect !== null) {
      try {
        this.port?.removeEventListener("disconnect", onDisconnect);
      } catch {
        // The port may already be gone.
      }
    }

    const writer = this.writer;
    this.writer = undefined;
    if (writer !== undefined) {
      try {
        await writer.close();
      } catch {
        // The stream may already be closed or errored.
      } finally {
        try {
          writer.releaseLock();
        } catch {
          // Some stream implementations do not support explicit release.
        }
      }
    }

    const reader = this.reader;
    this.reader = undefined;
    if (reader !== undefined) {
      try {
        await reader.cancel();
      } catch {
        // The stream may already be closed or errored.
      }
      try {
        while (!(await reader.read()).done) {
          // Drain remaining bytes before releasing the lock.
        }
      } catch {
        // Cancellation may have left the reader in an errored state.
      } finally {
        try {
          reader.releaseLock();
        } catch {
          // Some stream implementations do not support explicit release.
        }
      }
    }

    const port = this.port;
    this.port = undefined;
    if (port !== undefined) {
      try {
        await port.close();
      } catch (error) {
        this.callbacks.warning("failed to close the serial port", error);
      }
    }

    if (this.wasConnected) {
      this.wasConnected = false;
      this.callbacks.disconnected();
    }
  }
}
