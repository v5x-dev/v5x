/**
 * The native surface a host serial library has to provide. Everything above
 * this interface is platform-independent, so supporting a new runtime or
 * operating system means writing a backend rather than a new transport.
 */
export interface NativePortDescriptor {
  /** Host device path, for example `/dev/ttyACM0` or `COM3`. */
  path: string;
  /** Hexadecimal USB vendor id without a `0x` prefix, for example `2888`. */
  vendorId?: string;
  /** Hexadecimal USB product id without a `0x` prefix, for example `0501`. */
  productId?: string;
  serialNumber?: string;
}

export interface NativePortEventMap {
  data: Uint8Array;
  error: Error;
}

export interface NativePort {
  close(): Promise<void>;
  write(data: Uint8Array): Promise<unknown>;
  /** Stop emitting `data` while the readable stream is backpressured. */
  pause?(): void;
  resume?(): void;
  on<Event extends keyof NativePortEventMap>(
    event: Event,
    listener: (value: NativePortEventMap[Event]) => void,
  ): unknown;
  off<Event extends keyof NativePortEventMap>(
    event: Event,
    listener: (value: NativePortEventMap[Event]) => void,
  ): unknown;
  removeAllListeners?(): unknown;
}

export interface NativeOpenOptions {
  path: string;
  baudRate: number;
}

export interface SerialBackend {
  /** Identifies the backend in errors, for example `bun-serialport`. */
  readonly name: string;
  /**
   * Platforms this backend can drive. Omit it to accept every platform;
   * `NodeSerial` refuses to enumerate ports on any other platform so the
   * failure names the backend instead of surfacing as a native error.
   */
  readonly platforms?: readonly NodeJS.Platform[];
  list(): Promise<NativePortDescriptor[]>;
  /** Opens the port. The returned port must already be open. */
  open(options: NativeOpenOptions): Promise<NativePort>;
}
