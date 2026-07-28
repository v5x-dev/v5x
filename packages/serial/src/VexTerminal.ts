import { UserFifoChannel } from "./Vex.js";
import { type V5SerialConnection } from "./VexConnection.js";
import { VexEventTarget } from "./VexEvent.js";
import {
  VexInvalidArgumentError,
  VexNotConnectedError,
  type VexSerialError,
} from "./VexError.js";
import { err, ok, type Result, type ResultAsync } from "neverthrow";

/** Delay between polls once the brain reports an empty channel. */
export const DEFAULT_TERMINAL_IDLE_POLL_MS = 50;

/**
 * Consecutive failed reads tolerated before the session gives up. Occasional
 * timeouts are normal while the brain is busy (a file transfer holds the link
 * for whole chunks at a time), so a single failure must not end a terminal.
 */
export const DEFAULT_TERMINAL_MAX_CONSECUTIVE_ERRORS = 20;

export interface V5TerminalOptions {
  /**
   * Delay before polling again after the brain reports nothing buffered.
   * A non-empty read is followed immediately by another read so that bursts
   * of output drain at link speed rather than at this interval.
   */
  idlePollIntervalMs?: number;
  /** Reply timeout for each FIFO request. */
  timeoutMs?: number;
  /** Consecutive failed reads tolerated before the session closes itself. */
  maxConsecutiveErrors?: number;
}

export interface V5TerminalEvents {
  /** Raw bytes drained from the program's output channel. */
  data: Uint8Array;
  /**
   * The same bytes decoded as UTF-8. Decoding is incremental, so a multi-byte
   * character split across two reads is emitted once, whole, with the read
   * that completes it.
   */
  text: string;
  /** A read failed. The session keeps polling unless `closed` follows. */
  error: VexSerialError;
  /** The session stopped, either from {@link V5UserProgramTerminal.close} or repeated failures. */
  closed: undefined;
}

/**
 * A live view of a running user program's standard streams.
 *
 * The brain does not push program output, so the session polls the output FIFO
 * and emits whatever it drains. Because polling shares the connection with
 * every other request, reads are ordinary serialized requests: a screenshot or
 * an upload running at the same time delays the terminal but never corrupts it.
 */
export class V5UserProgramTerminal extends VexEventTarget<V5TerminalEvents> {
  readonly idlePollIntervalMs: number;
  readonly timeoutMs: number | undefined;
  readonly maxConsecutiveErrors: number;

  private readonly connection: V5SerialConnection;
  private readonly decoder = new TextDecoder("utf-8");
  private polling: Promise<void> | undefined;
  private running = false;
  private wakeIdleWait: (() => void) | undefined;

  constructor(connection: V5SerialConnection, options: V5TerminalOptions = {}) {
    super();
    const idlePollIntervalMs =
      options.idlePollIntervalMs ?? DEFAULT_TERMINAL_IDLE_POLL_MS;
    if (!Number.isFinite(idlePollIntervalMs) || idlePollIntervalMs < 0) {
      throw new VexInvalidArgumentError(
        "idlePollIntervalMs must be a finite, non-negative number",
      );
    }
    const maxConsecutiveErrors =
      options.maxConsecutiveErrors ?? DEFAULT_TERMINAL_MAX_CONSECUTIVE_ERRORS;
    if (
      !Number.isSafeInteger(maxConsecutiveErrors) ||
      maxConsecutiveErrors < 1
    ) {
      throw new VexInvalidArgumentError(
        "maxConsecutiveErrors must be a positive safe integer",
      );
    }

    this.connection = connection;
    this.idlePollIntervalMs = idlePollIntervalMs;
    this.timeoutMs = options.timeoutMs;
    this.maxConsecutiveErrors = maxConsecutiveErrors;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Begin polling. Calling this on an already-running session is a no-op, so
   * a caller that cannot tell whether a session started may call it again.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.polling = this.poll();
  }

  /** Stop polling and wait for the in-flight read to settle. */
  async close(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.wakeIdleWait?.();
    const polling = this.polling;
    this.polling = undefined;
    await polling;
  }

  /**
   * Send bytes to the program's standard input. Safe to call whether or not
   * the session is polling.
   */
  write(data: Uint8Array | string): ResultAsync<number, VexSerialError> {
    return this.connection.writeUserFifo(
      data,
      UserFifoChannel.STDIN,
      this.timeoutMs,
    );
  }

  private async poll(): Promise<void> {
    let consecutiveErrors = 0;

    while (this.running) {
      if (!this.connection.isConnected) {
        this.stopWith(new VexNotConnectedError());
        return;
      }

      const read = await this.connection.readUserFifo(
        UserFifoChannel.STDOUT,
        this.timeoutMs,
      );
      if (!this.running) break;

      if (read.isErr()) {
        consecutiveErrors++;
        this.emitSafely("error", read.error);
        if (consecutiveErrors >= this.maxConsecutiveErrors) {
          this.running = false;
          this.emitSafely("closed", undefined);
          return;
        }
        await this.waitIdle();
        continue;
      }

      consecutiveErrors = 0;
      const bytes = read.value;
      if (bytes.byteLength === 0) {
        await this.waitIdle();
        continue;
      }

      this.emitSafely("data", bytes);
      this.emitSafely("text", this.decoder.decode(bytes, { stream: true }));
    }

    this.emitSafely("closed", undefined);
  }

  private stopWith(error: VexSerialError): void {
    this.running = false;
    this.emitSafely("error", error);
    this.emitSafely("closed", undefined);
  }

  /** Sleep until the next poll, or until {@link close} interrupts the wait. */
  private waitIdle(): Promise<void> {
    if (this.idlePollIntervalMs === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (): void => {
        if (timer === undefined) return;
        clearTimeout(timer);
        timer = undefined;
        this.wakeIdleWait = undefined;
        resolve();
      };
      timer = setTimeout(finish, this.idlePollIntervalMs);
      this.wakeIdleWait = finish;
    });
  }

  /**
   * Terminal events are notifications only: a consumer callback must not be
   * able to stop the poll loop by throwing.
   */
  private emitSafely<K extends keyof V5TerminalEvents>(
    eventName: K,
    data: V5TerminalEvents[K],
  ): void {
    try {
      this.emit(eventName, data);
    } catch {
      // Listeners are application code.
    }
  }
}

/**
 * Open a terminal session on an already-connected connection. Fails rather
 * than starting a session that could only ever report a disconnected link.
 */
export function openUserProgramTerminal(
  connection: V5SerialConnection | undefined,
  options: V5TerminalOptions = {},
): Result<V5UserProgramTerminal, VexSerialError> {
  if (connection === undefined || !connection.isConnected) {
    return err(new VexNotConnectedError());
  }
  const terminal = new V5UserProgramTerminal(connection, options);
  terminal.start();
  return ok(terminal);
}
