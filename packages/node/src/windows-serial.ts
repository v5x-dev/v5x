import type {
  NativeOpenOptions,
  NativePort,
  NativePortEventMap,
} from "./backend.js";

/**
 * Windows has no serial device files, so there is nothing for a POSIX serial
 * library to open. This talks to the Win32 communications API through
 * `bun:ffi` instead, which keeps the transport free of a native addon and a
 * compilation step on the one platform that would need both.
 */

/** `GENERIC_READ | GENERIC_WRITE`, written out because `|` yields a signed int. */
const GENERIC_READ_WRITE = 0xc000_0000;
const OPEN_EXISTING = 3;
const FILE_ATTRIBUTE_NORMAL = 0x80;
const INVALID_HANDLE_VALUE = 0xffff_ffff_ffff_ffffn;
const NULL_HANDLE = 0n;
const MAXDWORD = 0xffff_ffff;

const PURGE_TXABORT = 0x0001;
const PURGE_RXABORT = 0x0002;
const PURGE_TXCLEAR = 0x0004;
const PURGE_RXCLEAR = 0x0008;
const PURGE_ALL = PURGE_TXABORT | PURGE_RXABORT | PURGE_TXCLEAR | PURGE_RXCLEAR;

const FORMAT_MESSAGE_FROM_SYSTEM = 0x0000_1000;
const FORMAT_MESSAGE_IGNORE_INSERTS = 0x0000_0200;

/** `DCB`, whose first field is its own size. */
const DCB_SIZE = 28;
const DCB_BAUD_RATE = 4;
const DCB_FLAGS = 8;
const DCB_BYTE_SIZE = 18;
const DCB_PARITY = 19;
const DCB_STOP_BITS = 20;

/**
 * `fBinary`, plus `DTR_CONTROL_ENABLE` and `RTS_CONTROL_ENABLE` in the
 * two-bit `fDtrControl` and `fRtsControl` fields. A USB CDC device such as a
 * V5 brain only opens its data pipe once DTR is asserted, and every other
 * flow-control bit stays clear so the link is raw 8-N-1.
 */
const DCB_RAW_FLAGS = (1 << 0) | (1 << 4) | (1 << 12);
const NO_PARITY = 0;
const ONE_STOP_BIT = 0;
const EIGHT_DATA_BITS = 8;

/** `COMMTIMEOUTS`. */
const COMMTIMEOUTS_SIZE = 20;

const IO_QUEUE_SIZE = 65536;
const DEFAULT_READ_BUFFER_SIZE = 65536;
/**
 * Win32 offers no readable-fd notification that Bun can wait on, so reads are
 * polled. One millisecond keeps upload throughput close to the link rate
 * without spinning the loop.
 */
const DEFAULT_READ_INTERVAL_MS = 1;

/**
 * The Win32 calls the backend makes, named so a test can stand in for
 * `kernel32.dll` without a Windows host. Handles are `bigint` because
 * `INVALID_HANDLE_VALUE` does not survive a conversion to `number`.
 */
export interface Kernel32Symbols {
  CreateFileW(
    path: number,
    access: number,
    share: number,
    security: bigint,
    creation: number,
    flags: number,
    template: bigint,
  ): bigint;
  CloseHandle(handle: bigint): boolean;
  GetCommState(handle: bigint, dcb: number): boolean;
  SetCommState(handle: bigint, dcb: number): boolean;
  SetCommTimeouts(handle: bigint, timeouts: number): boolean;
  SetupComm(handle: bigint, inQueue: number, outQueue: number): boolean;
  PurgeComm(handle: bigint, flags: number): boolean;
  ReadFile(
    handle: bigint,
    buffer: number,
    length: number,
    transferred: number,
    overlapped: bigint,
  ): boolean;
  WriteFile(
    handle: bigint,
    buffer: number,
    length: number,
    transferred: number,
    overlapped: bigint,
  ): boolean;
  GetLastError(): number;
  FormatMessageW(
    flags: number,
    source: bigint,
    messageId: number,
    languageId: number,
    buffer: number,
    size: number,
    args: bigint,
  ): number;
}

/** `kernel32.dll` plus the pointer helper its buffers are passed through. */
export interface Kernel32 {
  readonly symbols: Kernel32Symbols;
  ptr(view: NodeJS.TypedArray): number;
}

let kernel32: Promise<Kernel32> | undefined;

async function loadKernel32(): Promise<Kernel32> {
  const { dlopen, FFIType, ptr } = await import("bun:ffi");
  const { u32, u64, ptr: pointer, bool } = FFIType;

  const library = dlopen("kernel32.dll", {
    CreateFileW: {
      args: [pointer, u32, u32, u64, u32, u32, u64],
      returns: u64,
    },
    CloseHandle: { args: [u64], returns: bool },
    GetCommState: { args: [u64, pointer], returns: bool },
    SetCommState: { args: [u64, pointer], returns: bool },
    SetCommTimeouts: { args: [u64, pointer], returns: bool },
    SetupComm: { args: [u64, u32, u32], returns: bool },
    PurgeComm: { args: [u64, u32], returns: bool },
    ReadFile: { args: [u64, pointer, u32, pointer, u64], returns: bool },
    WriteFile: { args: [u64, pointer, u32, pointer, u64], returns: bool },
    GetLastError: { args: [], returns: u32 },
    FormatMessageW: {
      args: [u32, u64, u32, u32, pointer, u32, u64],
      returns: u32,
    },
  });

  return {
    symbols: library.symbols as unknown as Kernel32Symbols,
    ptr: (view) => Number(ptr(view)),
  };
}

