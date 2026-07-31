import type { Kernel32, Kernel32Symbols } from "./windows-serial.js";

const HANDLE = 0x1234n;
const INVALID_HANDLE_VALUE = 0xffff_ffff_ffff_ffffn;

/**
 * A stand-in for `kernel32.dll` that keeps the buffers the port passes by
 * pointer, so a test on any host can read back what the backend wrote into a
 * `DCB` and feed bytes to a poll.
 */
export class FakeKernel32 implements Kernel32 {
  readonly symbols: Kernel32Symbols;
  /** Bytes handed to the next `ReadFile`. */
  incoming: Uint8Array[] = [];
  /** Everything `WriteFile` accepted, in order. */
  written: Uint8Array[] = [];
  calls: string[] = [];
  lastError = 0;
  openHandles = 0;
  /** Bytes `WriteFile` takes per call; 0 means all of them. */
  writeChunkSize = 0;
  private failing: string | undefined;
  private readonly pointers = new Map<number, NodeJS.TypedArray>();
  private readonly identifiers = new Map<NodeJS.TypedArray, number>();
  private nextPointer = 1;

  constructor(options: { fail?: string; lastError?: number } = {}) {
    this.failing = options.fail;
    this.lastError = options.lastError ?? 5;
    this.symbols = this.createSymbols();
  }

  ptr(view: NodeJS.TypedArray): number {
    let identifier = this.identifiers.get(view);
    if (identifier === undefined) {
      identifier = this.nextPointer++;
      this.identifiers.set(view, identifier);
      this.pointers.set(identifier, view);
    }
    return identifier;
  }

  /** The `DCB` or `COMMTIMEOUTS` bytes captured by the named call. */
  structAt(pointer: number): DataView {
    const view = this.pointers.get(pointer);
    if (view === undefined) throw new Error(`unknown pointer ${pointer}`);
    return new DataView(view.buffer, view.byteOffset, view.byteLength);
  }

  dcb: DataView | undefined;
  timeouts: DataView | undefined;
  path: string | undefined;

  private record(name: string): boolean {
    this.calls.push(name);
    return this.failing !== name;
  }

  private bytesAt(pointer: number): Uint8Array {
    const view = this.pointers.get(pointer);
    if (view === undefined) throw new Error(`unknown pointer ${pointer}`);
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }

  private createSymbols(): Kernel32Symbols {
    return {
      CreateFileW: (path) => {
        const wide = this.bytesAt(path);
        this.path = new TextDecoder("utf-16le")
          .decode(wide)
          .replace(/\0+$/, "");
        if (!this.record("CreateFileW")) return INVALID_HANDLE_VALUE;
        this.openHandles++;
        return HANDLE;
      },
      CloseHandle: () => {
        this.openHandles--;
        return this.record("CloseHandle");
      },
      GetCommState: (_handle, dcb) => {
        this.dcb = this.structAt(dcb);
        return this.record("GetCommState");
      },
      SetCommState: (_handle, dcb) => {
        this.dcb = this.structAt(dcb);
        return this.record("SetCommState");
      },
      SetCommTimeouts: (_handle, timeouts) => {
        this.timeouts = this.structAt(timeouts);
        return this.record("SetCommTimeouts");
      },
      SetupComm: () => this.record("SetupComm"),
      PurgeComm: () => this.record("PurgeComm"),
      ReadFile: (_handle, buffer, length, transferred) => {
        if (!this.record("ReadFile")) return false;
        const chunk = this.incoming.shift() ?? new Uint8Array(0);
        const copied = Math.min(chunk.length, length);
        this.bytesAt(buffer).set(chunk.subarray(0, copied));
        this.structAt(transferred).setUint32(0, copied, true);
        return true;
      },
      WriteFile: (_handle, buffer, length, transferred) => {
        if (!this.record("WriteFile")) return false;
        const accepted =
          this.writeChunkSize > 0
            ? Math.min(this.writeChunkSize, length)
            : length;
        this.written.push(this.bytesAt(buffer).slice(0, accepted));
        this.structAt(transferred).setUint32(0, accepted, true);
        return true;
      },
      GetLastError: () => this.lastError,
      FormatMessageW: (_flags, _source, _id, _language, buffer, size) => {
        const message = `fake failure ${this.lastError}`;
        const bytes = this.bytesAt(buffer);
        const target = new Uint16Array(
          bytes.buffer,
          bytes.byteOffset,
          Math.min(size, bytes.byteLength / 2),
        );
        for (let index = 0; index < message.length; index++) {
          target[index] = message.charCodeAt(index);
        }
        return message.length;
      },
    };
  }
}
