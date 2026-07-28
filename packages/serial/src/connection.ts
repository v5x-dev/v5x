import { AckType, type IPacketCallback } from "./vex.js";
import {
  VexInvalidArgumentError,
  VexNotConnectedError,
  VexProtocolError,
  VexSerialError,
} from "./error.js";
import { VexEventTarget } from "./event.js";
import { err, ok, Result, ResultAsync } from "neverthrow";
import {
  DeviceBoundPacket,
  type HostBoundPacket,
  SystemVersionH2DPacket,
  SystemVersionReplyD2HPacket,
  Query1H2DPacket,
  Query1ReplyD2HPacket,
} from "./packet.js";
import { type VexFirmwareVersion } from "./firmware-version.js";
import { FileTransferQueue } from "./file-transfer-queue.js";
import { PendingRequestDispatcher } from "./pending-request-dispatcher.js";
import { ReceiveBuffer } from "./receive-buffer.js";
import { runPacketReader } from "./packet-reader.js";
import {
  SerialTransport,
  type SerialTransportOpenResult,
} from "./serial-transport.js";

type HostBoundPacketType<T extends HostBoundPacket> = {
  new (data: ArrayBuffer | Uint8Array): T;
  name: string;
};

/** Outcome of {@link VexSerialConnection.open}. */
export type OpenResult = SerialTransportOpenResult;

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

/**
 * Default number of file-transfer chunks kept in flight. Transfer time is
 * dominated by USB round-trip latency rather than link throughput, so allowing
 * a few outstanding chunks cuts wall-clock time roughly proportionally.
 */
export const DEFAULT_TRANSFER_WINDOW_SIZE = 4;

/**
 * Reply timeout for user-FIFO requests. A terminal issues these continuously,
 * so the wait is short enough that a stalled reply is retried rather than
 * holding up the poll loop for a full second.
 */
export const DEFAULT_USER_FIFO_TIMEOUT = 500;

export interface VexSerialConnectionOptions {
  /** Maximum file size accepted from a caller or device before allocation. */
  maxFileDownloadBytes?: number;
  /**
   * How many file-transfer chunks may be outstanding at once. The brain
   * answers chunk requests in the order it receives them, which is what lets
   * replies be matched to requests positionally. Set this to 1 to restore
   * strict lock-step transfers.
   */
  transferWindowSize?: number;
}

/**
 * A connection to a V5 device.
 * Emit events: connected, disconnected, warning
 */
export class VexSerialConnection extends VexEventTarget<VexSerialConnectionEvents> {
  filters: SerialPortFilter[] = [{ usbVendorId: 10376 }];

  serial: Serial;
  readonly maxFileDownloadBytes: number;
  readonly transferWindowSize: number;

  private readonly pendingRequests = new PendingRequestDispatcher();
  private readonly transport: SerialTransport;
  protected readonly fileTransfers = new FileTransferQueue();

  /**
   * Pending callbacks, exposed as a snapshot for backwards compatibility.
   * @deprecated This exposes request-dispatcher internals and will be removed
   * in the next major release.
   */
  get callbacksQueue(): IPacketCallback[] {
    return this.pendingRequests.callbacks;
  }

  get isConnected(): boolean {
    return this.transport.isConnected;
  }

  get writer(): WritableStreamDefaultWriter<unknown> | undefined {
    return this.transport.writer;
  }

  /**
   * @deprecated Mutating the writer can corrupt transport lifecycle state and
   * will be removed in the next major release.
   */
  set writer(value: WritableStreamDefaultWriter<unknown> | undefined) {
    this.transport.writer = value;
  }

  get reader(): ReadableStreamDefaultReader<unknown> | undefined {
    return this.transport.reader;
  }

  /**
   * @deprecated Mutating the reader can corrupt transport lifecycle state and
   * will be removed in the next major release.
   */
  set reader(value: ReadableStreamDefaultReader<unknown> | undefined) {
    this.transport.reader = value;
  }

  get port(): SerialPort | undefined {
    return this.transport.port;
  }

  /**
   * @deprecated Mutating the port can corrupt transport lifecycle state and
   * will be removed in the next major release.
   */
  set port(value: SerialPort | undefined) {
    this.transport.port = value;
  }

  get isFileTransferring(): boolean {
    return this.fileTransfers.isActive;
  }

  constructor(serial: Serial, options: VexSerialConnectionOptions = {}) {
    super();
    this.serial = serial;
    this.transport = new SerialTransport(
      () => this.serial,
      () => this.filters,
      {
        hasPendingRequests: () => this.pendingRequests.hasPending,
        beforeClose: () => {
          for (const callback of this.pendingRequests.drain()) {
            callback.callback(AckType.NOT_CONNECTED);
          }
        },
        startReader: () => void this.startReader(),
        connected: () => this.emitSafely("connected", undefined),
        disconnected: () => this.emitSafely("disconnected", undefined),
        warning: (message, details) => this.reportWarning(message, details),
      },
    );
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

    const transferWindowSize =
      options.transferWindowSize ?? DEFAULT_TRANSFER_WINDOW_SIZE;
    if (!Number.isSafeInteger(transferWindowSize) || transferWindowSize <= 0) {
      throw new VexInvalidArgumentError(
        "transferWindowSize must be a positive safe integer",
      );
    }
    this.transferWindowSize = transferWindowSize;
  }

  /** Report a recovered, non-fatal condition to connection listeners. */
  reportWarning(message: string, details?: unknown): void {
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
    await this.transport.close();
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
    return new ResultAsync(this.transport.open(use, askUser));
  }

  /**
   * Write a request and resolve with its reply.
   *
   * Requests carrying the same command ID are serialized against each other by
   * default, because reply matching is positional. Pass `pipelined` to opt out
   * when the caller already owns that command for the duration and wants
   * several requests outstanding at once; see {@link requestPipelined}.
   */
  async writeDataAsync(
    rawData: DeviceBoundPacket | Uint8Array,
    timeout: number = 1000,
    pipelined: boolean = false,
  ): Promise<HostBoundPacket | ArrayBuffer | AckType> {
    if (rawData instanceof DeviceBoundPacket && !pipelined) {
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
      if (this.writer === undefined || this.transport.isClosing) {
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
      this.interpretReply(
        packet,
        ReplyType,
        this.writeDataAsync(packet, timeout),
      ),
    );
  }

  /**
   * Write a request without waiting for the queue of identical commands to
   * drain, so a caller can keep several in flight. The bytes are handed to the
   * writer and the reply callback is enqueued before this returns, which is
   * what keeps wire order and reply-matching order identical.
   *
   * Only safe for a caller that owns the command for the duration, such as a
   * file transfer holding the transfer queue.
   */
  protected requestPipelined<T extends HostBoundPacket>(
    packet: DeviceBoundPacket,
    ReplyType: HostBoundPacketType<T>,
    timeout: number,
  ): Promise<Result<T, VexSerialError>> {
    return this.interpretReply(
      packet,
      ReplyType,
      this.writeDataAsync(packet, timeout, true),
    );
  }

  private async interpretReply<T extends HostBoundPacket>(
    packet: DeviceBoundPacket,
    ReplyType: HostBoundPacketType<T>,
    reply: Promise<HostBoundPacket | ArrayBuffer | AckType>,
  ): Promise<Result<T, VexSerialError>> {
    const result = await reply;
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
  }

  protected async readData(
    cache: ReceiveBuffer,
    expectedSize: number,
  ): Promise<void> {
    await this.transport.readData(cache, expectedSize);
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
