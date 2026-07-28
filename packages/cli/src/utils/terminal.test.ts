import { describe, expect, test } from "bun:test";
import chalk from "chalk";
import { EventEmitter } from "node:events";
import { errAsync, okAsync } from "neverthrow";
import type { ResultAsync } from "neverthrow";
import {
  VexProtocolError,
  VexNotConnectedError,
  type V5SerialDevice,
  type V5UserProgramTerminal,
  type VexSerialError,
} from "@v5x/serial";
import { err, ok } from "neverthrow";
import {
  createTerminalJsonRenderer,
  createTerminalRenderer,
  formatTimestamp,
  runTerminalSession,
  type TerminalStreams,
} from "./terminal";

const decoder = new TextDecoder();

function clockAt(...times: string[]): () => Date {
  let index = 0;
  return () => new Date(times[Math.min(index++, times.length - 1)]!);
}

describe("createTerminalRenderer", () => {
  test("passes output through untouched without timestamps", () => {
    const renderer = createTerminalRenderer();

    expect(renderer.render("partial")).toBe("partial");
    expect(renderer.render(" line\n")).toBe(" line\n");
    expect(renderer.flush()).toBe("");
  });

  test("prefixes each completed line with its arrival time", () => {
    const renderer = createTerminalRenderer({
      timestamps: true,
      color: false,
      now: clockAt("2026-07-27T10:11:12.130"),
    });

    expect(renderer.render("first\nsecond\n")).toBe(
      "10:11:12.130 first\n10:11:12.130 second\n",
    );
  });

  test("holds an unterminated line until the program finishes it", () => {
    const renderer = createTerminalRenderer({
      timestamps: true,
      color: false,
      now: clockAt("2026-07-27T10:11:12.130"),
    });

    expect(renderer.render("half")).toBe("");
    expect(renderer.render(" a line\n")).toBe("10:11:12.130 half a line\n");
  });

  test("flushes a trailing partial line when the session ends", () => {
    const renderer = createTerminalRenderer({
      timestamps: true,
      color: false,
      now: clockAt("2026-07-27T10:11:12.130"),
    });

    renderer.render("no newline");

    expect(renderer.flush()).toBe("10:11:12.130 no newline\n");
    expect(renderer.flush()).toBe("");
  });

  test("colors only the timestamp, and only when color is enabled", () => {
    const level = chalk.level;
    chalk.level = 1;
    try {
      const colored = createTerminalRenderer({
        timestamps: true,
        color: true,
        now: clockAt("2026-07-27T10:11:12.130"),
      }).render("line\n");
      const plain = createTerminalRenderer({
        timestamps: true,
        color: false,
        now: clockAt("2026-07-27T10:11:12.130"),
      }).render("line\n");

      expect(colored).toContain("\u001b[");
      // Stripping the escapes has to leave exactly the uncolored rendering.
      expect(colored.replaceAll(/\u001b\[[0-9;]*m/g, "")).toBe(plain);
      expect(plain).not.toContain("\u001b[");
    } finally {
      chalk.level = level;
    }
  });

  test("pads every timestamp field to a fixed width", () => {
    expect(formatTimestamp(new Date("2026-07-27T01:02:03.004"))).toBe(
      "01:02:03.004",
    );
  });
});

describe("createTerminalJsonRenderer", () => {
  test("emits one record per chunk of output", () => {
    const renderer = createTerminalJsonRenderer(
      clockAt("2026-07-27T10:11:12.130Z", "2026-07-27T10:11:13.000Z"),
    );

    const first = renderer.render("hello");
    const second = renderer.render(" world\n");

    expect(JSON.parse(first)).toEqual({
      time: "2026-07-27T10:11:12.130Z",
      stream: "stdout",
      text: "hello",
    });
    expect(JSON.parse(second).text).toBe(" world\n");
    expect(first.endsWith("\n")).toBe(true);
  });
});

interface FakeTerminalEvents {
  text: string;
  error: VexSerialError;
  closed: undefined;
}

/** A terminal session stub that records what the CLI does with it. */
class FakeTerminal {
  readonly listeners = new EventEmitter();
  readonly written: string[] = [];
  closed = 0;

  on<K extends keyof FakeTerminalEvents>(
    event: K,
    listener: (value: FakeTerminalEvents[K]) => void,
  ): void {
    this.listeners.on(event, listener as (...args: unknown[]) => void);
  }

  remove<K extends keyof FakeTerminalEvents>(
    event: K,
    listener: (value: FakeTerminalEvents[K]) => void,
  ): void {
    this.listeners.off(event, listener as (...args: unknown[]) => void);
  }

  write(data: Uint8Array | string): ResultAsync<number, VexSerialError> {
    const bytes =
      typeof data === "string" ? new TextEncoder().encode(data) : data;
    this.written.push(decoder.decode(bytes));
    return okAsync(bytes.byteLength);
  }

  async close(): Promise<void> {
    this.closed++;
  }

  emitText(text: string): void {
    this.listeners.emit("text", text);
  }

  emitError(error: VexSerialError): void {
    this.listeners.emit("error", error);
  }

  emitClosed(): void {
    this.listeners.emit("closed", undefined);
  }

  get listenerCount(): number {
    return (["text", "error", "closed"] as const).reduce(
      (total, event) => total + this.listeners.listenerCount(event),
      0,
    );
  }
}

class FakeStdin extends EventEmitter {
  isTTY = true;
  isRaw = false;
  resumed = 0;
  paused = 0;
  rawModeCalls: boolean[] = [];

  setRawMode(value: boolean): this {
    this.isRaw = value;
    this.rawModeCalls.push(value);
    return this;
  }

  resume(): this {
    this.resumed++;
    return this;
  }

  pause(): this {
    this.paused++;
    return this;
  }

  type(text: string): void {
    this.emit("data", Buffer.from(text));
  }

  pressCtrlC(): void {
    this.emit("data", Buffer.from([0x03]));
  }
}

function harness(
  options: { terminal?: FakeTerminal; ttyStdin?: boolean } = {},
) {
  const terminal = options.terminal ?? new FakeTerminal();
  const stdin = new FakeStdin();
  stdin.isTTY = options.ttyStdin ?? true;
  const stdout: string[] = [];
  const stderr: string[] = [];
  const streams: TerminalStreams = {
    stdout: { write: (chunk) => stdout.push(chunk) },
    stderr: { write: (chunk) => stderr.push(chunk) },
    stdin: stdin as unknown as NodeJS.ReadStream,
    isStdoutTty: false,
  };
  const device = {
    openTerminal: () => ok(terminal as unknown as V5UserProgramTerminal),
  } as unknown as V5SerialDevice;

  return { terminal, stdin, stdout, stderr, streams, device };
}

/** Yield until the session has registered its listeners. */
async function ready(terminal: FakeTerminal): Promise<void> {
  for (let i = 0; i < 100 && terminal.listenerCount === 0; i++) {
    await Bun.sleep(0);
  }
}

describe("runTerminalSession", () => {
  test("writes program output to standard output only", async () => {
    const { terminal, stdin, stdout, stderr, streams, device } = harness();

    const session = runTerminalSession(device, { streams });
    await ready(terminal);
    terminal.emitText("robot online\n");
    stdin.pressCtrlC();
    await session;

    expect(stdout.join("")).toBe("robot online\n");
    expect(stderr.join("")).toContain("ctrl-c to exit");
  });

  test("typed input is forwarded to the program", async () => {
    const { terminal, stdin, streams, device } = harness();

    const session = runTerminalSession(device, { streams });
    await ready(terminal);
    stdin.type("drive\n");
    stdin.pressCtrlC();
    await session;

    expect(terminal.written).toEqual(["drive\n"]);
  });

  test("input typed before ctrl-c in the same chunk is still delivered", async () => {
    const { terminal, stdin, streams, device } = harness();

    const session = runTerminalSession(device, { streams });
    await ready(terminal);
    stdin.emit("data", Buffer.from([...Buffer.from("go"), 0x03]));
    await session;

    expect(terminal.written).toEqual(["go"]);
  });

  test("raw mode is enabled for the session and restored afterwards", async () => {
    const { terminal, stdin, streams, device } = harness();

    const session = runTerminalSession(device, { streams });
    await ready(terminal);
    expect(stdin.isRaw).toBe(true);
    stdin.pressCtrlC();
    await session;

    expect(stdin.rawModeCalls).toEqual([true, false]);
    expect(stdin.paused).toBe(1);
  });

  test("--no-input leaves standard input alone", async () => {
    const { terminal, stdin, streams, device } = harness();

    const session = runTerminalSession(device, { streams, input: false });
    await ready(terminal);
    terminal.emitClosed();
    await session;

    expect(stdin.rawModeCalls).toEqual([]);
    expect(stdin.resumed).toBe(0);
  });

  test("the session closes the terminal and drops its listeners", async () => {
    const { terminal, stdin, streams, device } = harness();

    const session = runTerminalSession(device, { streams });
    await ready(terminal);
    stdin.pressCtrlC();
    await session;

    expect(terminal.closed).toBe(1);
    expect(terminal.listenerCount).toBe(0);
  });

  test("a partial final line is flushed when timestamps are on", async () => {
    const { terminal, stdin, stdout, streams, device } = harness();

    const session = runTerminalSession(device, {
      streams,
      timestamps: true,
      color: false,
    });
    await ready(terminal);
    terminal.emitText("no newline");
    stdin.pressCtrlC();
    await session;

    expect(stdout.join("")).toMatch(/^\d\d:\d\d:\d\d\.\d\d\d no newline\n$/);
  });

  test("--json suppresses the banner and emits records", async () => {
    const { terminal, stdin, stdout, stderr, streams, device } = harness();

    const session = runTerminalSession(device, { streams, json: true });
    await ready(terminal);
    terminal.emitText("hello");
    stdin.pressCtrlC();
    await session;

    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout.join("")).text).toBe("hello");
  });

  test("a device-ended session reports the failure that ended it", async () => {
    const { terminal, streams, device } = harness();

    const session = runTerminalSession(device, { streams });
    await ready(terminal);
    terminal.emitError(new VexProtocolError("device stopped answering"));
    terminal.emitClosed();

    await expect(session).rejects.toThrow("the terminal session ended");
  });

  test("quitting after a recovered read failure is not an error", async () => {
    const { terminal, stdin, streams, device } = harness();

    const session = runTerminalSession(device, { streams });
    await ready(terminal);
    terminal.emitError(new VexProtocolError("one bad read"));
    stdin.pressCtrlC();

    await session;
  });

  test("a device that cannot open a terminal fails the command", async () => {
    const device = {
      openTerminal: () => err(new VexNotConnectedError()),
    } as unknown as V5SerialDevice;

    await expect(runTerminalSession(device)).rejects.toThrow(
      "cannot open a terminal",
    );
  });
});

describe("terminal write failures", () => {
  test("a rejected write does not end the session", async () => {
    const terminal = new FakeTerminal();
    terminal.write = () => errAsync(new VexProtocolError("write refused"));
    const { stdin, streams, device } = harness({ terminal });

    const session = runTerminalSession(device, { streams });
    await ready(terminal);
    stdin.type("x");
    await Bun.sleep(1);
    stdin.pressCtrlC();

    await session;
  });
});
