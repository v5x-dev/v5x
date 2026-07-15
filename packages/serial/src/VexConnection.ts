import {
  AckType,
  FileDownloadTarget,
  FileExitAction,
  FileInitAction,
  FileInitOption,
  FileLoadAction,
  FileVendor,
  type IFileBasicInfo,
  type IFileWriteRequest,
  type IPacketCallback,
  type MatchMode,
  SerialDeviceType,
  type SlotNumber,
  USER_FLASH_USR_CODE_START,
  USER_PROG_CHUNK_SIZE,
  type SelectDashScreen,
} from "./Vex.js";
import {
  VexIoError,
  VexInvalidArgumentError,
  VexNotConnectedError,
  VexProtocolError,
  VexSerialError,
  VexTransferError,
  toVexSerialError,
} from "./VexError.js";
import { VexEventTarget } from "./VexEvent.js";
import { type ProgramIniConfig } from "./VexIniConfig.js";
import { err, ok, Result, ResultAsync } from "neverthrow";
import {
  MatchStatusReplyD2HPacket,
  DeviceBoundPacket,
  GetMatchStatusH2DPacket,
  UpdateMatchModeH2DPacket,
  MatchModeReplyD2HPacket,
  GetSystemStatusReplyD2HPacket,
  GetSystemStatusH2DPacket,
  type HostBoundPacket,
  InitFileTransferH2DPacket,
  InitFileTransferReplyD2HPacket,
  LinkFileH2DPacket,
  ExitFileTransferH2DPacket,
  ExitFileTransferReplyD2HPacket,
  WriteFileReplyD2HPacket,
  WriteFileH2DPacket,
  LinkFileReplyD2HPacket,
  ReadFileH2DPacket,
  ReadFileReplyD2HPacket,
  SystemVersionH2DPacket,
  SystemVersionReplyD2HPacket,
  Query1H2DPacket,
  Query1ReplyD2HPacket,
  LoadFileActionH2DPacket,
  LoadFileActionReplyD2HPacket,
  GetSystemFlagsH2DPacket,
  GetSystemFlagsReplyD2HPacket,
  GetRadioStatusH2DPacket,
  GetRadioStatusReplyD2HPacket,
  GetDeviceStatusH2DPacket,
  GetDeviceStatusReplyD2HPacket,
  SendDashTouchH2DPacket,
  SendDashTouchReplyD2HPacket,
  SelectDashH2DPacket,
  SelectDashReplyD2HPacket,
  ScreenCaptureH2DPacket,
  ScreenCaptureReplyD2HPacket,
  EraseFileH2DPacket,
  EraseFileReplyD2HPacket,
  FileClearUpH2DPacket,
  FileClearUpReplyD2HPacket,
} from "./VexPacket.js";
import { type VexFirmwareVersion } from "./VexFirmwareVersion.js";
import {
  convertScreenCapture,
  SCREEN_CAPTURE_FRAMEBUFFER_SIZE,
} from "./VexScreenCapture.js";
import { FileTransferQueue } from "./FileTransferQueue.js";
import { PendingRequestDispatcher } from "./PendingRequestDispatcher.js";
import { ReceiveBuffer } from "./ReceiveBuffer.js";
import { runPacketReader } from "./PacketReader.js";

type HostBoundPacketType<T extends HostBoundPacket> = {
  new (data: ArrayBuffer | Uint8Array): T;
  name: string;
};

/** Outcome of {@link VexSerialConnection.open}. */
export type OpenResult = "opened" | "busy" | "no-port";

/**
 * Payload of the `warning` event: a non-fatal condition the library
 * recovered from, surfaced so embedders can log or ignore it.
 */
export interface ConnectionWarning {
  message: string;
  details?: unknown;
}

export interface VexSerialConnectionEvents {
  connected: undefined;
  disconnected: undefined;
  warning: ConnectionWarning;
}

/** Default upper bound for a file downloaded from a connected device. */
export const DEFAULT_MAX_FILE_DOWNLOAD_BYTES = 64 * 1024 * 1024;

export interface VexSerialConnectionOptions {
  /** Maximum file size accepted from a caller or device before allocation. */
  maxFileDownloadBytes?: number;
}

/**
 * A connection to a V5 device.
 * Emit events: connected, disconnected, warning
 */
export class VexSerialConnection extends VexEventTarget<VexSerialConnectionEvents> {
  filters: SerialPortFilter[] = [{ usbVendorId: 10376 }];

