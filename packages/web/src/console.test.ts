import { describe, expect, test } from "bun:test";
import { err, errAsync, ok, okAsync, type ResultAsync } from "neverthrow";
import type { V5UserProgramTerminal, VexSerialError } from "@v5x/serial";
import {
  createV5Console,
  trimConsoleBuffer,
  type V5ConsoleDeviceSource,
} from "./console.js";

class FakeSerialError extends Error {
  readonly kind = "protocol";
}

function serialError(message: string): VexSerialError {
  return new FakeSerialError(message) as unknown as VexSerialError;
}

/** A serial terminal stand-in whose output the test drives directly. */
class FakeTerminal {
  private readonly textListeners = new Set<(value: string) => void>();
  private readonly errorListeners = new Set<(value: VexSerialError) => void>();
  private readonly closedListeners = new Set<() => void>();
  readonly written: string[] = [];
  closed = 0;
  writeResult: ResultAsync<number, VexSerialError> = okAsync(0);

  on(event: string, listener: (value: string) => void): void {
    if (event === "text") this.textListeners.add(listener);
    if (event === "error") {
      this.errorListeners.add(
        listener as unknown as (value: VexSerialError) => void,
      );
    }
    if (event === "closed") this.closedListeners.add(listener as () => void);
  }

  remove(event: string, listener: (value: string) => void): void {
    if (event === "text") this.textListeners.delete(listener);
    if (event === "error") {
      this.errorListeners.delete(
        listener as unknown as (value: VexSerialError) => void,
      );
    }
    if (event === "closed") this.closedListeners.delete(listener as () => void);
  }

  write(data: string | Uint8Array): ResultAsync<number, VexSerialError> {
    this.written.push(typeof data === "string" ? data : data.toString());
    return this.writeResult;
  }

  async close(): Promise<void> {
    this.closed++;
  }

  print(text: string): void {
    for (const listener of this.textListeners) listener(text);
  }

  endSession(): void {
    for (const listener of this.closedListeners) listener();
  }

  failSession(error: VexSerialError): void {
    for (const listener of this.errorListeners) listener(error);
    this.endSession();
  }

  get listenerCount(): number {
    return (
      this.textListeners.size +
      this.errorListeners.size +
      this.closedListeners.size
    );
  }

  asTerminal(): V5UserProgramTerminal {
    return this as unknown as V5UserProgramTerminal;
  }
}

function deviceWith(terminal: FakeTerminal): V5ConsoleDeviceSource {
  return { openTerminal: () => ok(terminal.asTerminal()) };
}

describe("trimConsoleBuffer", () => {
  test("keeps short buffers untouched", () => {
    expect(trimConsoleBuffer("abc", 10)).toBe("abc");
  });

  test("drops the partial line left at the front after trimming", () => {
    expect(trimConsoleBuffer("first\nsecond\nthird\n", 14)).toBe(
      "second\nthird\n",
    );
  });

  test("falls back to a hard cut when the tail has no line break", () => {
    expect(trimConsoleBuffer("abcdefgh", 3)).toBe("fgh");
  });

  test("keeps a trailing newline rather than emptying the buffer", () => {
    expect(trimConsoleBuffer("abcdefgh\n", 3)).toBe("gh\n");
  });
});

