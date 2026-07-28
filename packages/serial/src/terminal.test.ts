import { describe, expect, test } from "bun:test";
import { err, errAsync, ok, okAsync, ResultAsync } from "neverthrow";
import { AckType, UserFifoChannel, USER_FIFO_MAX_WRITE_SIZE } from "./vex";
import { V5SerialConnection } from "./v5-serial-connection";
import { V5UserProgramTerminal, openUserProgramTerminal } from "./terminal";
import {
  type DeviceBoundPacket,
  PacketEncoder,
  UserFifoH2DPacket,
  UserFifoReplyD2HPacket,
} from "./packet";
import {
  VexProtocolError,
  VexSerialError,
  type VexSerialErrorKind,
} from "./error";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Wait for `condition`, yielding to the poll loop between checks. */
async function settle(condition: () => boolean, ticks = 500): Promise<void> {
  for (let i = 0; i < ticks && !condition(); i++) await Bun.sleep(0);
}

/**
 * Extract the CDC2 payload from an encoded command. Payloads of 128 bytes or
 * more use a two-byte length field, so the payload offset is not fixed.
 */
function commandPayload(packet: DeviceBoundPacket): Uint8Array {
  const lengthByte = packet.data[6]!;
  const extended = (lengthByte & 0x80) !== 0;
  const length = extended
    ? ((lengthByte & 0x7f) << 8) + packet.data[7]!
    : lengthByte;
  const start = extended ? 8 : 7;
  return packet.data.subarray(start, start + length);
}

function userFifoReply(channel: number, body: Uint8Array): Uint8Array {
  const payloadSize = body.byteLength + 5;
  const packet = new Uint8Array(payloadSize + 4);
  packet.set([0xaa, 0x55, 86, payloadSize, 39, AckType.CDC2_ACK, channel]);
  packet.set(body, 7);
  const crc = PacketEncoder.getInstance().crcgen.crc16(
    packet.subarray(0, -2),
    0,
  );
  packet.set([crc >>> 8, crc & 0xff], packet.byteLength - 2);
  return packet;
}

describe("user FIFO packets", () => {
  test("a read request carries the channel and a zero write length", () => {
    const packet = new UserFifoH2DPacket(UserFifoChannel.STDOUT);
    // header(4) + command + extended + length + payload(2) + crc(2)
    expect(packet.data.byteLength).toBe(11);
    expect(packet.data[4]).toBe(86);
    expect(packet.data[5]).toBe(39);
    expect(Array.from(commandPayload(packet))).toEqual([
      UserFifoChannel.STDOUT,
      0,
    ]);
  });

  test("a write request carries the byte count and payload", () => {
    const packet = new UserFifoH2DPacket(
      UserFifoChannel.STDIN,
      encoder.encode("hi"),
    );
    const payload = commandPayload(packet);
    expect(payload[0]).toBe(UserFifoChannel.STDIN);
    expect(payload[1]).toBe(2);
    expect(decoder.decode(payload.subarray(2))).toBe("hi");
  });

  test("a write longer than the packet limit is rejected", () => {
    expect(
      () =>
        new UserFifoH2DPacket(
          UserFifoChannel.STDIN,
          new Uint8Array(USER_FIFO_MAX_WRITE_SIZE + 1),
        ),
    ).toThrow(`at most ${USER_FIFO_MAX_WRITE_SIZE} bytes`);
  });

  test("a reply exposes its channel and the buffered bytes", () => {
    const reply = new UserFifoReplyD2HPacket(
      userFifoReply(UserFifoChannel.STDOUT, encoder.encode("out")),
    );
    expect(reply.channel).toBe(UserFifoChannel.STDOUT);
    expect(decoder.decode(reply.buf)).toBe("out");
  });

  test("an empty reply reports no buffered bytes", () => {
    const reply = new UserFifoReplyD2HPacket(
      userFifoReply(UserFifoChannel.STDOUT, new Uint8Array()),
    );
    expect(reply.buf.byteLength).toBe(0);
  });
});