/**
 * `dlopen` fails outside Windows and outside Bun, so the library is loaded on
 * first use rather than at import time. `@v5x/node` is imported on every
 * platform.
 */
async function kernel32Symbols(): Promise<Kernel32> {
  kernel32 ??= loadKernel32().catch((cause: unknown) => {
    kernel32 = undefined;
    throw new Error(
      "The Windows serial backend needs Bun's FFI support and kernel32.dll; run on Bun under Windows, or pass a `backend` your runtime supports to createNodeSerial().",
      { cause },
    );
  });
  return kernel32;
}

function lastErrorMessage(api: Kernel32, code: number): string {
  const buffer = new Uint16Array(512);
  const length = api.symbols.FormatMessageW(
    FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
    NULL_HANDLE,
    code,
    0,
    api.ptr(buffer),
    buffer.length,
    NULL_HANDLE,
  );
  if (length === 0) return `error ${code}`;
  return new TextDecoder("utf-16le").decode(buffer.subarray(0, length)).trim();
}

function win32Error(api: Kernel32, operation: string): Error {
  const code = api.symbols.GetLastError();
  const error = new Error(`${operation}: ${lastErrorMessage(api, code)}`);
  Object.assign(error, { code });
  return error;
}

/**
 * `COM10` and above are reserved DOS device names that only resolve through
 * the `\\.\` namespace; the low-numbered ports resolve either way.
 */
export function toWindowsDevicePath(path: string): string {
  return /^COM\d+$/i.test(path) ? `\\\\.\\${path.toUpperCase()}` : path;
}

function encodeWidePath(path: string): Uint16Array {
  const wide = new Uint16Array(path.length + 1);
  for (let index = 0; index < path.length; index++) {
    wide[index] = path.charCodeAt(index);
  }
  return wide;
}

export interface WindowsSerialPortOptions extends NativeOpenOptions {
  /** Milliseconds between reads. Defaults to 1. */
  readInterval?: number;
  /** Bytes read per poll. Defaults to 65536. */
  readBufferSize?: number;
  /** Stands in for `kernel32.dll`. Defaults to the real library. */
  kernel32?: Kernel32;
}

type Listener<Event extends keyof NativePortEventMap> = (
  value: NativePortEventMap[Event],
) => void;

/**
 * A single open COM port. It reports data through `data` and `error` events
 * so it satisfies the same `NativePort` contract as the POSIX backend, and it
 * supports `pause()`/`resume()` so the transport can apply backpressure by
 * suspending the read poll rather than buffering without bound.
 */
export class WindowsSerialPort implements NativePort {
  private readonly dataListeners = new Set<Listener<"data">>();
  private readonly errorListeners = new Set<Listener<"error">>();
  private readonly readBuffer: Uint8Array;
  private readonly transferred = new Uint8Array(4);
  private readonly transferredView: DataView;
  private readonly readInterval: number;
  private readTimer: ReturnType<typeof setInterval> | undefined;
  private closed = false;

  constructor(
    private readonly api: Kernel32,
    private handle: bigint,
    options: WindowsSerialPortOptions,
  ) {
    this.readBuffer = new Uint8Array(
      options.readBufferSize ?? DEFAULT_READ_BUFFER_SIZE,
    );
    this.transferredView = new DataView(this.transferred.buffer);
    this.readInterval = options.readInterval ?? DEFAULT_READ_INTERVAL_MS;
    this.resume();
  }

  on<Event extends keyof NativePortEventMap>(
    event: Event,
    listener: Listener<Event>,
  ): this {
    this.listenersFor(event).add(listener);
    return this;
  }

  off<Event extends keyof NativePortEventMap>(
    event: Event,
    listener: Listener<Event>,
  ): this {
    this.listenersFor(event).delete(listener);
    return this;
  }

  removeAllListeners(): this {
    this.dataListeners.clear();
    this.errorListeners.clear();
    return this;
  }

  private listenersFor(event: keyof NativePortEventMap): Set<Listener<never>> {
    return (event === "data" ? this.dataListeners : this.errorListeners) as Set<
      Listener<never>
    >;
  }

  pause(): void {
    if (this.readTimer === undefined) return;
    clearInterval(this.readTimer);
    this.readTimer = undefined;
  }

  resume(): void {
    if (this.readTimer !== undefined || this.closed) return;
    this.readTimer = setInterval(() => this.poll(), this.readInterval);
    this.readTimer.unref?.();
  }

