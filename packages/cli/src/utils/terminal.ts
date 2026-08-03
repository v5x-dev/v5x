import chalk from "chalk";
import type {
  V5SerialDevice,
  V5UserProgramTerminal,
  VexSerialError,
} from "@v5x/serial";
import { CliError, exitCodeForSerialError, serialCliError } from "../errors";
import { formatSerialFailure } from "./output";

/** Byte sent by a terminal in raw mode for ctrl-c. */
const ETX = 0x03;
/** Byte sent by a terminal in raw mode for ctrl-d. */
const EOT = 0x04;

export interface TerminalRenderOptions {
  /** Prefix each output line with the time it reached the host. */
  timestamps?: boolean;
  /** Emit ANSI colour. Defaults to whether the destination is a TTY. */
  color?: boolean;
  /** Injectable clock, so rendering is deterministic under test. */
  now?: () => Date;
}

export interface TerminalRenderer {
  /** Render a chunk of program output. */
  render(text: string): string;
  /** Render whatever is still buffered when the session ends. */
  flush(): string;
}

export function formatTimestamp(date: Date): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )}.${pad(date.getMilliseconds(), 3)}`;
}

/**
 * Turn the program's byte stream into what the user sees.
 *
 * Without timestamps this is a pass-through, so output appears exactly as the
 * program wrote it, partial lines included. With timestamps the stream has to
 * be split on newlines, which means a line is held back until the program
 * terminates it — a program that prints a prompt without a newline will not
 * show that prompt until it prints one.
 */
export function createTerminalRenderer(
  options: TerminalRenderOptions = {},
): TerminalRenderer {
  const { timestamps = false, color = true, now = () => new Date() } = options;
  if (!timestamps) {
    return { render: (text) => text, flush: () => "" };
  }

  const paint = (value: string): string => (color ? chalk.dim(value) : value);
  let pending = "";

  const prefixed = (line: string): string =>
    `${paint(formatTimestamp(now()))} ${line}\n`;

  return {
    render(text: string): string {
      pending += text;
      let output = "";
      let start = 0;
      while (true) {
        const newline = pending.indexOf("\n", start);
        if (newline === -1) break;
        output += prefixed(pending.slice(start, newline));
        start = newline + 1;
      }
      pending = pending.slice(start);
      return output;
    },
    flush(): string {
      if (pending === "") return "";
      const line = pending;
      pending = "";
      return prefixed(line);
    },
  };
}

export interface TerminalJsonRecord {
  time: string;
  stream: "stdout";
  text: string;
}

/**
 * Render each chunk as one NDJSON record. Chunks are not merged into lines:
 * a consumer that wants lines can join `text` values, and one that wants
 * arrival timing needs the chunk boundaries preserved.
 */
export function createTerminalJsonRenderer(
  now: () => Date = () => new Date(),
): TerminalRenderer {
  return {
    render: (text) =>
      `${JSON.stringify({
        time: now().toISOString(),
        stream: "stdout",
        text,
      } satisfies TerminalJsonRecord)}\n`,
    flush: () => "",
  };
}

export interface TerminalStreams {
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
  stdin: NodeJS.ReadStream;
  isStdoutTty: boolean;
}

export interface TerminalSessionOptions {
  timestamps?: boolean;
  json?: boolean;
  /** Forward the host's standard input to the program. */
  input?: boolean;
  color?: boolean;
  streams?: TerminalStreams;
}

function defaultStreams(): TerminalStreams {
  return {
    stdout: process.stdout,
    stderr: process.stderr,
    stdin: process.stdin,
    isStdoutTty: process.stdout.isTTY === true,
  };
}

/**
 * Forward host input to the program until the user asks to quit.
 *
 * On a TTY the input is put in raw mode so keystrokes reach the program as it
 * types them, which also means ctrl-c no longer raises SIGINT and has to be
 * recognised here. Returns a teardown that always restores the original mode.
 */
function attachInput(
  stdin: NodeJS.ReadStream,
  terminal: V5UserProgramTerminal,
  quit: () => void,
): () => void {
  const wasRaw = stdin.isRaw === true;
  const isTty = stdin.isTTY === true;

  const onData = (chunk: Buffer): void => {
    if (isTty && chunk.some((byte) => byte === ETX || byte === EOT)) {
      const upToQuit = chunk.subarray(
        0,
        chunk.findIndex((byte) => byte === ETX || byte === EOT),
      );
      if (upToQuit.byteLength > 0) void terminal.write(upToQuit);
      quit();
      return;
    }
    void terminal.write(new Uint8Array(chunk));
  };

  if (isTty) stdin.setRawMode(true);
  stdin.on("data", onData);
  stdin.on("end", quit);
  stdin.resume();

  return () => {
    stdin.off("data", onData);
    stdin.off("end", quit);
    stdin.pause();
    if (isTty) stdin.setRawMode(wasRaw);
  };
}

/**
 * Stream a running program's output until the user quits or the link drops.
 *
 * Program output goes to standard output and nothing else does, so
 * `v5x terminal > log.txt` captures exactly what the program printed.
 */
export async function runTerminalSession(
  device: V5SerialDevice,
  options: TerminalSessionOptions = {},
): Promise<void> {
  const streams = options.streams ?? defaultStreams();
  const json = options.json === true;
  const color = options.color ?? streams.isStdoutTty;
  const renderer = json
    ? createTerminalJsonRenderer()
    : createTerminalRenderer({ timestamps: options.timestamps, color });

  const opened = device.openTerminal();
  if (opened.isErr()) {
    throw serialCliError(
      formatSerialFailure("cannot open a terminal", opened.error),
      opened.error,
    );
  }
  const terminal = opened.value;

  if (!json) {
    const hint =
      options.input !== false && streams.stdin.isTTY === true
        ? "streaming program output; ctrl-c to exit, typing is sent to the program"
        : "streaming program output; ctrl-c to exit";
    streams.stderr.write(`${chalk.dim(hint)}\n`);
  }

  let quitting = false;
  let finish = (): void => {};
  const finished = new Promise<void>((resolve) => {
    finish = () => {
      if (quitting) return;
      quitting = true;
      resolve();
    };
  });

  // A session the device ended (a lost link, or reads that kept failing) is a
  // failure the caller has to see; a session the user quit is not.
  let endedByDevice = false;
  let lastError: VexSerialError | undefined;

  const onText = (text: string): void => {
    streams.stdout.write(renderer.render(text));
  };
  const onError = (error: VexSerialError): void => {
    lastError = error;
  };
  const onClosed = (): void => {
    endedByDevice = true;
    finish();
  };
  terminal.on("text", onText);
  terminal.on("error", onError);
  terminal.on("closed", onClosed);

  const onSigint = (): void => finish();
  process.on("SIGINT", onSigint);
  const detachInput =
    options.input === false
      ? undefined
      : attachInput(streams.stdin, terminal, finish);

  try {
    await finished;
  } finally {
    detachInput?.();
    process.off("SIGINT", onSigint);
    terminal.remove("text", onText);
    terminal.remove("error", onError);
    terminal.remove("closed", onClosed);
    await terminal.close();
    streams.stdout.write(renderer.flush());
  }

  if (endedByDevice && lastError !== undefined) {
    throw new CliError(
      formatSerialFailure("the terminal session ended", lastError),
      exitCodeForSerialError(lastError.kind),
      { cause: lastError },
    );
  }
}
