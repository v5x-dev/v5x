import type { NativePort, SerialBackend } from "./backend.js";
import { SerialEventTarget } from "./event-target.js";
import type { SerialPort, SerialPortInfo } from "./types.js";

/**
 * A single host serial port presented as a Web Serial port: `readable` and
 * `writable` exist only while the port is open, and closing detaches the
 * native listeners before the native close is awaited.
 */
export class NodeSerialPort extends SerialEventTarget implements SerialPort {
  private state: "closed" | "opening" | "open" | "closing" = "closed";
  private port: NativePort | null = null;
  private closePromise: Promise<void> | null = null;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private dataListener: ((data: Uint8Array) => void) | null = null;
  private errorListener: ((error: Error) => void) | null = null;
  private nativePaused = false;
  private _readable: ReadableStream<Uint8Array> | null = null;
  private _writable: WritableStream<Uint8Array> | null = null;

  constructor(
    private readonly backend: SerialBackend,
    private readonly path: string,
    private readonly info: SerialPortInfo,
  ) {
    super();
  }

  get readable(): ReadableStream<Uint8Array> | null {
    return this._readable;
  }
  get writable(): WritableStream<Uint8Array> | null {
    return this._writable;
  }
  /** Whether no native open or close operation is in progress. */
  get isClosed(): boolean {
    return this.state === "closed";
  }

  getInfo(): SerialPortInfo {
    return this.info;
  }

  async open(options: { baudRate: number }): Promise<void> {
    if (this.state !== "closed") {
      throw new Error(
        this.state === "open" ? "Port already open" : `Port is ${this.state}`,
      );
    }
    this.state = "opening";

    let port: NativePort;
    try {
      port = await this.backend.open({
        path: this.path,
        baudRate: options.baudRate,
      });
    } catch (error) {
      this.state = "closed";
      throw error;
    }
    this.port = port;

    try {
      this._readable = new ReadableStream({
        start: (controller) => {
          this.controller = controller;
          this.dataListener = (data) => {
            if (this.port !== port || this.controller !== controller) return;

            if ((controller.desiredSize ?? 1) <= 0) {
              if (this.canPause(port) && !this.nativePaused) {
                port.pause();
                this.nativePaused = true;
              } else {
                this.failReadableBackpressure(port, controller);
                return;
              }
            }

            try {
              controller.enqueue(data);
            } catch {
              // Closing detaches this listener synchronously, but an event that
              // was already being dispatched may still reach this callback.
              return;
            }

            if (
              (controller.desiredSize ?? 1) <= 0 &&
              !this.nativePaused &&
              this.canPause(port)
            ) {
              port.pause();
              this.nativePaused = true;
            }
          };
          this.errorListener = (error) => {
            if (this.port !== port || this.controller !== controller) return;
            controller.error(error);
            this.controller = null;
            this.close().catch(() => {});
          };
          port.on("data", this.dataListener);
          port.on("error", this.errorListener);
        },
        pull: () => this.resumeNativePort(port),
        cancel: () => this.close(),
      });

      this._writable = new WritableStream({
        write: async (chunk) => {
          if (this.port !== port || this.state !== "open") {
            throw new Error("Port closed");
          }
          await port.write(chunk);
        },
        close: () => this.close(),
      });
      this.state = "open";
    } catch (error) {
      this.port = null;
      this.detachNativeListeners(port);
      this.controller = null;
      this._readable = null;
      this._writable = null;
      this.state = "closed";
      try {
        await port.close();
      } catch {
        // Preserve the stream-construction error.
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.state === "closing" && this.closePromise !== null) {
      return this.closePromise;
    }
    if (this.state === "opening") throw new Error("Port is opening");

    const port = this.port;
    if (!port) return;
    this.state = "closing";
    this.port = null;
    this.detachNativeListeners(port);

    try {
      this.controller?.close();
    } catch {
      // The controller may already have been closed by the native port.
    }
    this.controller = null;

    const closing = this.closeNativePort(port);
    this.closePromise = closing;
    try {
      await closing;
    } finally {
      if (this.closePromise === closing) this.closePromise = null;
    }
  }

  private async closeNativePort(port: NativePort): Promise<void> {
    try {
      await port.close();
    } finally {
      try {
        port.removeAllListeners?.();
      } catch {
        // Some native serial implementations do not expose listener cleanup.
      }
      this._readable = null;
      this._writable = null;
      this.state = "closed";
    }
  }

  /**
   * Report that the host stopped listing this port's device.
   *
   * Only discovery can tell a physical removal apart from ordinary teardown,
   * so it owns the `disconnect` event. Dispatching it from `close()` instead
   * would make every normal cleanup look like an unplug while a real unplug
   * of an idle port went unreported.
   */
  notifyDeviceRemoved(): void {
    this.dispatchEvent(new Event("disconnect"));
  }

  private detachNativeListeners(port: NativePort): void {
    if (this.dataListener !== null) port.off("data", this.dataListener);
    if (this.errorListener !== null) port.off("error", this.errorListener);
    this.dataListener = null;
    this.errorListener = null;
    this.nativePaused = false;
  }

  private resumeNativePort(port: NativePort): void {
    if (this.port !== port || !this.nativePaused) return;
    this.nativePaused = false;
    if (this.canPause(port)) port.resume();
  }

  private canPause(
    port: NativePort,
  ): port is NativePort & Required<Pick<NativePort, "pause" | "resume">> {
    return (
      typeof port.pause === "function" && typeof port.resume === "function"
    );
  }

  private failReadableBackpressure(
    port: NativePort,
    controller: ReadableStreamDefaultController<Uint8Array>,
  ): void {
    if (this.port !== port || this.controller !== controller) return;
    controller.error(
      new Error(
        "serial input exceeded readable-stream capacity; the native backend cannot pause",
      ),
    );
    this.controller = null;
    void this.close();
  }

  /**
   * A host process has no per-origin permission to revoke, so forgetting a
   * port is just closing it. Like `close()`, it reports no `disconnect`: the
   * device is still plugged in.
   */
  async forget(): Promise<void> {
    await this.close();
  }
}
