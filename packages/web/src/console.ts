import type {
  V5TerminalOptions,
  V5UserProgramTerminal,
  VexSerialError,
} from "@v5x/serial";
import type { Result } from "neverthrow";
import {
  V5WebError,
  normalizeV5WebError,
  type V5WebErrorCode,
} from "./errors.js";
import {
  createListenerSet,
  type V5Store,
  type V5Unsubscribe,
} from "./store.js";

/** Characters kept in the console buffer before the oldest output is dropped. */
export const DEFAULT_CONSOLE_BUFFER_CHARACTERS = 100_000;

export type V5ConsoleStatus = "idle" | "streaming" | "error";

export interface V5ConsoleSnapshot {
  status: V5ConsoleStatus;
  streaming: boolean;
  /**
   * Everything the program has printed since the console started, capped at
   * the configured buffer size. Render this directly; it is a plain string so
   * a `<pre>` needs no per-line reconciliation.
   */
  text: string;
  /**
   * Number of chunks appended so far. Useful as a change key for scrolling a
   * view to the bottom, because `text` can stay equal after trimming.
   */
  chunks: number;
  /** True once output has been dropped from the front of the buffer. */
  truncated: boolean;
  error: V5WebError | null;
}

export interface V5Console extends V5Store<V5ConsoleSnapshot> {
  getSnapshot(): V5ConsoleSnapshot;
  subscribe(listener: () => void): V5Unsubscribe;
  /** Begin streaming. Resolves false when no connected device can provide one. */
  start(): Promise<boolean>;
  /** Stop streaming. The buffered text is kept. */
  stop(): Promise<void>;
  /** Empty the buffer without interrupting a running stream. */
  clear(): void;
  /** Send a line to the program's standard input. */
  send(text: string): Promise<boolean>;
}

/** The part of a device the console needs, so tests can supply a stand-in. */
export interface V5ConsoleDeviceSource {
  openTerminal?: (
    options?: V5TerminalOptions,
  ) => Result<V5UserProgramTerminal, VexSerialError>;
}

export interface V5ConsoleOptions {
  /** Maximum characters retained. Older output is dropped a line at a time. */
  maxCharacters?: number;
  /** Forwarded to the underlying serial terminal session. */
  terminal?: V5TerminalOptions;
}

/**
 * Trim the buffer to `limit` characters, preferring to cut at a line boundary
 * so a rendered console never shows a half line at the top.
 */
export function trimConsoleBuffer(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(text.length - limit);
  const newline = cut.indexOf("\n");
  return newline === -1 || newline === cut.length - 1
    ? cut
    : cut.slice(newline + 1);
}

class V5WebConsole implements V5Console {
  private readonly listeners = createListenerSet();
  private readonly maxCharacters: number;
  private readonly terminalOptions: V5TerminalOptions | undefined;
  private readonly getDevice: () => V5ConsoleDeviceSource | null;

  private terminal: V5UserProgramTerminal | null = null;
  private detach: (() => void) | null = null;
  private status: V5ConsoleStatus = "idle";
  private text = "";
  private chunks = 0;
  private truncated = false;
  private error: V5WebError | null = null;
  private snapshot: V5ConsoleSnapshot;
  private startPromise: Promise<boolean> | null = null;

  constructor(
    getDevice: () => V5ConsoleDeviceSource | null,
    options: V5ConsoleOptions = {},
  ) {
    const maxCharacters =
      options.maxCharacters ?? DEFAULT_CONSOLE_BUFFER_CHARACTERS;
    if (!Number.isSafeInteger(maxCharacters) || maxCharacters <= 0) {
      throw new RangeError("maxCharacters must be a positive safe integer");
    }
    this.getDevice = getDevice;
    this.maxCharacters = maxCharacters;
    this.terminalOptions = options.terminal;
    this.snapshot = this.createSnapshot();
  }

  getSnapshot(): V5ConsoleSnapshot {
    return this.snapshot;
  }