  writer: WritableStreamDefaultWriter<unknown> | undefined;
  reader: ReadableStreamDefaultReader<unknown> | undefined;
  port: SerialPort | undefined;
  serial: Serial;
  readonly maxFileDownloadBytes: number;

  private readonly pendingRequests = new PendingRequestDispatcher();
  private _onPortDisconnect: (() => void) | null = null;
  private _closePromise: Promise<void> | null = null;
  private _openPromise: Promise<Result<OpenResult, VexSerialError>> | null =
    null;
  private _isClosing = false;
  private _wasConnected = false;
  protected readonly fileTransfers = new FileTransferQueue();

  /** Pending callbacks, exposed as a snapshot for backwards compatibility. */
  get callbacksQueue(): IPacketCallback[] {
    return this.pendingRequests.callbacks;
  }

  get isConnected(): boolean {
    return (
      this.port !== undefined &&
      this.reader !== undefined &&
      this.writer !== undefined
    );
  }

  get isFileTransferring(): boolean {
    return this.fileTransfers.isActive;
  }

  constructor(serial: Serial, options: VexSerialConnectionOptions = {}) {
    super();
    this.serial = serial;
    const maxFileDownloadBytes =
      options.maxFileDownloadBytes ?? DEFAULT_MAX_FILE_DOWNLOAD_BYTES;
    if (
      !Number.isSafeInteger(maxFileDownloadBytes) ||
      maxFileDownloadBytes <= 0
    ) {
      throw new VexInvalidArgumentError(
        "maxFileDownloadBytes must be a positive safe integer",
      );
    }
    this.maxFileDownloadBytes = maxFileDownloadBytes;
  }

  protected reportWarning(message: string, details?: unknown): void {
    this.emitSafely("warning", {
      message,
      details,
    } satisfies ConnectionWarning);
  }

  /**
   * Connection events are notifications only: a consumer callback must not
   * alter the lifecycle of the serial transport that produced it.
   */
  private emitSafely<K extends keyof VexSerialConnectionEvents>(
    eventName: K,
    data: VexSerialConnectionEvents[K],
  ): void {
    try {
      this.emit(eventName, data);
    } catch {
      // Listeners are application code. Keep a throwing listener from
      // disrupting the reader loop or making a successfully opened port fail.
    }
  }

  async close(): Promise<void> {
    if (this._closePromise) return this._closePromise;

    this._isClosing = true;
    const closing = this._closeAfterOpen();
    this._closePromise = closing;
    try {
      await closing;
    } finally {
      if (this._closePromise === closing) this._closePromise = null;
      this._isClosing = false;
    }
  }

  private async _closeAfterOpen(): Promise<void> {
    // An open attempt owns partially acquired transport resources until it
    // settles. Waiting here prevents close from seeing an empty connection and
    // returning while that attempt later installs a port or stream lock.
    const opening = this._openPromise;
    if (opening !== null) await opening;
    if (!this._hasOpenResources()) return;
    await this._doClose();
  }

  private _hasOpenResources(): boolean {
    return (
      this.port !== undefined ||
      this.reader !== undefined ||
      this.writer !== undefined ||
      this._onPortDisconnect !== null ||
      this.pendingRequests.hasPending
    );
  }

