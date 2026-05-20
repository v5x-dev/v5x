interface SerialPortFilter {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialPortRequestOptions {
  filters?: SerialPortFilter[];
}

interface SerialPort extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  getInfo(): SerialPortInfo;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
}

interface Serial {
  getPorts(): Promise<SerialPort[]>;
  requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
}