describe("connection FIFO helpers", () => {
  function connectionReplying(bodies: Uint8Array[]) {
    const connection = new V5SerialConnection({} as Serial);
    const writes: UserFifoH2DPacket[] = [];
    connection.writeDataAsync = async (packet) => {
      writes.push(packet as UserFifoH2DPacket);
      const body = bodies.shift();
      if (body === undefined) return AckType.CDC2_NACK;
      return new UserFifoReplyD2HPacket(
        userFifoReply(UserFifoChannel.STDOUT, body),
      );
    };
    return { connection, writes };
  }

  test("a read drops the padding NULs the brain appends", async () => {
    const { connection } = connectionReplying([
      Uint8Array.from([...encoder.encode("hello"), 0, 0, 0]),
    ]);

    const read = await connection.readUserFifo();

    expect(decoder.decode(read._unsafeUnwrap())).toBe("hello");
  });

  test("a read keeps NULs a program printed inside its output", async () => {
    const { connection } = connectionReplying([
      Uint8Array.from([...encoder.encode("a"), 0, ...encoder.encode("b"), 0]),
    ]);

    const read = await connection.readUserFifo();

    expect(Array.from(read._unsafeUnwrap())).toEqual([97, 0, 98]);
  });

  test("a read defaults to the program output channel", async () => {
    const { connection, writes } = connectionReplying([new Uint8Array()]);

    await connection.readUserFifo();

    expect(commandPayload(writes[0]!)[0]).toBe(UserFifoChannel.STDOUT);
  });

  test("a write is split across packets at the protocol limit", async () => {
    const payload = new Uint8Array(USER_FIFO_MAX_WRITE_SIZE + 10).fill(65);
    const { connection, writes } = connectionReplying([
      new Uint8Array(),
      new Uint8Array(),
    ]);

    const written = await connection.writeUserFifo(payload);

    expect(written._unsafeUnwrap()).toBe(payload.byteLength);
    expect(writes).toHaveLength(2);
    expect(commandPayload(writes[0]!)[1]).toBe(USER_FIFO_MAX_WRITE_SIZE);
    expect(commandPayload(writes[1]!)[1]).toBe(10);
    expect(commandPayload(writes[0]!)[0]).toBe(UserFifoChannel.STDIN);
  });

  test("a write reports the failing chunk instead of a short count", async () => {
    const payload = new Uint8Array(USER_FIFO_MAX_WRITE_SIZE * 2).fill(65);
    // Only the first chunk gets a reply; the second is NACKed.
    const { connection, writes } = connectionReplying([new Uint8Array()]);

    const written = await connection.writeUserFifo(payload);

    expect(written._unsafeUnwrapErr()).toBeInstanceOf(VexProtocolError);
    expect(writes).toHaveLength(2);
  });

  test("a string write is encoded as UTF-8", async () => {
    const { connection, writes } = connectionReplying([new Uint8Array()]);

    await connection.writeUserFifo("é");

    expect(commandPayload(writes[0]!)[1]).toBe(2);
  });
});

/** A connection stub that replays a scripted sequence of FIFO reads. */
class ScriptedConnection {
  isConnected = true;
  readonly reads: Array<Uint8Array | VexSerialError> = [];
  readonly writes: Array<{ channel: UserFifoChannel; text: string }> = [];
  readCount = 0;
  readBarrier: Promise<void> | undefined;

  readUserFifo(
    channel: UserFifoChannel,
  ): ResultAsync<Uint8Array, VexSerialError> {
    this.readCount++;
    const next = this.reads.shift();
    if (this.readBarrier !== undefined) {
      return new ResultAsync(
        this.readBarrier.then(() =>
          next instanceof VexSerialError
            ? err(next)
            : ok(next ?? new Uint8Array()),
        ),
      );
    }
    if (next === undefined) return okAsync(new Uint8Array());
    if (next instanceof VexSerialError) return errAsync(next);
    expect(channel).toBe(UserFifoChannel.STDOUT);
    return okAsync(next);
  }

  writeUserFifo(
    data: Uint8Array | string,
    channel: UserFifoChannel,
  ): ResultAsync<number, VexSerialError> {
    const bytes = typeof data === "string" ? encoder.encode(data) : data;
    this.writes.push({ channel, text: decoder.decode(bytes) });
    return okAsync(bytes.byteLength);
  }

  asConnection(): V5SerialConnection {
    return this as unknown as V5SerialConnection;
  }
}

function serialError(kind: VexSerialErrorKind = "protocol"): VexSerialError {
  return new VexSerialError(kind, "device is busy");
}

