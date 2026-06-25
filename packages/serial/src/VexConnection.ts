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
import { VexEventTarget } from "./VexEvent.js";
import { type ProgramIniConfig } from "./VexIniConfig.js";
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
  PacketEncoder,
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

const thePacketEncoder = PacketEncoder.getInstance();
const SCREEN_CAPTURE_HEIGHT = 272;
const SCREEN_CAPTURE_WIDTH = 480;
const SCREEN_CAPTURE_CHANNELS = 3;
const SCREEN_CAPTURE_MESSAGE_WIDTH = 512;
const SCREEN_CAPTURE_MESSAGE_CHANNELS = 4;

/**
 * A connection to a V5 device.
 * Emit events: connected, disconnected
 */
export class VexSerialConnection extends VexEventTarget {
  filters: SerialPortFilter[] = [{ usbVendorId: 10376 }];

  writer: WritableStreamDefaultWriter<unknown> | undefined;
  reader: ReadableStreamDefaultReader<unknown> | undefined;
  port: SerialPort | undefined;
  serial: Serial;

  callbacksQueue: IPacketCallback[] = [];
  private _onPortDisconnect: (() => void) | null = null;
  private _closePromise: Promise<void> | null = null;
  private _wasConnected = false;
  protected fileTransferTail: Promise<unknown> = Promise.resolve();
  protected fileTransferDepth = 0;

  get isConnected(): boolean {
    return (
      this.port !== undefined &&
      this.reader !== undefined &&
      this.writer !== undefined
    );
  }

  get isFileTransferring(): boolean {
    return this.fileTransferDepth > 0;
  }

  constructor(serial: Serial) {
    super();
    this.serial = serial;
  }

  async close(): Promise<void> {
    if (this._closePromise) return this._closePromise;
    if (!this._hasOpenResources()) return;

    this._closePromise = this._doClose();
    try {
      await this._closePromise;
    } finally {
      this._closePromise = null;
    }
  }

  private _hasOpenResources(): boolean {
    return (
      this.port !== undefined ||
      this.reader !== undefined ||
      this.writer !== undefined ||
      this._onPortDisconnect !== null ||
      this.callbacksQueue.length > 0
    );
  }

  private async _doClose(): Promise<void> {
    // 1. Reject every pending callback so callers don't hang.
    for (const callback of this.callbacksQueue.splice(0)) {
      clearTimeout(callback.timeout);
      callback.callback(AckType.CDC2_NACK);
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
        console.warn("Close port error.", e);
      }
    }

