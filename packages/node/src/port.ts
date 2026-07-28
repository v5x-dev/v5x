import type { NativePort, SerialBackend } from "./backend.js";
import { SerialEventTarget } from "./event-target.js";
import type { SerialPort, SerialPortInfo } from "./types.js";

/**
 * A single host serial port presented as a Web Serial port: `readable` and
 * `writable` exist only while the port is open, and closing detaches the
 * native listeners before the native close is awaited.
 */
export class NodeSerialPort extends SerialEventTarget implements SerialPort {
  private port: NativePort | null = null;
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

  getInfo(): SerialPortInfo {
    return this.info;
  }

  async open(options: { baudRate: number }): Promise<void> {
    if (this.port) throw new Error("Port already open");

    const port = await this.backend.open({
      path: this.path,
      baudRate: options.baudRate,
    });
    this.port = port;

    this._readable = new ReadableStream({
      start: (controller) => {
        this.controller = controller;
        this.dataListener = (data) => {
          if (this.port !== port || this.controller !== controller) return;

          if ((controller.desiredSize ?? 1) <= 0) {
            const pause = port.pause;
            if (typeof pause === "function" && !this.nativePaused) {
              pause.call(port);
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

          if ((controller.desiredSize ?? 1) <= 0 && !this.nativePaused) {
            const pause = port.pause;
            if (typeof pause === "function") {
              pause.call(port);
              this.nativePaused = true;
            }
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
      cancel: () => void this.close(),
    });

    this._writable = new WritableStream({
      write: async (chunk) => {
        if (!this.port) throw new Error("Port closed");
        await this.port.write(chunk);
      },
      close: () => this.close(),
    });
  }

  async close(): Promise<void> {
    const port = this.port;
    if (!port) return;
    this.port = null;
    this.detachNativeListeners(port);

    try {
      this.controller?.close();
    } catch {
      // The controller may already have been closed by the native port.
    }
    this.controller = null;

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
      this.dispatchEvent(new Event("disconnect"));
    }
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
    port.resume?.();
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
   * port is just closing it.
   */
  async forget(): Promise<void> {
    await this.close();
  }
}