describe("terminal sessions", () => {
  test("buffered output reaches listeners as bytes and as text", async () => {
    const fake = new ScriptedConnection();
    fake.reads.push(encoder.encode("hello "), encoder.encode("world\n"));
    const terminal = new V5UserProgramTerminal(fake.asConnection(), {
      idlePollIntervalMs: 1,
    });
    const chunks: Uint8Array[] = [];
    let text = "";
    terminal.on("data", (chunk) => chunks.push(chunk));
    terminal.on("text", (value) => (text += value));

    terminal.start();
    await settle(() => text.includes("world"));
    await terminal.close();

    expect(chunks).toHaveLength(2);
    expect(text).toBe("hello world\n");
  });

  test("a character split across two reads is emitted once, whole", async () => {
    const fake = new ScriptedConnection();
    const bytes = encoder.encode("é");
    fake.reads.push(bytes.subarray(0, 1), bytes.subarray(1));
    const terminal = new V5UserProgramTerminal(fake.asConnection(), {
      idlePollIntervalMs: 1,
    });
    const emitted: string[] = [];
    terminal.on("text", (value) => emitted.push(value));

    terminal.start();
    await settle(() => emitted.join("") === "é");
    await terminal.close();

    expect(emitted.join("")).toBe("é");
  });

  test("closing flushes an incomplete UTF-8 sequence", async () => {
    const fake = new ScriptedConnection();
    fake.reads.push(Uint8Array.of(0xc3));
    const terminal = new V5UserProgramTerminal(fake.asConnection(), {
      idlePollIntervalMs: 10_000,
    });
    let text = "";
    terminal.on("text", (value) => (text += value));

    terminal.start();
    await settle(() => fake.readCount >= 2);
    await terminal.close();

    expect(text).toBe("\ufffd");
  });

  test("an empty channel does not emit an empty chunk", async () => {
    const fake = new ScriptedConnection();
    const terminal = new V5UserProgramTerminal(fake.asConnection(), {
      idlePollIntervalMs: 1,
    });
    let emitted = 0;
    terminal.on("data", () => emitted++);

    terminal.start();
    await settle(() => fake.readCount >= 3);
    await terminal.close();

    expect(emitted).toBe(0);
  });

  test("a transient read failure is reported but keeps the session open", async () => {
    const fake = new ScriptedConnection();
    fake.reads.push(serialError(), encoder.encode("after"));
    const terminal = new V5UserProgramTerminal(fake.asConnection(), {
      idlePollIntervalMs: 1,
    });
    const errors: VexSerialError[] = [];
    let text = "";
    terminal.on("error", (error) => errors.push(error));
    terminal.on("text", (value) => (text += value));

    terminal.start();
    await settle(() => text === "after");
    expect(terminal.isRunning).toBe(true);
    await terminal.close();

    expect(errors).toHaveLength(1);
    expect(text).toBe("after");
  });

  test("repeated read failures close the session", async () => {
    const fake = new ScriptedConnection();
    for (let i = 0; i < 5; i++) fake.reads.push(serialError());
    const terminal = new V5UserProgramTerminal(fake.asConnection(), {
      idlePollIntervalMs: 0,
      maxConsecutiveErrors: 3,
    });
    let closed = 0;
    const errors: VexSerialError[] = [];
    terminal.on("error", (error) => errors.push(error));
    terminal.on("closed", () => closed++);

    terminal.start();
    await settle(() => closed > 0);

    expect(errors).toHaveLength(3);
    expect(closed).toBe(1);
    expect(terminal.isRunning).toBe(false);
  });

  test("a lost connection closes the session with a not-connected error", async () => {
    const fake = new ScriptedConnection();
    const terminal = new V5UserProgramTerminal(fake.asConnection(), {
      idlePollIntervalMs: 1,
    });
    const errors: VexSerialError[] = [];
    terminal.on("error", (error) => errors.push(error));

    terminal.start();
    await settle(() => fake.readCount >= 1);
    fake.isConnected = false;
    await settle(() => !terminal.isRunning);

    expect(errors.at(-1)?.kind).toBe("not-connected");
  });

  test("closing stops polling and reports closed exactly once", async () => {
    const fake = new ScriptedConnection();
    const terminal = new V5UserProgramTerminal(fake.asConnection(), {
      idlePollIntervalMs: 10_000,
    });
    let closed = 0;
    terminal.on("closed", () => closed++);

    terminal.start();
    await settle(() => fake.readCount >= 1);
    // The poll loop is parked in its idle wait; close must interrupt it
    // rather than wait out the full interval.
    await terminal.close();
    const readsAtClose = fake.readCount;
    await Bun.sleep(5);

    expect(closed).toBe(1);
    expect(fake.readCount).toBe(readsAtClose);
    expect(terminal.isRunning).toBe(false);
  });

  test("closing twice is safe", async () => {
    const fake = new ScriptedConnection();
    const terminal = new V5UserProgramTerminal(fake.asConnection(), {
      idlePollIntervalMs: 1,
    });
    let closed = 0;
    terminal.on("closed", () => closed++);

    terminal.start();
    await terminal.close();
    await terminal.close();

    expect(closed).toBe(1);
  });

  test("start does not create another poll while close is in flight", async () => {
    const fake = new ScriptedConnection();
    let releaseRead = (): void => {};
    fake.readBarrier = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const terminal = new V5UserProgramTerminal(fake.asConnection(), {
      idlePollIntervalMs: 10_000,
    });

    terminal.start();
    await settle(() => fake.readCount === 1);
    const closing = terminal.close();
    terminal.start();
    releaseRead();
    await closing;

    expect(fake.readCount).toBe(1);
    expect(terminal.isRunning).toBe(false);
  });

  test("starting an already-running session does not double-poll", async () => {
    const fake = new ScriptedConnection();
    const terminal = new V5UserProgramTerminal(fake.asConnection(), {
      idlePollIntervalMs: 10_000,
    });

    terminal.start();
    terminal.start();
    await settle(() => fake.readCount >= 1);
    await terminal.close();

    expect(fake.readCount).toBe(1);
  });

  test("a throwing listener does not stop the poll loop", async () => {
    const fake = new ScriptedConnection();
    fake.reads.push(encoder.encode("one"), encoder.encode("two"));
    const terminal = new V5UserProgramTerminal(fake.asConnection(), {
      idlePollIntervalMs: 1,
    });
    const seen: string[] = [];
    terminal.on("data", () => {
      throw new Error("listener failed");
    });
    terminal.on("text", (value) => seen.push(value));

    terminal.start();
    await settle(() => seen.length === 2);
    await terminal.close();

    expect(seen).toEqual(["one", "two"]);
  });

  test("input is written to the program's standard input channel", async () => {
    const fake = new ScriptedConnection();
    const terminal = new V5UserProgramTerminal(fake.asConnection());

    const written = await terminal.write("go\n");

    expect(written._unsafeUnwrap()).toBe(3);
    expect(fake.writes).toEqual([
      { channel: UserFifoChannel.STDIN, text: "go\n" },
    ]);
  });

  test.each([-1, Number.NaN])(
    "rejects an invalid idle interval %p",
    (idlePollIntervalMs) => {
      expect(
        () =>
          new V5UserProgramTerminal(new ScriptedConnection().asConnection(), {
            idlePollIntervalMs,
          }),
      ).toThrow("finite, non-negative");
    },
  );

  test.each([0, 1.5])(
    "rejects an invalid error budget %p",
    (maxConsecutiveErrors) => {
      expect(
        () =>
          new V5UserProgramTerminal(new ScriptedConnection().asConnection(), {
            maxConsecutiveErrors,
          }),
      ).toThrow("positive safe integer");
    },
  );
});

describe("opening a terminal", () => {
  test("a disconnected connection cannot open a session", () => {
    const fake = new ScriptedConnection();
    fake.isConnected = false;

    const result = openUserProgramTerminal(fake.asConnection());

    expect(result._unsafeUnwrapErr().kind).toBe("not-connected");
  });

  test("a missing connection cannot open a session", () => {
    expect(openUserProgramTerminal(undefined)._unsafeUnwrapErr().kind).toBe(
      "not-connected",
    );
  });

  test("a connected connection starts polling immediately", async () => {
    const fake = new ScriptedConnection();

    const terminal = openUserProgramTerminal(fake.asConnection(), {
      idlePollIntervalMs: 10_000,
    })._unsafeUnwrap();
    await settle(() => fake.readCount >= 1);
    await terminal.close();

    expect(fake.readCount).toBe(1);
  });
});
