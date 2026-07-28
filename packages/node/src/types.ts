/**
 * The Web Serial shapes `@v5x/serial` consumes, restated here so host runtimes
 * can use the transport without DOM lib types.
 *
 * `SerialPortInfo` is a superset of the browser's: a host process can see the
 * device path and USB serial number that a browser deliberately hides, and
 * `@v5x/cli` uses them to let people select a specific port.
 */
export interface SerialPortFilter {
  usbVendorId?: number;
  usbProductId?: number;
}

export interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
  /** Host device path, for example `/dev/ttyACM0` or `COM3`. */
  path?: string;
  /** The USB serial number when the platform reports one, otherwise the path. */
  id?: string;
  serialNumber?: string;
}

export interface SerialPort extends EventTarget {
  onconnect: ((event: Event) => void) | null;
  ondisconnect: ((event: Event) => void) | null;
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  getInfo(): SerialPortInfo;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  forget(): Promise<void>;
}

export interface Serial extends EventTarget {
  onconnect: ((event: Event) => void) | null;
  ondisconnect: ((event: Event) => void) | null;
  getPorts(): Promise<SerialPort[]>;
  requestPort(options?: { filters?: SerialPortFilter[] }): Promise<SerialPort>;
}