describe("console store", () => {
  test("starts idle with an empty buffer", () => {
    const console = createV5Console(() => null);

    expect(console.getSnapshot()).toMatchObject({
      status: "idle",
      streaming: false,
      text: "",
      chunks: 0,
      truncated: false,
      error: null,
    });
  });

  test("streams program output into the buffer", async () => {
    const terminal = new FakeTerminal();
    const console = createV5Console(() => deviceWith(terminal));

    expect(await console.start()).toBe(true);
    terminal.print("hello ");
    terminal.print("world\n");
    await Bun.sleep(20);

    expect(console.getSnapshot()).toMatchObject({
      status: "streaming",
      streaming: true,
      text: "hello world\n",
      chunks: 2,
    });
  });

  test("coalesces rapid chunk notifications", async () => {
    const terminal = new FakeTerminal();
    const console = createV5Console(() => deviceWith(terminal));
    let notifications = 0;
    console.subscribe(() => notifications++);

    await console.start();
    const afterStart = notifications;
    terminal.print("a");
    terminal.print("b");
    await Bun.sleep(20);

    expect(notifications - afterStart).toBe(1);
  });

  test("an empty chunk does not publish a new snapshot", async () => {
    const terminal = new FakeTerminal();
    const console = createV5Console(() => deviceWith(terminal));
    await console.start();
    const before = console.getSnapshot();

    terminal.print("");

    expect(console.getSnapshot()).toBe(before);
  });

  test("output beyond the buffer limit is dropped from the front", async () => {
    const terminal = new FakeTerminal();
    const console = createV5Console(() => deviceWith(terminal), {
      maxCharacters: 12,
    });
    await console.start();

    terminal.print("one\ntwo\nthree\nfour\n");
    await Bun.sleep(20);

    const snapshot = console.getSnapshot();
    expect(snapshot.text).toBe("three\nfour\n");
    expect(snapshot.truncated).toBe(true);
  });

  test("starting twice reuses the running session", async () => {
    const terminal = new FakeTerminal();
    let opens = 0;
    const console = createV5Console(() => ({
      openTerminal: () => {
        opens++;
        return ok(terminal.asTerminal());
      },
    }));

    expect(await Promise.all([console.start(), console.start()])).toEqual([
      true,
      true,
    ]);
    expect(await console.start()).toBe(true);

    expect(opens).toBe(1);
  });

  test("stopping keeps the buffer and releases the session", async () => {
    const terminal = new FakeTerminal();
    const console = createV5Console(() => deviceWith(terminal));
    await console.start();
    terminal.print("kept\n");

    await console.stop();

    expect(console.getSnapshot()).toMatchObject({
      status: "idle",
      streaming: false,
      text: "kept\n",
    });
    expect(terminal.closed).toBe(1);
    expect(terminal.listenerCount).toBe(0);
  });

  test("output after stopping is ignored", async () => {
    const terminal = new FakeTerminal();
    const console = createV5Console(() => deviceWith(terminal));
    await console.start();
    await console.stop();

    terminal.print("late");

    expect(console.getSnapshot().text).toBe("");
  });

  test("a session the device ends returns the console to idle", async () => {
    const terminal = new FakeTerminal();
    const console = createV5Console(() => deviceWith(terminal));
    await console.start();

    terminal.endSession();
    await Bun.sleep(0);

    expect(console.getSnapshot().streaming).toBe(false);
  });

  test("a session failure preserves the serial error that closed it", async () => {
    const terminal = new FakeTerminal();
    const console = createV5Console(() => deviceWith(terminal));
    await console.start();

    terminal.failSession(serialError("device stopped responding"));
    await Bun.sleep(0);

    expect(console.getSnapshot()).toMatchObject({
      status: "error",
      streaming: false,
    });
    expect(console.getSnapshot().error?.message).toBe(
      "device stopped responding",
    );
    expect(terminal.listenerCount).toBe(0);
  });

  test("clearing empties the buffer without stopping the stream", async () => {
    const terminal = new FakeTerminal();
    const console = createV5Console(() => deviceWith(terminal));
    await console.start();
    terminal.print("old\n");

    console.clear();
    terminal.print("new\n");
    await Bun.sleep(20);

    expect(console.getSnapshot()).toMatchObject({
      text: "new\n",
      streaming: true,
      truncated: false,
    });
  });

  test("clearing an empty buffer publishes nothing", () => {
    const console = createV5Console(() => null);
    const before = console.getSnapshot();

    console.clear();

    expect(console.getSnapshot()).toBe(before);
  });

  test("starting without a connected device reports an error", async () => {
    const console = createV5Console(() => null);

    expect(await console.start()).toBe(false);
    expect(console.getSnapshot().status).toBe("error");
    expect(console.getSnapshot().error?.message).toContain("Connect a V5");
  });

  test("a refused terminal is reported with the device's reason", async () => {
    const console = createV5Console(() => ({
      openTerminal: () => err(serialError("no connection to a V5 device")),
    }));

    expect(await console.start()).toBe(false);
    expect(console.getSnapshot().error?.message).toBe(
      "no connection to a V5 device",
    );
  });

  test("a thrown open is reported instead of escaping", async () => {
    const console = createV5Console(() => ({
      openTerminal: () => {
        throw new Error("device exploded");
      },
    }));

    expect(await console.start()).toBe(false);
    expect(console.getSnapshot().error?.message).toBe("device exploded");
  });

  test("input is sent to the running program", async () => {
    const terminal = new FakeTerminal();
    const console = createV5Console(() => deviceWith(terminal));
    await console.start();

    expect(await console.send("go\n")).toBe(true);
    expect(terminal.written).toEqual(["go\n"]);
  });

  test("input without a running session is refused", async () => {
    const console = createV5Console(() => null);

    expect(await console.send("go\n")).toBe(false);
  });

  test("a failed write is reported without ending the stream", async () => {
    const terminal = new FakeTerminal();
    terminal.writeResult = errAsync(serialError("write refused"));
    const console = createV5Console(() => deviceWith(terminal));
    await console.start();

    expect(await console.send("go\n")).toBe(false);
    expect(console.getSnapshot().error?.message).toBe("write refused");
    expect(console.getSnapshot().streaming).toBe(true);
  });

  test.each([0, -1, 1.5])("rejects a %p character buffer", (maxCharacters) => {
    expect(() => createV5Console(() => null, { maxCharacters })).toThrow(
      "positive safe integer",
    );
  });
});