    // 6. Emit exactly one disconnected event per connected lifecycle so
    //    that observers don't have to deduplicate.
    if (this._wasConnected) {
      this._wasConnected = false;
      this.emit("disconnected", undefined);
    }
  }

  async open(
    use: number | undefined = 0,
    askUser: boolean = true,
  ): Promise<boolean | undefined> {
    if (this.port !== undefined) throw new Error("Already connected.");

    let port: SerialPort | undefined;

    if (use !== undefined) {
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

      port = ports[use];
    }

    if (port == null && askUser) {
      try {
        port = await this.serial.requestPort({ filters: this.filters });
      } catch {
        // User canceled port selection or no matching port was available.
      }
    }

    if (port == null) return undefined;

    if (port.readable != null) return false;

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
      this.emit("connected", undefined);

      return true;
    } catch {
      await this.close();
      return false;
    }
  }

  writeData(
    rawData: DeviceBoundPacket | Uint8Array,
    resolve: (data: HostBoundPacket | ArrayBuffer | AckType) => void,
    timeout: number = 1000,
  ): void {
    void this.writeDataAsync(rawData, timeout).then(resolve);
  }

  async writeDataAsync(
    rawData: DeviceBoundPacket | Uint8Array,
    timeout: number = 1000,
  ): Promise<HostBoundPacket | ArrayBuffer | AckType> {
    return new Promise<HostBoundPacket | ArrayBuffer | AckType>((resolve) => {
      if (this.writer === undefined) {
        resolve(AckType.CDC2_NACK);
        return;
      }

      const data: Uint8Array =
        rawData instanceof DeviceBoundPacket ? rawData.data : rawData;
      const cb = {
        callback: resolve,
        timeout: setTimeout(() => {
          const index = this.callbacksQueue.indexOf(cb);
          if (index === -1) return;
          this.callbacksQueue.splice(index, 1);
          cb.callback(AckType.TIMEOUT);
        }, timeout),
        wantedCommandId:
          rawData instanceof DeviceBoundPacket ? rawData.commandId : undefined,
        wantedCommandExId:
          rawData instanceof DeviceBoundPacket
            ? rawData.commandExtendedId
            : undefined,
      };
      this.callbacksQueue.push(cb);

      this.writer.write(data).catch(() => {
        const index = this.callbacksQueue.indexOf(cb);
        if (index === -1) return;
        this.callbacksQueue.splice(index, 1);
        clearTimeout(cb.timeout);
        resolve(AckType.WRITE_ERROR);
      });
    });
  }

  protected async readData(
    cache: Uint8Array,
    expectedSize: number,
  ): Promise<Uint8Array> {
    if (this.reader == null) throw new Error("No reader");

    while (cache.byteLength < expectedSize) {
      const { value: readData, done: isDone } = await this.reader.read();

      if (isDone) throw new Error("No data");

      cache = binaryArrayJoin(cache, readData as Uint8Array);
    }

    return cache;
  }

  protected async startReader(): Promise<void> {
    let cache: Uint8Array = new Uint8Array([]);
    let sliceIdx = 0;
    for (;;)
      try {
        cache = await this.readData(cache, 5);
        sliceIdx = 0;

        while (!thePacketEncoder.validateHeader(cache)) {
          const nextHeader = cache.findIndex(
            (byte, index) =>
              index > 0 &&
              byte === PacketEncoder.HEADER_TO_HOST[0] &&
              cache[index + 1] === PacketEncoder.HEADER_TO_HOST[1],
          );
          if (nextHeader >= 0) {
            cache = cache.slice(nextHeader);
          } else {
            cache = cache.slice(
              cache.at(-1) === PacketEncoder.HEADER_TO_HOST[0]
                ? -1
                : cache.length,
            );
          }
          cache = await this.readData(cache, 5);
        }

        const payloadExpectedSize = thePacketEncoder.getPayloadSize(cache);
        const n = thePacketEncoder.getHostHeaderLength(cache);
        const totalSize = n + payloadExpectedSize;

        cache = await this.readData(cache, totalSize);
        sliceIdx = totalSize;

        const cmdId = cache[2];
        const hasExtId = cmdId === 88 || cmdId === 86;
        const cmdExId = hasExtId ? cache[n] : undefined;

        const ack = cache[n + 1];

        if (hasExtId) {
          if (!thePacketEncoder.validateMessageCdc(cache))
            throw new Error("Invalid message CDC");
        }

        let callbackInfo: IPacketCallback | undefined;
        let wantedCmdId: number | undefined;
        let wantedCmdExId: number | undefined;
        let tryIdx = 0;
        while ((callbackInfo = this.callbacksQueue[tryIdx++]) !== undefined) {
          wantedCmdId = callbackInfo?.wantedCommandId;
          wantedCmdExId = callbackInfo?.wantedCommandExId;

          if (
            (wantedCmdId !== undefined && wantedCmdId !== cmdId) ||
            (wantedCmdExId !== undefined && wantedCmdExId !== cmdExId)
          ) {
            continue;
          }
          break;
        }

        if (callbackInfo === undefined) {
          console.warn("Unexpected command", cmdId, cmdExId, ack);
          continue;
        }

        const data = cache.slice(0, sliceIdx);
        const PackageType =
          thePacketEncoder.allPacketsTable[wantedCmdId + " " + wantedCmdExId];
        if (
          (wantedCmdId === undefined && wantedCmdExId === undefined) ||
          PackageType === undefined
        ) {
          callbackInfo.callback(
            data.buffer.slice(
              data.byteOffset,
              data.byteOffset + data.byteLength,
            ),
          );
        } else {
          if (!hasExtId || PackageType.isValidPacket(data, n)) {
            callbackInfo.callback(new PackageType(data));
          } else {
            console.warn("ack", ack);

            callbackInfo.callback(ack!);
          }
        }

        clearTimeout(callbackInfo.timeout);

        this.callbacksQueue.splice(tryIdx - 1, 1);
      } catch (e) {
        if (!(e instanceof Error && e.message === "No data")) {
          console.warn("Read error.", e, cache);
        }

        await this.close();
        break;
      } finally {
        cache = cache.slice(sliceIdx);
      }
  }

  async query1(): Promise<Query1ReplyD2HPacket | null> {
    const result = await this.writeDataAsync(new Query1H2DPacket(), 100);
    return result instanceof Query1ReplyD2HPacket ? result : null;
  }

  async getSystemVersion(): Promise<VexFirmwareVersion | null> {
    const result = await this.writeDataAsync(new SystemVersionH2DPacket());
    return result instanceof SystemVersionReplyD2HPacket
      ? result.version
      : null;
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
  protected async withFileTransfer<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.fileTransferTail;
    let release = (): void => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.fileTransferTail = previous.then(() => current);
    this.fileTransferDepth++;
    try {
      await previous;
      return await operation();
    } finally {
      this.fileTransferDepth--;
      release();
    }
  }

  async getDeviceStatus(): Promise<GetDeviceStatusReplyD2HPacket | null> {
    const result = await this.writeDataAsync(new GetDeviceStatusH2DPacket());
    return result instanceof GetDeviceStatusReplyD2HPacket ? result : null;
  }

  async getRadioStatus(): Promise<GetRadioStatusReplyD2HPacket | null> {
    const result = await this.writeDataAsync(new GetRadioStatusH2DPacket());
    return result instanceof GetRadioStatusReplyD2HPacket ? result : null;
  }

  async getSystemFlags(): Promise<GetSystemFlagsReplyD2HPacket | null> {
    const result = await this.writeDataAsync(new GetSystemFlagsH2DPacket());
    return result instanceof GetSystemFlagsReplyD2HPacket ? result : null;
  }

  async getSystemStatus(
    timeout = 1000,
  ): Promise<GetSystemStatusReplyD2HPacket | null> {
    const result = await this.writeDataAsync(
      new GetSystemStatusH2DPacket(),
      timeout,
    );
    return result instanceof GetSystemStatusReplyD2HPacket ? result : null;
  }

  async getMatchStatus(): Promise<MatchStatusReplyD2HPacket | null> {
    const result = await this.writeDataAsync(new GetMatchStatusH2DPacket());
    return result instanceof MatchStatusReplyD2HPacket ? result : null;
  }

  /**
   * Upload an entire program (INI, optional cold binary, and the user
   * binary) under a single connection-level transaction so that no other
   * file-transfer request can interleave with the multi-file write.
   */
  async uploadProgramToDevice(
    iniConfig: ProgramIniConfig,
    binFileBuf: Uint8Array,
    coldFileBuf: Uint8Array | undefined,
    progressCallback: (state: string, current: number, total: number) => void,
  ): Promise<boolean | undefined> {
    return this.withFileTransfer(async () => {
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
      if (!r1) return false;

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
        if (!r2) return;
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
    });
  }

  async downloadFileToHost(
    request: IFileBasicInfo,
    downloadTarget = FileDownloadTarget.FILE_TARGET_QSPI,
    progressCallback?: (current: number, total: number) => void,
  ): Promise<Uint8Array> {
    return this.withFileTransfer(() =>
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
  async downloadFileToHostUnlocked(
    request: IFileBasicInfo,
    downloadTarget: FileDownloadTarget = FileDownloadTarget.FILE_TARGET_QSPI,
    progressCallback?: (current: number, total: number) => void,
  ): Promise<Uint8Array> {
    const { filename, vendor, loadAddress, size } = request;

    let nextAddress = loadAddress ?? USER_FLASH_USR_CODE_START;

    const p1 = await this.writeDataAsync(
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
    );

    if (!(p1 instanceof InitFileTransferReplyD2HPacket))
      throw new Error("InitFileTransferH2DPacket failed");

    let transferFailed = true;

    try {
      const fileSize = size ?? p1.fileSize;
      const bufferChunkSize = getTransferChunkSize(p1.windowSize);
      let bufferOffset = 0;
      const fileBuf = new Uint8Array(fileSize);

      while (bufferOffset < fileSize) {
        const requestedSize = Math.min(
          bufferChunkSize,
          fileSize - bufferOffset,
        );
        const p2 = await this.writeDataAsync(
          new ReadFileH2DPacket(nextAddress, requestedSize),
          3000,
        );

        if (!(p2 instanceof ReadFileReplyD2HPacket)) {
          throw new Error("ReadFileReplyD2HPacket failed");
        }
        if (p2.addr !== nextAddress) {
          throw new Error(
            `ReadFileReplyD2HPacket returned address ${p2.addr}, expected ${nextAddress}`,
          );
        }
        if (
          p2.length <= 0 ||
          p2.length > requestedSize ||
          p2.buf.byteLength !== p2.length
        ) {
          throw new Error(
            `ReadFileReplyD2HPacket returned invalid length ${p2.length}`,
          );
        }

        fileBuf.set(new Uint8Array(p2.buf), bufferOffset);
        bufferOffset += p2.length;
        nextAddress += p2.length;
        progressCallback?.(bufferOffset, fileSize);
      }

      transferFailed = false;
      return fileBuf;
    } finally {
      // Always exit file-transfer mode even if reading or writing the
      // reply throws. If the original transfer also failed we keep its
      // error so callers see the underlying cause, not the cleanup
      // failure.
      try {
        await this.writeDataAsync(
          new ExitFileTransferH2DPacket(FileExitAction.EXIT_HALT),
          30000,
        );
      } catch (cleanupError) {
        if (!transferFailed) throw cleanupError;
      }
    }
  }

  async uploadFileToDevice(
    request: IFileWriteRequest,
    progressCallback?: (current: number, total: number) => void,
  ): Promise<boolean> {
    return this.withFileTransfer(() =>
      this.uploadFileToDeviceUnlocked(request, progressCallback),
    );
  }

  private async uploadFileToDeviceUnlocked(
    request: IFileWriteRequest,
    progressCallback?: (current: number, total: number) => void,
  ): Promise<boolean> {
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
      return false;
    }

    downloadTarget = downloadTarget ?? FileDownloadTarget.FILE_TARGET_QSPI;
    vendor = vendor ?? FileVendor.USER;

    let nextAddress = loadAddress ?? USER_FLASH_USR_CODE_START;

    const p1 = await this.writeDataAsync(
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
    );

    if (!(p1 instanceof InitFileTransferReplyD2HPacket))
      throw new Error("InitFileTransferH2DPacket failed");

    const bufferChunkSize = getTransferChunkSize(p1.windowSize);
    let bufferOffset = 0;

    let lastBlock = false;

    let transferFailed = true;
    let exitReply: HostBoundPacket | ArrayBuffer | AckType | undefined;

    try {
      if (linkedFile !== undefined) {
        const p3 = await this.writeDataAsync(
          new LinkFileH2DPacket(
            linkedFile.vendor ?? FileVendor.USER,
            linkedFile.filename,
            0,
          ),
          10000,
        );

        if (!(p3 instanceof LinkFileReplyD2HPacket)) {
          throw new Error("LinkFileH2DPacket failed");
        }
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

        const p2 = await this.writeDataAsync(
          new WriteFileH2DPacket(nextAddress, tmpbuf),
          3000,
        );

        if (!(p2 instanceof WriteFileReplyD2HPacket))
          throw new Error("WriteFileReplyD2DPacket failed");

        if (progressCallback != null)
          progressCallback(bufferOffset, buf.byteLength);

        // next chunk
        bufferOffset += bufferChunkSize;
        nextAddress += bufferChunkSize;
      }

      progressCallback?.(buf.byteLength, buf.byteLength);
      transferFailed = false;
    } finally {
      // Always exit file-transfer mode even if writing or cleanup throws.
      // If the original transfer failed, keep its error so callers see
      // the root cause rather than the cleanup failure.
      try {
        exitReply = await this.writeDataAsync(
          new ExitFileTransferH2DPacket(
            transferFailed
              ? FileExitAction.EXIT_HALT
              : autoRun
                ? FileExitAction.EXIT_RUN
                : FileExitAction.EXIT_HALT,
          ),
          30000,
        );
      } catch (cleanupError) {
        if (!transferFailed) throw cleanupError;
        // Swallow the cleanup error so the original transfer error
        // propagates to the caller.
      }
    }

    return (
      exitReply !== undefined &&
      exitReply instanceof ExitFileTransferReplyD2HPacket
    );
  }

  /**
   * Erase a single file under a single transfer-mode session, exiting
   * file-transfer mode in a `finally` block regardless of how the
   * operation completes.
   */
  async removeFile(request: IFileBasicInfo | string): Promise<boolean> {
    return this.withFileTransfer(async () => {
      let vendor: FileVendor, filename: string;
      if (typeof request === "string") {
        vendor = FileVendor.USER;
        filename = request;
      } else {
        vendor = request.vendor;
        filename = request.filename;
      }

      try {
        const result = await this.writeDataAsync(
          new EraseFileH2DPacket(vendor, filename),
        );
        if (!(result instanceof EraseFileReplyD2HPacket)) return false;
        return true;
      } finally {
        try {
          await this.writeDataAsync(
            new ExitFileTransferH2DPacket(FileExitAction.EXIT_HALT),
          );
        } catch {
          // Preserve the original error.
        }
      }
    });
  }

  /**
   * Erase every file in the user vendor namespace under a single
   * transfer-mode session.
   */
  async removeAllFiles(): Promise<boolean> {
    return this.withFileTransfer(async () => {
      try {
        const result = await this.writeDataAsync(
          new FileClearUpH2DPacket(FileVendor.USER),
          30000,
        );
        return result instanceof FileClearUpReplyD2HPacket;
      } finally {
        try {
          await this.writeDataAsync(
            new ExitFileTransferH2DPacket(FileExitAction.EXIT_HALT),
          );
        } catch {
          // Preserve the original error.
        }
      }
    });
  }

  /**
   * Issue the screen-capture command and validate that the device
   * acknowledged it. Callers must inspect the returned packet (or
   * `null` on NACK) before downloading the framebuffer so that a
   * rejected request performs no download.
   */
  async captureScreenSetup(): Promise<ScreenCaptureReplyD2HPacket | null> {
    const result = await this.writeDataAsync(new ScreenCaptureH2DPacket(0));
    return result instanceof ScreenCaptureReplyD2HPacket ? result : null;
  }

  async captureScreen(
    progressCallback?: (current: number, total: number) => void,
  ): Promise<Uint8Array> {
    return this.withFileTransfer(async () => {
      const response = await this.captureScreenSetup();
      if (response === null) {
        throw new Error("screen capture request was rejected");
      }

      const framebuffer = await this.downloadFileToHostUnlocked(
        {
          filename: "screen",
          vendor: FileVendor.SYS,
          loadAddress: 0,
          size:
            SCREEN_CAPTURE_MESSAGE_WIDTH *
            SCREEN_CAPTURE_HEIGHT *
            SCREEN_CAPTURE_MESSAGE_CHANNELS,
        },
        FileDownloadTarget.FILE_TARGET_CBUF,
        progressCallback,
      );

      return convertScreenCapture(framebuffer);
    });
  }

  async setMatchMode(mode: MatchMode): Promise<MatchModeReplyD2HPacket | null> {
    const result = await this.writeDataAsync(
      new UpdateMatchModeH2DPacket(mode, 0),
    );
    return result instanceof MatchModeReplyD2HPacket ? result : null;
  }

  async runProgram(
    value: SlotNumber | string,
  ): Promise<LoadFileActionReplyD2HPacket | null> {
    return this.loadProgram(value);
  }

  async loadProgram(
    value: SlotNumber | string,
  ): Promise<LoadFileActionReplyD2HPacket | null> {
    const result = await this.writeDataAsync(
      new LoadFileActionH2DPacket(FileVendor.USER, FileLoadAction.RUN, value),
    );
    return result instanceof LoadFileActionReplyD2HPacket ? result : null;
  }

  async stopProgram(): Promise<LoadFileActionReplyD2HPacket | null> {
    const result = await this.writeDataAsync(
      new LoadFileActionH2DPacket(FileVendor.USER, FileLoadAction.STOP, ""),
    );
    return result instanceof LoadFileActionReplyD2HPacket ? result : null;
  }

  async mockTouch(
    x: number,
    y: number,
    press: boolean,
  ): Promise<SendDashTouchReplyD2HPacket | null> {
    const result = await this.writeDataAsync(
      new SendDashTouchH2DPacket(x, y, press),
    );
    return result instanceof SendDashTouchReplyD2HPacket ? result : null;
  }

  async openScreen(
    screen: number | SelectDashScreen,
    port: number,
  ): Promise<SelectDashReplyD2HPacket | null> {
    const result = await this.writeDataAsync(
      new SelectDashH2DPacket(screen, port),
    );
    return result instanceof SelectDashReplyD2HPacket ? result : null;
  }
}

