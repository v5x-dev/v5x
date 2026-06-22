import { describe, expect, test } from "bun:test";
import { AckType } from "./Vex";
import { V5SerialConnection } from "./VexConnection";
import { SelectDashReplyD2HPacket } from "./VexPacket";

function connectionWithWriter() {
  const connection = new V5SerialConnection({} as Serial);
  connection.writer = {
    write: async () => {},
    close: async () => {},
    releaseLock: () => {},
  } as unknown as WritableStreamDefaultWriter<unknown>;
  return connection;
}

describe("request callbacks", () => {
  test("a timeout resolves its own concurrent request", async () => {
    const connection = connectionWithWriter();
    const first = connection.writeDataAsync(new Uint8Array([1]), 100);
    const second = connection.writeDataAsync(new Uint8Array([2]), 10);

    expect(await second).toBe(AckType.TIMEOUT);
    expect(connection.callbacksQueue).toHaveLength(1);
    await connection.close();
    expect(await first).toBe(AckType.CDC2_NACK);
  });

  test("write failures clear only their callback and timer", async () => {
    const connection = new V5SerialConnection({} as Serial);
    connection.writer = {
      write: async () => {
        throw new Error("write failed");
      },
      releaseLock: () => {},
    } as unknown as WritableStreamDefaultWriter<unknown>;

    expect(await connection.writeDataAsync(new Uint8Array([1]), 100)).toBe(
      AckType.WRITE_ERROR,
    );
    expect(connection.callbacksQueue).toHaveLength(0);
  });
});

test("open discovers unopened authorized ports and emits connected when ready", async () => {
  let readable: ReadableStream<Uint8Array> | null = null;
  let writable: WritableStream<Uint8Array> | null = null;
  const port = {
    get readable() {
      return readable;
    },
    get writable() {
      return writable;
    },
    getInfo: () => ({ usbVendorId: 10376, usbProductId: 1281 }),
    open: async () => {
      readable = new ReadableStream<Uint8Array>();
      writable = new WritableStream<Uint8Array>();
    },
    close: async () => {
      readable = null;
      writable = null;
    },
    addEventListener: () => {},
  } as unknown as SerialPort;
  const serial = {
    getPorts: async () => [port],
  } as unknown as Serial;
  const connection = new V5SerialConnection(serial);
  let connectedState = false;
  connection.on("connected", () => {
    connectedState = connection.isConnected;
  });

  expect(await connection.open(0, false)).toBe(true);
  expect(connectedState).toBe(true);
  await connection.close();
});

test("openScreen accepts its matching reply packet", async () => {
  const connection = new V5SerialConnection({} as Serial);
  const reply = Object.create(
    SelectDashReplyD2HPacket.prototype,
  ) as SelectDashReplyD2HPacket;
  connection.writeDataAsync = async () => reply;

  expect(await connection.openScreen(0, 1)).toBe(reply);
});
