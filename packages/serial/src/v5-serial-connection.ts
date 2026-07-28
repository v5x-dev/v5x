import {
  FileDownloadTarget,
  FileExitAction,
  FileInitAction,
  FileInitOption,
  FileLoadAction,
  FileVendor,
  type IFileBasicInfo,
  type IFileWriteRequest,
  type MatchMode,
  SerialDeviceType,
  type SlotNumber,
  USER_FIFO_MAX_WRITE_SIZE,
  USER_FLASH_USR_CODE_START,
  USER_PROG_CHUNK_SIZE,
  UserFifoChannel,
  type SelectDashScreen,
} from "./vex.js";
import { VexSerialError, VexTransferError, toVexSerialError } from "./error.js";
import { type ProgramIniConfig } from "./ini-config.js";
import { err, ok, Result, ResultAsync } from "neverthrow";
import {
  MatchStatusReplyD2HPacket,
  GetMatchStatusH2DPacket,
  UpdateMatchModeH2DPacket,
  MatchModeReplyD2HPacket,
  GetSystemStatusReplyD2HPacket,
  GetSystemStatusH2DPacket,
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
  UserFifoH2DPacket,
  UserFifoReplyD2HPacket,
} from "./packet.js";
import {
  convertScreenCapture,
  SCREEN_CAPTURE_FRAMEBUFFER_SIZE,
} from "./screen-capture.js";
import {
  DEFAULT_USER_FIFO_TIMEOUT,
  VexSerialConnection,
} from "./connection.js";

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

  /**
   * Always exit file-transfer mode, even when the transfer itself failed.
   * A failed exit only overrides an `Ok` result, so callers see the root
   * cause of a failed transfer rather than the cleanup failure.
   */
  private async exitFileTransferMode<T>(
    result: Result<T, VexSerialError>,
    action: FileExitAction = FileExitAction.EXIT_HALT,
  ): Promise<Result<T, VexSerialError>> {
    try {
      const exitResult = await this.request(
        new ExitFileTransferH2DPacket(action),
        ExitFileTransferReplyD2HPacket,
        30000,
      );
      return result.isOk() && exitResult.isErr()
        ? err(exitResult.error)
        : result;
    } catch (error) {
      return result.isOk() ? err(toVexSerialError(error, "io")) : result;
    }
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

      // Reads stay lock-step. The device may answer with fewer bytes than were
      // asked for, and every later read is addressed relative to where the
      // previous one actually ended, so the next request cannot be formed
      // until this reply lands.
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

      result = ok(fileBuf);
    } catch (e) {
      result = err(
        e instanceof VexSerialError ? e : toVexSerialError(e, "transfer"),
      );
    } finally {
      result = await this.exitFileTransferMode(result);
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

      // Chunks are written with several outstanding at once: each reply only
      // acknowledges its own write, so the next chunk does not depend on it.
      // Replies are awaited in send order, and the first failure stops the
      // transfer before any further chunk is queued.
      const inFlight: Array<
        Promise<Result<WriteFileReplyD2HPacket, VexSerialError>>
      > = [];
      let acknowledgedBytes = 0;

      while (!lastBlock || inFlight.length > 0) {
        while (!lastBlock && inFlight.length < this.transferWindowSize) {
          let tmpbuf;
          if (buf.byteLength - bufferOffset > bufferChunkSize) {
            tmpbuf = buf.subarray(bufferOffset, bufferOffset + bufferChunkSize);
          } else {
            // Last chunk: pad up to a word boundary.
            const remaining = buf.byteLength - bufferOffset;
            tmpbuf = new Uint8Array((remaining + 3) & ~3);
            tmpbuf.set(buf.subarray(bufferOffset, buf.byteLength));
            lastBlock = true;
          }

          inFlight.push(
            this.requestPipelined(
              new WriteFileH2DPacket(nextAddress, tmpbuf),
              WriteFileReplyD2HPacket,
              3000,
            ),
          );

          // next chunk
          bufferOffset += bufferChunkSize;
          nextAddress += bufferChunkSize;
        }

        const p2Result = await inFlight.shift()!;
        if (p2Result.isErr()) {
          // Let the writes still outstanding settle before unwinding, so their
          // replies cannot be matched against a later transfer's requests.
          await Promise.allSettled(inFlight);
          throw p2Result.error;
        }

        acknowledgedBytes = Math.min(
          acknowledgedBytes + bufferChunkSize,
          buf.byteLength,
        );
        progressCallback?.(acknowledgedBytes, buf.byteLength);
      }

      result = ok(true);
    } catch (e) {
      result = err(
        e instanceof VexSerialError ? e : toVexSerialError(e, "transfer"),
      );
    } finally {
      result = await this.exitFileTransferMode(
        result,
        result.isOk() && autoRun
          ? FileExitAction.EXIT_RUN
          : FileExitAction.EXIT_HALT,
      );
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
        return this.exitFileTransferMode(result);
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
        return this.exitFileTransferMode(result);
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

  /**
   * Drain whatever the brain currently holds in a user-program FIFO channel.
   *
   * An empty array is the ordinary answer for a program that has printed
   * nothing since the last read, not a failure. Trailing NUL padding the brain
   * adds to the reply is removed, so the returned bytes are exactly the ones
   * the program wrote.
   */
  readUserFifo(
    channel: UserFifoChannel = UserFifoChannel.STDOUT,
    timeout: number = DEFAULT_USER_FIFO_TIMEOUT,
  ): ResultAsync<Uint8Array, VexSerialError> {
    return this.request(
      new UserFifoH2DPacket(channel),
      UserFifoReplyD2HPacket,
      timeout,
    ).map((reply) => trimTrailingNuls(reply.buf));
  }

  /**
   * Push bytes into a user-program FIFO channel, splitting them across as many
   * requests as the per-packet limit requires. Resolves with the number of
   * bytes the brain accepted; a failed chunk stops the write and reports the
   * error, so a partial write is visible as an `Err` rather than a short count.
   */
  writeUserFifo(
    data: Uint8Array | string,
    channel: UserFifoChannel = UserFifoChannel.STDIN,
    timeout: number = DEFAULT_USER_FIFO_TIMEOUT,
  ): ResultAsync<number, VexSerialError> {
    const bytes =
      typeof data === "string" ? new TextEncoder().encode(data) : data;
    return new ResultAsync(this._writeUserFifo(bytes, channel, timeout));
  }

  private async _writeUserFifo(
    bytes: Uint8Array,
    channel: UserFifoChannel,
    timeout: number,
  ): Promise<Result<number, VexSerialError>> {
    for (
      let offset = 0;
      offset < bytes.byteLength;
      offset += USER_FIFO_MAX_WRITE_SIZE
    ) {
      const chunk = bytes.subarray(offset, offset + USER_FIFO_MAX_WRITE_SIZE);
      const reply = await this.request(
        new UserFifoH2DPacket(channel, chunk),
        UserFifoReplyD2HPacket,
        timeout,
      );
      if (reply.isErr()) return err(reply.error);
    }
    return ok(bytes.byteLength);
  }
}

/**
 * The brain pads a FIFO reply out to a word boundary with NULs. A user program
 * that prints an interior NUL keeps it; only the padded tail is dropped.
 */
function trimTrailingNuls(bytes: Uint8Array): Uint8Array {
  let end = bytes.byteLength;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return bytes.slice(0, end);
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