function binaryArrayJoin(
  left: Uint8Array | ArrayBuffer | null,
  right: Uint8Array | ArrayBuffer | null,
): Uint8Array {
  const leftSize = left != null ? left.byteLength : 0;
  const rightSize = right != null ? right.byteLength : 0;
  const all = new Uint8Array(leftSize + rightSize);
  if (all.length === 0) return new Uint8Array();
  if (left != null) all.set(new Uint8Array(left), 0);
  if (right != null) all.set(new Uint8Array(right), leftSize);
  return all;
}

function getTransferChunkSize(windowSize: number): number {
  return windowSize > 0 && windowSize <= USER_PROG_CHUNK_SIZE
    ? windowSize
    : USER_PROG_CHUNK_SIZE;
}

function convertScreenCapture(framebuffer: Uint8Array): Uint8Array {
  const pixels = new Uint8Array(
    SCREEN_CAPTURE_WIDTH * SCREEN_CAPTURE_HEIGHT * SCREEN_CAPTURE_CHANNELS,
  );

  for (let row = 0; row < SCREEN_CAPTURE_HEIGHT; row++) {
    for (let column = 0; column < SCREEN_CAPTURE_WIDTH; column++) {
      const source =
        (row * SCREEN_CAPTURE_MESSAGE_WIDTH + column) *
        SCREEN_CAPTURE_MESSAGE_CHANNELS;
      const target =
        (row * SCREEN_CAPTURE_WIDTH + column) * SCREEN_CAPTURE_CHANNELS;

      pixels[target] = framebuffer[source + 2] ?? 0;
      pixels[target + 1] = framebuffer[source + 1] ?? 0;
      pixels[target + 2] = framebuffer[source] ?? 0;
    }
  }

  return pixels;
}