  private async _doClose(): Promise<void> {
    // 1. Reject every pending callback so callers don't hang.
    for (const callback of this.pendingRequests.drain()) {
      callback.callback(AckType.NOT_CONNECTED);
    }

    // 2. Remove the port's disconnect listener so a late event doesn't
    //    re-enter close and so repeated open/close cycles don't grow
    //    listener counts.
    const onDisconnect = this._onPortDisconnect;
    this._onPortDisconnect = null;
    if (onDisconnect !== null) {
      try {
        this.port?.removeEventListener("disconnect", onDisconnect);
      } catch {
        // The port may already be gone or the implementation may not
        // support listener removal.
      }
    }

    // 3. Close the writer and release the lock. Errors are swallowed so
    //    cleanup can continue; the original error (if any) is preserved
    //    by awaiting inside try/finally rather than the catch arm.
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

    // 4. Cancel the reader, drain any remaining bytes, then release.
    const reader = this.reader;
    this.reader = undefined;
    if (reader !== undefined) {
      try {
        await reader.cancel();
      } catch {
        // The stream may already be closed or errored.
      }
      try {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
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

    // 5. Close the underlying port. Releasing both locks above means the
    //    streams are no longer holding handles, so the port can be
    //    closed without the legacy one-millisecond lock-release delay.
    const port = this.port;
    this.port = undefined;
    if (port !== undefined) {
      try {
        await port.close();
      } catch (e) {
        this.reportWarning("failed to close the serial port", e);
      }
    }

    // 6. Emit exactly one disconnected event per connected lifecycle so
    //    that observers don't have to deduplicate.
    if (this._wasConnected) {
      this._wasConnected = false;
      this.emitSafely("disconnected", undefined);
    }
  }

  /**
   * Open a port. Resolves `"opened"` when a connection is established,
   * `"busy"` when the matching port is already held elsewhere, and
   * `"no-port"` when no matching port was selected. The result is `Err`
   * when a connection is already open (programmer error) or when the
   * port fails to open (permissions, dead device, ...). Concurrent calls
   * join the same open attempt and receive its result.
   */
  open(
    use: number = 0,
    askUser: boolean = true,
  ): ResultAsync<OpenResult, VexSerialError> {
    if (this._openPromise !== null) return new ResultAsync(this._openPromise);

    const opening = this._open(use, askUser);
    this._openPromise = opening;
    void opening.then(
      () => {
        if (this._openPromise === opening) this._openPromise = null;
      },
      () => {
        if (this._openPromise === opening) this._openPromise = null;
      },
    );
    return new ResultAsync(opening);
  }

  private async _open(
    use: number,
    askUser: boolean,
  ): Promise<Result<OpenResult, VexSerialError>> {
    // Serialize behind an in-flight close so its teardown tail cannot
    // partially dismantle the connection opened here.
    if (this._closePromise !== null) await this._closePromise;

    if (this.port !== undefined) {
      return err(new VexIoError("Already connected."));
    }

    const ports = (await this.serial.getPorts())
      .filter((p) => {
        const info = p.getInfo();
        return this.filters.find(
          (f) =>
            (f.usbVendorId === undefined ||
              f.usbVendorId === info.usbVendorId) &&
            (f.usbProductId === undefined ||
              f.usbProductId === info.usbProductId),
        );
      })
      .filter((candidate) => candidate.readable === null);

    let port: SerialPort | undefined = ports[use];

    if (port == null && askUser) {
      try {
        port = await this.serial.requestPort({ filters: this.filters });
      } catch {
        // User canceled port selection or no matching port was available.
      }
    }

    if (port == null) return ok("no-port");

    if (port.readable != null) return ok("busy");

    try {
      this.port = port;
      await port.open({ baudRate: 115200 });

      this._onPortDisconnect = () => {
        void this.close();
      };
      this.port.addEventListener("disconnect", this._onPortDisconnect);

      this.writer = this.port.writable.getWriter();
      this.reader = this.port.readable.getReader();
      void this.startReader();
      this._wasConnected = true;
      this.emitSafely("connected", undefined);

      return ok("opened");
    } catch (e) {
      // Calling close() here would wait for this in-flight open attempt and
      // deadlock. A concurrent close is already waiting for this attempt, so
      // it is safe for the attempt to release the resources it acquired.
      await this._doClose();
      return err(toVexSerialError(e, "io"));
    }
  }

  async writeDataAsync(
    rawData: DeviceBoundPacket | Uint8Array,
    timeout: number = 1000,
  ): Promise<HostBoundPacket | ArrayBuffer | AckType> {
    if (rawData instanceof DeviceBoundPacket) {
      return this.pendingRequests.serialize(
        rawData.commandId,
        rawData.commandExtendedId,
        () => this.writeDataAsyncUnserialized(rawData, timeout),
      );
    }

    return this.writeDataAsyncUnserialized(rawData, timeout);
  }

  private async writeDataAsyncUnserialized(
    rawData: DeviceBoundPacket | Uint8Array,
    timeout: number,
  ): Promise<HostBoundPacket | ArrayBuffer | AckType> {
    return new Promise<HostBoundPacket | ArrayBuffer | AckType>((resolve) => {
      if (this.writer === undefined || this._isClosing) {
        resolve(AckType.NOT_CONNECTED);
        return;
      }

      const data: Uint8Array =
        rawData instanceof DeviceBoundPacket ? rawData.data : rawData;
      let removePending = (): boolean => false;
      const cb: IPacketCallback = {
        callback: resolve,
        timeout: setTimeout(() => {
          if (!removePending()) return;
          cb.callback(AckType.TIMEOUT);
        }, timeout),
        wantedCommandId:
          rawData instanceof DeviceBoundPacket ? rawData.commandId : undefined,
        wantedCommandExId:
          rawData instanceof DeviceBoundPacket
            ? rawData.commandExtendedId
            : undefined,
      };
      removePending = this.pendingRequests.add(cb);

      this.writer.write(data).catch(() => {
        if (!removePending()) return;
        clearTimeout(cb.timeout);
        resolve(AckType.WRITE_ERROR);
      });
    });
  }

  request<T extends HostBoundPacket>(
    packet: DeviceBoundPacket,
    ReplyType: HostBoundPacketType<T>,
    timeout: number = 1000,
  ): ResultAsync<T, VexSerialError> {
    return new ResultAsync(
      (async () => {
        const result = await this.writeDataAsync(packet, timeout);
        if (result instanceof ReplyType) return ok(result);
        if (result === AckType.NOT_CONNECTED) {
          return err(new VexNotConnectedError());
        }

        return err(
          new VexProtocolError(
            expectedReplyMessage(packet, ReplyType, result),
            typeof result === "number" ? result : undefined,
          ),
        );
      })(),
    );
  }

  protected async readData(
    cache: ReceiveBuffer,
    expectedSize: number,
  ): Promise<void> {
    if (this.reader == null) throw new Error("No reader");

    while (cache.byteLength < expectedSize) {
      const { value: readData, done: isDone } = await this.reader.read();

      if (isDone) throw new Error("No data");

      cache.append(readData as Uint8Array);
    }
  }

  protected async startReader(): Promise<void> {
    return runPacketReader({
      readData: (cache, expectedSize) => this.readData(cache, expectedSize),
      shiftCallback: (commandId, commandExtendedId) =>
        this.pendingRequests.shift(commandId, commandExtendedId),
      reportWarning: (message, details) => this.reportWarning(message, details),
      close: () => this.close(),
    });
  }

  query1(): ResultAsync<Query1ReplyD2HPacket, VexSerialError> {
    return this.request(new Query1H2DPacket(), Query1ReplyD2HPacket, 100);
  }

  getSystemVersion(): ResultAsync<VexFirmwareVersion, VexSerialError> {
    return this.request(
      new SystemVersionH2DPacket(),
      SystemVersionReplyD2HPacket,
    ).map((result) => result.version);
  }
}

export class V5SerialConnection extends VexSerialConnection {
  filters: SerialPortFilter[] = [
    { usbVendorId: 10376, usbProductId: SerialDeviceType.V5_BRAIN },
    { usbVendorId: 10376, usbProductId: SerialDeviceType.V5_BRAIN_DFU },
    { usbVendorId: 10376, usbProductId: SerialDeviceType.V5_CONTROLLER },
  ];

  /**
   * Serialize every transfer that touches the device's file-transfer mode
   * through a single connection-level queue. Each call returns the prior
   * tail and chains after it, so transfers always execute in request
   * order without packet interleaving.
   */
  async withFileTransfer<T>(operation: () => Promise<T>): Promise<T> {
    return this.fileTransfers.run(operation);
  }

  getDeviceStatus(): ResultAsync<
    GetDeviceStatusReplyD2HPacket,
    VexSerialError
  > {
    return this.request(
      new GetDeviceStatusH2DPacket(),
      GetDeviceStatusReplyD2HPacket,
    );
  }

  getRadioStatus(): ResultAsync<GetRadioStatusReplyD2HPacket, VexSerialError> {
    return this.request(
      new GetRadioStatusH2DPacket(),
      GetRadioStatusReplyD2HPacket,
    );
  }

  getSystemFlags(): ResultAsync<GetSystemFlagsReplyD2HPacket, VexSerialError> {
    return this.request(
      new GetSystemFlagsH2DPacket(),
      GetSystemFlagsReplyD2HPacket,
    );
  }

  getSystemStatus(
    timeout = 1000,
  ): ResultAsync<GetSystemStatusReplyD2HPacket, VexSerialError> {
    return this.request(
      new GetSystemStatusH2DPacket(),
      GetSystemStatusReplyD2HPacket,
      timeout,
    );
  }

  getMatchStatus(): ResultAsync<MatchStatusReplyD2HPacket, VexSerialError> {
    return this.request(
      new GetMatchStatusH2DPacket(),
      MatchStatusReplyD2HPacket,
    );
  }

  /**
   * Upload an entire program (INI, optional cold binary, and the user
   * binary) under a single connection-level transaction so that no other
   * file-transfer request can interleave with the multi-file write.
   */
  uploadProgramToDevice(
    iniConfig: ProgramIniConfig,
    binFileBuf: Uint8Array,
    coldFileBuf: Uint8Array | undefined,
    progressCallback: (state: string, current: number, total: number) => void,
  ): ResultAsync<boolean, VexSerialError> {
    return wrapTransfer(this, () =>
      this._uploadProgramToDevice(
        iniConfig,
        binFileBuf,
        coldFileBuf,
        progressCallback,
      ),
    );
  }

  private async _uploadProgramToDevice(
    iniConfig: ProgramIniConfig,
    binFileBuf: Uint8Array,
    coldFileBuf: Uint8Array | undefined,
    progressCallback: (state: string, current: number, total: number) => void,
  ): Promise<Result<boolean, VexSerialError>> {
    const iniFileBuffer = new TextEncoder().encode(iniConfig.createIni());

    const basename = iniConfig.baseName;

    const iniRequest = {
      filename: basename + ".ini",
      buf: iniFileBuffer,
      downloadTarget: FileDownloadTarget.FILE_TARGET_QSPI,
      vendor: FileVendor.USER,
      autoRun: false,
    };
    const r1 = await this.uploadFileToDeviceUnlocked(
      iniRequest,
      (current, total) => {
        progressCallback("INI", current, total);
      },
    );
    if (r1.isErr()) return err(r1.error);
    if (!r1.value) return ok(false);

    const coldRequest =
      coldFileBuf !== undefined
        ? {
            filename: basename + "_lib.bin",
            buf: coldFileBuf,
            downloadTarget: FileDownloadTarget.FILE_TARGET_QSPI,
            vendor: FileVendor.DEV2, // PROS vendor id
            autoRun: false,
          }
        : undefined;
    if (coldRequest != null) {
      const r2 = await this.uploadFileToDeviceUnlocked(
        coldRequest,
        (current, total) => {
          progressCallback("COLD", current, total);
        },
      );
      if (r2.isErr()) return err(r2.error);
      if (!r2.value) return ok(false);
    }

    const binRequest = {
      filename: basename + ".bin",
      buf: binFileBuf,
      downloadTarget: FileDownloadTarget.FILE_TARGET_QSPI,
      vendor: FileVendor.USER,
      loadAddress: coldFileBuf != null ? 0x07800000 : undefined,
      autoRun: iniConfig.autorun,
      linkedFile: coldRequest,
    };
    const r3 = await this.uploadFileToDeviceUnlocked(
      binRequest,
      (current, total) => {
        progressCallback("BIN", current, total);
      },
    );

    return r3;
  }

  downloadFileToHost(
    request: IFileBasicInfo,
    downloadTarget = FileDownloadTarget.FILE_TARGET_QSPI,
    progressCallback?: (current: number, total: number) => void,
  ): ResultAsync<Uint8Array, VexSerialError> {
    return wrapTransfer(this, () =>
      this.downloadFileToHostUnlocked(
        request,
        downloadTarget,
        progressCallback,
      ),
    );
  }

  /**
   * Run a download without acquiring the connection-level transfer lock.
   * Intended for callers that already hold a transaction (such as
   * `captureScreen`) and need to issue the download within a larger
   * queued operation.
   */
  downloadFileToHostUnlocked(
    request: IFileBasicInfo,
    downloadTarget: FileDownloadTarget = FileDownloadTarget.FILE_TARGET_QSPI,
    progressCallback?: (current: number, total: number) => void,
  ): ResultAsync<Uint8Array, VexSerialError> {
    return new ResultAsync(
      this._downloadFileToHostUnlocked(
        request,
        downloadTarget,
        progressCallback,
      ),
    );
  }

  private async _downloadFileToHostUnlocked(
    request: IFileBasicInfo,
    downloadTarget: FileDownloadTarget,
    progressCallback?: (current: number, total: number) => void,
  ): Promise<Result<Uint8Array, VexSerialError>> {
    const { filename, vendor, loadAddress, size } = request;

    let nextAddress = loadAddress ?? USER_FLASH_USR_CODE_START;

    const p1Result = await this.request(
      new InitFileTransferH2DPacket(
        FileInitAction.READ,
        downloadTarget,
        vendor,
        FileInitOption.NONE,
        new Uint8Array(),
        nextAddress,
        filename,
        "",
      ),
      InitFileTransferReplyD2HPacket,
    );

    if (p1Result.isErr()) return err(p1Result.error);

    let transferFailed = true;
    let result: Result<Uint8Array, VexSerialError> = ok(new Uint8Array());
    try {
      const p1 = p1Result.value;
      const fileSize = size ?? p1.fileSize;
      if (!Number.isSafeInteger(fileSize) || fileSize < 0) {
        throw new VexTransferError(
          `file download size ${fileSize} is not a non-negative safe integer`,
        );
      }
      if (fileSize > this.maxFileDownloadBytes) {
        throw new VexTransferError(
          `file download size ${fileSize} exceeds download limit ${this.maxFileDownloadBytes}`,
        );
      }
      const bufferChunkSize = getTransferChunkSize(p1.windowSize);
      let bufferOffset = 0;
      const fileBuf = new Uint8Array(fileSize);

      while (bufferOffset < fileSize) {
        const remainingSize = fileSize - bufferOffset;
        const chunkSize = Math.min(bufferChunkSize, remainingSize);
        const requestedSize = (chunkSize + 3) & ~3;
        const p2Result = await this.request(
          new ReadFileH2DPacket(nextAddress, requestedSize),
          ReadFileReplyD2HPacket,
          3000,
        );

        if (p2Result.isErr()) throw p2Result.error;
        const p2 = p2Result.value;
        if (p2.addr !== nextAddress) {
          throw new VexTransferError(
            `ReadFileReplyD2HPacket returned address ${p2.addr}, expected ${nextAddress}`,
          );
        }
        if (
          p2.length <= 0 ||
          p2.length > requestedSize ||
          p2.buf.byteLength !== p2.length
        ) {
          throw new VexTransferError(
            `ReadFileReplyD2HPacket returned invalid length ${p2.length}`,
          );
        }

        const receivedSize = Math.min(p2.length, remainingSize);
        fileBuf.set(p2.buf.subarray(0, receivedSize), bufferOffset);
        bufferOffset += receivedSize;
        nextAddress += receivedSize;
        progressCallback?.(bufferOffset, fileSize);
      }

      transferFailed = false;
      result = ok(fileBuf);
    } catch (e) {
      result = err(
        e instanceof VexSerialError ? e : toVexSerialError(e, "transfer"),
      );
    } finally {
      // Always exit file-transfer mode even if reading or writing the
      // reply throws. If the original transfer also failed we keep its
      // error so callers see the underlying cause, not the cleanup
      // failure.
      try {
        const exitResult = await this.request(
          new ExitFileTransferH2DPacket(FileExitAction.EXIT_HALT),
          ExitFileTransferReplyD2HPacket,
          30000,
        );
        if (!transferFailed && exitResult.isErr())
          result = err(exitResult.error);
      } catch (e) {
        if (!transferFailed) result = err(toVexSerialError(e, "io"));
      }
    }
    return result;
  }

  uploadFileToDevice(
    request: IFileWriteRequest,
    progressCallback?: (current: number, total: number) => void,
  ): ResultAsync<boolean, VexSerialError> {
    return wrapTransfer(this, () =>
      this.uploadFileToDeviceUnlocked(request, progressCallback),
    );
  }

  async uploadFileToDeviceUnlocked(
    request: IFileWriteRequest,
    progressCallback?: (current: number, total: number) => void,
  ): Promise<Result<boolean, VexSerialError>> {
    let {
      filename,
      buf,
      downloadTarget,
      vendor,
      loadAddress,
      exttype,
      autoRun,
      linkedFile,
    } = request;

    if (buf === undefined) {
      return err(new VexTransferError("no buffer provided for upload"));
    }

    downloadTarget = downloadTarget ?? FileDownloadTarget.FILE_TARGET_QSPI;
    vendor = vendor ?? FileVendor.USER;

    let nextAddress = loadAddress ?? USER_FLASH_USR_CODE_START;

    const p1Result = await this.request(
      new InitFileTransferH2DPacket(
        FileInitAction.WRITE,
        downloadTarget,
        vendor,
        FileInitOption.OVERWRITE,
        buf,
        nextAddress,
        filename,
        exttype,
      ),
      InitFileTransferReplyD2HPacket,
    );

    if (p1Result.isErr()) return err(p1Result.error);

    const p1 = p1Result.value;
    const bufferChunkSize = getTransferChunkSize(p1.windowSize);
    let bufferOffset = 0;

    let lastBlock = false;

    let transferFailed = true;
    let result: Result<boolean, VexSerialError> = ok(false);

    try {
      if (linkedFile !== undefined) {
        const p3Result = await this.request(
          new LinkFileH2DPacket(
            linkedFile.vendor ?? FileVendor.USER,
            linkedFile.filename,
            0,
          ),
          LinkFileReplyD2HPacket,
          10000,
        );

        if (p3Result.isErr()) throw p3Result.error;
      }

      while (!lastBlock) {
        let tmpbuf;
        if (buf.byteLength - bufferOffset > bufferChunkSize) {
          tmpbuf = buf.subarray(bufferOffset, bufferOffset + bufferChunkSize);
        } else {
          // last chunk
          // word align length
          const length = ((buf.byteLength - bufferOffset + 3) / 4) >>> 0;
          tmpbuf = new Uint8Array(length * 4);
          tmpbuf.set(buf.subarray(bufferOffset, buf.byteLength));
          lastBlock = true;
        }

        const p2Result = await this.request(
          new WriteFileH2DPacket(nextAddress, tmpbuf),
          WriteFileReplyD2HPacket,
          3000,
        );

        if (p2Result.isErr()) throw p2Result.error;

        // next chunk
        bufferOffset += bufferChunkSize;
        nextAddress += bufferChunkSize;

        progressCallback?.(
          Math.min(bufferOffset, buf.byteLength),
          buf.byteLength,
        );
      }

      transferFailed = false;
    } catch (e) {
      result = err(
        e instanceof VexSerialError ? e : toVexSerialError(e, "transfer"),
      );
    } finally {
      // Always exit file-transfer mode even if writing or cleanup throws.
      // If the original transfer failed, keep its error so callers see
      // the root cause rather than the cleanup failure.
      try {
        const exitResult = await this.request(
          new ExitFileTransferH2DPacket(
            transferFailed
              ? FileExitAction.EXIT_HALT
              : autoRun
                ? FileExitAction.EXIT_RUN
                : FileExitAction.EXIT_HALT,
          ),
          ExitFileTransferReplyD2HPacket,
          30000,
        );
        if (!transferFailed) {
          result = exitResult.map(() => true);
        }
      } catch (cleanupError) {
        if (!transferFailed) {
          result = err(toVexSerialError(cleanupError, "io"));
        }
      }
    }
    return result;
  }

  /**
   * Erase a single file under a single transfer-mode session, exiting
   * file-transfer mode in a `finally` block regardless of how the
   * operation completes.
   */
  removeFile(
    request: IFileBasicInfo | string,
  ): ResultAsync<void, VexSerialError> {
    return new ResultAsync(
      this.withFileTransfer(async () => {
        let vendor: FileVendor, filename: string;
        if (typeof request === "string") {
          vendor = FileVendor.USER;
          filename = request;
        } else {
          vendor = request.vendor;
          filename = request.filename;
        }

        let result: Result<void, VexSerialError>;
        try {
          const eraseResult = await this.request(
            new EraseFileH2DPacket(vendor, filename),
            EraseFileReplyD2HPacket,
          );
          result = eraseResult.map(() => undefined);
        } catch (e) {
          result = err(toVexSerialError(e, "io"));
        }
        // Always exit file-transfer mode; a failed exit only overrides
        // the result when the erase itself succeeded, so callers see
        // the root cause rather than the cleanup failure.
        try {
          const exitResult = await this.request(
            new ExitFileTransferH2DPacket(FileExitAction.EXIT_HALT),
            ExitFileTransferReplyD2HPacket,
            30000,
          );
          if (result.isOk() && exitResult.isErr())
            result = err(exitResult.error);
        } catch (e) {
          if (result.isOk()) result = err(toVexSerialError(e, "io"));
        }
        return result;
      }),
    );
  }

  /**
   * Erase every file in the user vendor namespace under a single
   * transfer-mode session.
   */
  removeAllFiles(): ResultAsync<void, VexSerialError> {
    return new ResultAsync(
      this.withFileTransfer(async () => {
        let result: Result<void, VexSerialError>;
        try {
          const clearResult = await this.request(
            new FileClearUpH2DPacket(FileVendor.USER),
            FileClearUpReplyD2HPacket,
            30000,
          );
          result = clearResult.map(() => undefined);
        } catch (e) {
          result = err(toVexSerialError(e, "io"));
        }
        // Always exit file-transfer mode; a failed exit only overrides
        // the result when the clear itself succeeded, so callers see
        // the root cause rather than the cleanup failure.
        try {
          const exitResult = await this.request(
            new ExitFileTransferH2DPacket(FileExitAction.EXIT_HALT),
            ExitFileTransferReplyD2HPacket,
            30000,
          );
          if (result.isOk() && exitResult.isErr())
            result = err(exitResult.error);
        } catch (e) {
          if (result.isOk()) result = err(toVexSerialError(e, "io"));
        }
        return result;
      }),
    );
  }

  /**
   * Issue the screen-capture command and validate that the device
   * acknowledged it. Callers must inspect the returned packet (or the
   * error result on NACK) before downloading the framebuffer so that a
   * rejected request performs no download.
   */
  captureScreenSetup(): ResultAsync<
    ScreenCaptureReplyD2HPacket,
    VexSerialError
  > {
    return this.request(
      new ScreenCaptureH2DPacket(0),
      ScreenCaptureReplyD2HPacket,
    );
  }

  captureScreen(
    progressCallback?: (current: number, total: number) => void,
  ): ResultAsync<Uint8Array, VexSerialError> {
    return wrapTransfer(this, () => this._captureScreen(progressCallback));
  }

  private async _captureScreen(
    progressCallback?: (current: number, total: number) => void,
  ): Promise<Result<Uint8Array, VexSerialError>> {
    const response = await this.captureScreenSetup();
    if (response.isErr()) {
      return err(response.error);
    }

    const framebuffer = await this.downloadFileToHostUnlocked(
      {
        filename: "screen",
        vendor: FileVendor.SYS,
        loadAddress: 0,
        size: SCREEN_CAPTURE_FRAMEBUFFER_SIZE,
      },
      FileDownloadTarget.FILE_TARGET_CBUF,
      progressCallback,
    );
    if (framebuffer.isErr()) return err(framebuffer.error);

    return ok(convertScreenCapture(framebuffer.value));
  }

  setMatchMode(
    mode: MatchMode,
  ): ResultAsync<MatchModeReplyD2HPacket, VexSerialError> {
    return this.request(
      new UpdateMatchModeH2DPacket(mode, 0),
      MatchModeReplyD2HPacket,
    );
  }

  runProgram(
    value: SlotNumber | string,
  ): ResultAsync<LoadFileActionReplyD2HPacket, VexSerialError> {
    return this.loadProgram(value);
  }

  loadProgram(
    value: SlotNumber | string,
  ): ResultAsync<LoadFileActionReplyD2HPacket, VexSerialError> {
    return this.request(
      new LoadFileActionH2DPacket(FileVendor.USER, FileLoadAction.RUN, value),
      LoadFileActionReplyD2HPacket,
    );
  }

  stopProgram(): ResultAsync<LoadFileActionReplyD2HPacket, VexSerialError> {
    return this.request(
      new LoadFileActionH2DPacket(FileVendor.USER, FileLoadAction.STOP, ""),
      LoadFileActionReplyD2HPacket,
    );
  }

  mockTouch(
    x: number,
    y: number,
    press: boolean,
  ): ResultAsync<SendDashTouchReplyD2HPacket, VexSerialError> {
    return this.request(
      new SendDashTouchH2DPacket(x, y, press),
      SendDashTouchReplyD2HPacket,
    );
  }

  openScreen(
    screen: number | SelectDashScreen,
    port: number,
  ): ResultAsync<SelectDashReplyD2HPacket, VexSerialError> {
    return this.request(
      new SelectDashH2DPacket(screen, port),
      SelectDashReplyD2HPacket,
    );
  }
}

function getTransferChunkSize(windowSize: number): number {
  return windowSize > 0 && windowSize <= USER_PROG_CHUNK_SIZE
    ? windowSize
    : USER_PROG_CHUNK_SIZE;
}

/**
 * Run an operation inside the per-connection transfer queue and lift its
 * `Promise<Result<T, VexSerialError>>` into a `ResultAsync`. Throwables
 * escaping `withFileTransfer` are coerced into a {@link VexSerialError}.
 */
function wrapTransfer<T>(
  conn: V5SerialConnection,
  operation: () =>
    | Promise<Result<T, VexSerialError>>
    | ResultAsync<T, VexSerialError>,
): ResultAsync<T, VexSerialError> {
  return new ResultAsync(
    conn.withFileTransfer<Result<T, VexSerialError>>(async () => {
      try {
        return (await operation()) as Result<T, VexSerialError>;
      } catch (e) {
        if (e instanceof VexSerialError) return err(e);
        return err(toVexSerialError(e, "io"));
      }
    }),
  );
}

function expectedReplyMessage<T extends HostBoundPacket>(
  packet: DeviceBoundPacket,
  ReplyType: HostBoundPacketType<T>,
  reply: HostBoundPacket | ArrayBuffer | AckType,
): string {
  const expected = `expected ${ReplyType.name} for ${packet.constructor.name}`;
  if (typeof reply === "number")
    return `${expected}; received ${ackTypeName(reply)}`;
  if (reply instanceof ArrayBuffer)
    return `${expected}; received raw ArrayBuffer`;
  return `${expected}; received ${reply.constructor.name}`;
}

function ackTypeName(ackType: AckType): string {
  return `AckType.${AckType[ackType] ?? "UNKNOWN"} (${ackType})`;
}