  private poll(): void {
    if (this.closed) return;

    let read: number;
    try {
      read = this.readOnce();
    } catch (error) {
      // The port is gone or unusable; stop polling before reporting so the
      // failure is not repeated once a millisecond.
      this.pause();
      for (const listener of [...this.errorListeners]) {
        listener(error instanceof Error ? error : new Error(String(error)));
      }
      return;
    }

    if (read === 0) return;
    // Hand out a copy: the read buffer is reused by the next poll.
    const chunk = this.readBuffer.slice(0, read);
    for (const listener of [...this.dataListeners]) listener(chunk);
  }

  private readOnce(): number {
    const ok = this.api.symbols.ReadFile(
      this.handle,
      this.api.ptr(this.readBuffer),
      this.readBuffer.length,
      this.api.ptr(this.transferred),
      NULL_HANDLE,
    );
    if (!ok) throw win32Error(this.api, "read");
    return this.transferredView.getUint32(0, true);
  }

  async write(data: Uint8Array): Promise<number> {
    if (this.closed) throw new Error("Port is not open");

    let offset = 0;
    while (offset < data.length) {
      const chunk = data.subarray(offset);
      const ok = this.api.symbols.WriteFile(
        this.handle,
        this.api.ptr(chunk),
        chunk.length,
        this.api.ptr(this.transferred),
        NULL_HANDLE,
      );
      if (!ok) throw win32Error(this.api, "write");

      const written = this.transferredView.getUint32(0, true);
      if (written === 0) throw new Error("write: the device accepted no data");
      offset += written;
    }
    return offset;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.pause();

    this.api.symbols.PurgeComm(this.handle, PURGE_ALL);
    const ok = this.api.symbols.CloseHandle(this.handle);
    this.handle = INVALID_HANDLE_VALUE;
    if (!ok) throw win32Error(this.api, "close");
  }
}

/** Opens a COM port and returns it already configured for raw 8-N-1 traffic. */
export async function openWindowsSerialPort(
  options: WindowsSerialPortOptions,
): Promise<NativePort> {
  const api = options.kernel32 ?? (await kernel32Symbols());
  const path = encodeWidePath(toWindowsDevicePath(options.path));

  const handle = api.symbols.CreateFileW(
    api.ptr(path),
    GENERIC_READ_WRITE,
    // No sharing: a serial port has one owner, and a second opener should be
    // told the port is busy rather than silently stealing bytes.
    0,
    NULL_HANDLE,
    OPEN_EXISTING,
    FILE_ATTRIBUTE_NORMAL,
    NULL_HANDLE,
  );
  if (handle === INVALID_HANDLE_VALUE) {
    throw win32Error(api, `open ${options.path}`);
  }

  try {
    configurePort(api, handle, options.baudRate);
  } catch (error) {
    api.symbols.CloseHandle(handle);
    throw error;
  }

  return new WindowsSerialPort(api, handle, options);
}

function configurePort(api: Kernel32, handle: bigint, baudRate: number): void {
  api.symbols.SetupComm(handle, IO_QUEUE_SIZE, IO_QUEUE_SIZE);

  const dcb = new Uint8Array(DCB_SIZE);
  const dcbView = new DataView(dcb.buffer);
  dcbView.setUint32(0, DCB_SIZE, true);
  // Start from the driver's current settings so the reserved fields keep
  // whatever the driver put there.
  if (!api.symbols.GetCommState(handle, api.ptr(dcb))) {
    throw win32Error(api, "GetCommState");
  }

  dcbView.setUint32(0, DCB_SIZE, true);
  dcbView.setUint32(DCB_BAUD_RATE, baudRate, true);
  dcbView.setUint32(DCB_FLAGS, DCB_RAW_FLAGS, true);
  dcbView.setUint8(DCB_BYTE_SIZE, EIGHT_DATA_BITS);
  dcbView.setUint8(DCB_PARITY, NO_PARITY);
  dcbView.setUint8(DCB_STOP_BITS, ONE_STOP_BIT);
  if (!api.symbols.SetCommState(handle, api.ptr(dcb))) {
    throw win32Error(api, "SetCommState");
  }

  // `ReadIntervalTimeout = MAXDWORD` with both read totals at zero makes
  // ReadFile return whatever is already buffered instead of blocking, which
  // is what the polling read loop needs. Writes get a bound so a wedged
  // device cannot stall the process forever.
  const timeouts = new Uint8Array(COMMTIMEOUTS_SIZE);
  const timeoutsView = new DataView(timeouts.buffer);
  timeoutsView.setUint32(0, MAXDWORD, true);
  timeoutsView.setUint32(4, 0, true);
  timeoutsView.setUint32(8, 0, true);
  timeoutsView.setUint32(12, 0, true);
  timeoutsView.setUint32(16, 5000, true);
  if (!api.symbols.SetCommTimeouts(handle, api.ptr(timeouts))) {
    throw win32Error(api, "SetCommTimeouts");
  }

  api.symbols.PurgeComm(handle, PURGE_ALL);
}