  subscribe(listener: () => void): V5Unsubscribe {
    return this.listeners.subscribe(listener);
  }

  start(): Promise<boolean> {
    if (this.terminal !== null) return Promise.resolve(true);
    if (this.startPromise !== null) return this.startPromise;

    const startPromise = this.runStart();
    this.startPromise = startPromise;
    void startPromise.then(() => {
      if (this.startPromise === startPromise) this.startPromise = null;
    });
    return startPromise;
  }

  private async runStart(): Promise<boolean> {
    const device = this.getDevice();
    if (device?.openTerminal === undefined) {
      this.fail(
        "connect-failed",
        undefined,
        "Connect a V5 device before starting the console.",
      );
      return false;
    }

    let opened: Result<V5UserProgramTerminal, VexSerialError>;
    try {
      opened = device.openTerminal(this.terminalOptions);
    } catch (error: unknown) {
      this.fail("connect-error", error, "The V5 console could not be opened.");
      return false;
    }

    if (opened.isErr()) {
      this.fail(
        "connect-failed",
        opened.error,
        "The V5 console could not be opened.",
      );
      return false;
    }

    const terminal = opened.value;
    let terminalError: V5WebError | null = null;

    const onText = (chunk: string): void => this.append(chunk);
    const onError = (error: VexSerialError): void => {
      if (this.terminal !== terminal) return;
      terminalError = normalizeV5WebError(
        "connect-error",
        error,
        "Reading V5 program output failed.",
      );
      this.error = terminalError;
      this.publish();
    };
    const onClosed = (): void => {
      if (this.terminal !== terminal) return;
      this.detach?.();
      this.detach = null;
      this.terminal = null;
      this.status = terminalError === null ? "idle" : "error";
      this.publish();
      void terminal.close();
    };
    terminal.on("text", onText);
    terminal.on("error", onError);
    terminal.on("closed", onClosed);

    this.terminal = terminal;
    this.detach = () => {
      terminal.remove("text", onText);
      terminal.remove("error", onError);
      terminal.remove("closed", onClosed);
    };
    this.status = "streaming";
    this.error = null;
    this.publish();
    return true;
  }

  async stop(): Promise<void> {
    const terminal = this.terminal;
    this.detach?.();
    this.detach = null;
    this.terminal = null;
    if (this.status === "streaming") {
      this.status = "idle";
      this.publish();
    }
    await terminal?.close();
  }

  clear(): void {
    if (this.text === "" && !this.truncated) return;
    this.text = "";
    this.truncated = false;
    this.publish();
  }

  async send(text: string): Promise<boolean> {
    const terminal = this.terminal;
    if (terminal === null) return false;
    const written = await terminal.write(text);
    if (written.isErr()) {
      this.error = normalizeV5WebError(
        "connect-error",
        written.error,
        "Sending input to the V5 program failed.",
      );
      this.publish();
      return false;
    }
    return true;
  }

  private append(chunk: string): void {
    if (chunk === "") return;
    const combined = this.text + chunk;
    const trimmed = trimConsoleBuffer(combined, this.maxCharacters);
    this.truncated ||= trimmed.length !== combined.length;
    this.text = trimmed;
    this.chunks++;
    this.publish();
  }

  private fail(code: V5WebErrorCode, cause: unknown, fallback: string): void {
    this.status = "error";
    this.error = normalizeV5WebError(code, cause, fallback);
    this.publish();
  }

  private createSnapshot(): V5ConsoleSnapshot {
    return {
      status: this.status,
      streaming: this.status === "streaming",
      text: this.text,
      chunks: this.chunks,
      truncated: this.truncated,
      error: this.error,
    };
  }

  private publish(): void {
    this.snapshot = this.createSnapshot();
    this.listeners.emit();
  }
}

export function createV5Console(
  getDevice: () => V5ConsoleDeviceSource | null,
  options: V5ConsoleOptions = {},
): V5Console {
  return new V5WebConsole(getDevice, options);
}
