import { describe, expect, test } from "bun:test";
import { okAsync } from "neverthrow";
import {
  AckType,
  FileDownloadTarget,
  FileVendor,
  USER_FLASH_USR_CODE_START,
} from "./Vex";
import { V5SerialConnection } from "./VexConnection";
import { convertScreenCapture } from "./VexScreenCapture";
import {
  type HostBoundPacket,
  EraseFileH2DPacket,
  EraseFileReplyD2HPacket,
  ExitFileTransferH2DPacket,
  ExitFileTransferReplyD2HPacket,
  FileClearUpH2DPacket,
  FileClearUpReplyD2HPacket,
  InitFileTransferH2DPacket,
  InitFileTransferReplyD2HPacket,
  LinkFileH2DPacket,
  LinkFileReplyD2HPacket,
  PacketEncoder,
  ReadKeyValueH2DPacket,
  ReadKeyValueReplyD2HPacket,
  ReadFileReplyD2HPacket,
  ScreenCaptureH2DPacket,
  ScreenCaptureReplyD2HPacket,
  SelectDashReplyD2HPacket,
  WriteFileH2DPacket,
  WriteFileReplyD2HPacket,
} from "./VexPacket";
import { ProgramIniConfig } from "./VexIniConfig";
import { deferred, protocolReply } from "./protocol.test-support";
import { runPacketReader } from "./PacketReader";
import { ReaderClosedError } from "./ReaderClosedError";

function connectionWithWriter() {
  const connection = new V5SerialConnection({} as Serial);
  connection.writer = {
    write: async () => {},
    close: async () => {},
    releaseLock: () => {},
  } as unknown as WritableStreamDefaultWriter<unknown>;
  return connection;
}

test.each([0, -1, 1.5, Number.NaN])(
  "rejects invalid maximum file download size %p",
  (maxFileDownloadBytes) => {
    expect(
      () => new V5SerialConnection({} as Serial, { maxFileDownloadBytes }),
    ).toThrow("positive safe integer");
  },
);

function query1Reply(ack: AckType): Uint8Array {
  return Uint8Array.of(0xaa, 0x55, 33, 8, 0, ack, 1, 2, 0, 0, 3, 4);
}

function cdc2Reply(
  command: number,
  extendedCommand: number,
  ack: AckType,
  body: Uint8Array = new Uint8Array(),
): Uint8Array {
  const payloadSize = body.byteLength + 4;
  const packet = new Uint8Array(payloadSize + 4);
  packet.set([0xaa, 0x55, command, payloadSize, extendedCommand, ack]);
  packet.set(body, 6);
  const crc = PacketEncoder.getInstance().crcgen.crc16(
    packet.subarray(0, -2),
    0,
  );
  packet.set([crc >>> 8, crc & 0xff], packet.byteLength - 2);
  return packet;
}

describe("request callbacks", () => {
  test("serializes same-command requests so replies cannot be swapped", async () => {
    class ReadableConnection extends V5SerialConnection {
      start(): Promise<void> {
        return this.startReader();
      }
    }

    let replyStream: ReadableStreamDefaultController<Uint8Array> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        replyStream = controller;
      },
    });
    const writes: Uint8Array[] = [];
    const connection = new ReadableConnection({} as Serial);
    connection.reader = stream.getReader();
    connection.writer = {
      write: async (data: Uint8Array) => {
        writes.push(data);
      },
      close: async () => {},
      releaseLock: () => {},
    } as unknown as WritableStreamDefaultWriter<unknown>;

    const first = connection.request(
      new ReadKeyValueH2DPacket("first"),
      ReadKeyValueReplyD2HPacket,
    );
    const second = connection.request(
      new ReadKeyValueH2DPacket("second"),
      ReadKeyValueReplyD2HPacket,
    );
    const reading = connection.start();

    for (let i = 0; i < 100 && writes.length === 0; i++) await Bun.sleep(0);
    expect(writes).toHaveLength(1);

    // Only the first request is in flight, so this reply cannot silently be
    // delivered to the second request even if the device would reply out of
    // order when both were transmitted together.
    replyStream?.enqueue(
      cdc2Reply(86, 46, AckType.CDC2_ACK, new TextEncoder().encode("first\0")),
    );
    expect((await first)._unsafeUnwrap().value).toBe("first");

    for (let i = 0; i < 100 && writes.length === 1; i++) await Bun.sleep(0);
    expect(writes).toHaveLength(2);
    replyStream?.enqueue(
      cdc2Reply(86, 46, AckType.CDC2_ACK, new TextEncoder().encode("second\0")),
    );
    expect((await second)._unsafeUnwrap().value).toBe("second");

    await connection.close();
    await reading;
  });

  test("releases same-command serialization after a timeout", async () => {
    const connection = connectionWithWriter();
    const writes: Uint8Array[] = [];
    connection.writer = {
      write: async (data: Uint8Array) => {
        writes.push(data);
      },
      close: async () => {},
      releaseLock: () => {},
    } as unknown as WritableStreamDefaultWriter<unknown>;

    const first = connection.writeDataAsync(
      new ReadKeyValueH2DPacket("first"),
      1,
    );
    const second = connection.writeDataAsync(
      new ReadKeyValueH2DPacket("second"),
      100,
    );

    expect(await first).toBe(AckType.TIMEOUT);
    for (let i = 0; i < 100 && writes.length === 1; i++) await Bun.sleep(0);
    expect(writes).toHaveLength(2);

    await connection.close();
    expect(await second).toBe(AckType.NOT_CONNECTED);
  });

  test("releases same-command serialization after a write failure", async () => {
    const connection = connectionWithWriter();
    let attempts = 0;
    connection.writer = {
      write: async () => {
        attempts++;
        if (attempts === 1) throw new Error("write failed");
      },
      close: async () => {},
      releaseLock: () => {},
    } as unknown as WritableStreamDefaultWriter<unknown>;

    const first = connection.writeDataAsync(
      new ReadKeyValueH2DPacket("first"),
      100,
    );
    const second = connection.writeDataAsync(
      new ReadKeyValueH2DPacket("second"),
      100,
    );

    expect(await first).toBe(AckType.WRITE_ERROR);
    for (let i = 0; i < 100 && attempts === 1; i++) await Bun.sleep(0);
    expect(attempts).toBe(2);

    await connection.close();
    expect(await second).toBe(AckType.NOT_CONNECTED);
  });

  test("keeps requests with distinct reply IDs concurrent", async () => {
    const connection = connectionWithWriter();
    const writes: Uint8Array[] = [];
    connection.writer = {
      write: async (data: Uint8Array) => {
        writes.push(data);
      },
      close: async () => {},
      releaseLock: () => {},
    } as unknown as WritableStreamDefaultWriter<unknown>;

    const keyValue = connection.writeDataAsync(
      new ReadKeyValueH2DPacket("key"),
      100,
    );
    const clearUp = connection.writeDataAsync(
      new FileClearUpH2DPacket(FileVendor.USER),
      100,
    );

    for (let i = 0; i < 100 && writes.length < 2; i++) await Bun.sleep(0);
    expect(writes).toHaveLength(2);

    await connection.close();
    expect(await keyValue).toBe(AckType.NOT_CONNECTED);
    expect(await clearUp).toBe(AckType.NOT_CONNECTED);
  });

  test("close releases queued same-command requests", async () => {
    const connection = connectionWithWriter();
    const writes: Uint8Array[] = [];
    connection.writer = {
      write: async (data: Uint8Array) => {
        writes.push(data);
      },
      close: async () => {},
      releaseLock: () => {},
    } as unknown as WritableStreamDefaultWriter<unknown>;

    const first = connection.writeDataAsync(
      new ReadKeyValueH2DPacket("first"),
      100,
    );
    const second = connection.writeDataAsync(
      new ReadKeyValueH2DPacket("second"),
      100,
    );

    for (let i = 0; i < 100 && writes.length === 0; i++) await Bun.sleep(0);
    expect(writes).toHaveLength(1);
    await connection.close();

    expect(await first).toBe(AckType.NOT_CONNECTED);
    expect(await second).toBe(AckType.NOT_CONNECTED);
    expect(writes).toHaveLength(1);
  });

  test("a timeout resolves its own concurrent request", async () => {
    const connection = connectionWithWriter();
    const first = connection.writeDataAsync(new Uint8Array([1]), 100);
    const second = connection.writeDataAsync(new Uint8Array([2]), 10);

    expect(await second).toBe(AckType.TIMEOUT);
    expect(connection.callbacksQueue).toHaveLength(1);
    await connection.close();
    expect(await first).toBe(AckType.NOT_CONNECTED);
  });

  test("a write without an open connection has a distinct result", async () => {
    const connection = new V5SerialConnection({} as Serial);

    expect(await connection.writeDataAsync(new Uint8Array([1]))).toBe(
      AckType.NOT_CONNECTED,
    );
  });

  test("a typed request without an open connection reports not connected", async () => {
    const connection = new V5SerialConnection({} as Serial);

    const error = (await connection.query1())._unsafeUnwrapErr();
    expect(error.kind).toBe("not-connected");
    expect(error.ackType).toBeUndefined();
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
    removeEventListener: () => {},
  } as unknown as SerialPort;
  const serial = {
    getPorts: async () => [port],
  } as unknown as Serial;
  const connection = new V5SerialConnection(serial);
  let connectedState = false;
  connection.on("connected", () => {
    connectedState = connection.isConnected;
  });

  expect((await connection.open(0, false))._unsafeUnwrap()).toBe("opened");
  expect(connectedState).toBe(true);
  await connection.close();
});

test("concurrent opens join one transport attempt", async () => {
  const portOpened = deferred<void>();
  let getPortsCalls = 0;
  let openCalls = 0;
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
      openCalls++;
      await portOpened.promise;
      readable = new ReadableStream<Uint8Array>();
      writable = new WritableStream<Uint8Array>();
    },
    close: async () => {
      readable = null;
      writable = null;
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as SerialPort;
  const connection = new V5SerialConnection({
    getPorts: async () => {
      getPortsCalls++;
      return [port];
    },
  } as unknown as Serial);

  const first = connection.open(0, false);
  const second = connection.open(0, false);
  await Bun.sleep(0);
  expect(getPortsCalls).toBe(1);
  expect(openCalls).toBe(1);

  portOpened.resolve();
  expect((await first)._unsafeUnwrap()).toBe("opened");
  expect((await second)._unsafeUnwrap()).toBe("opened");
  expect(connection.isConnected).toBe(true);
  await connection.close();
});

test("a failed open clears its shared attempt so a later open can retry", async () => {
  let attempts = 0;
  let closes = 0;
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
      attempts++;
      if (attempts === 1) throw new Error("first open failed");
      readable = new ReadableStream<Uint8Array>();
      writable = new WritableStream<Uint8Array>();
    },
    close: async () => {
      closes++;
      readable = null;
      writable = null;
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as SerialPort;
  const connection = new V5SerialConnection({
    getPorts: async () => [port],
  } as unknown as Serial);

  const first = connection.open(0, false);
  const joining = connection.open(0, false);
  expect((await first).isErr()).toBe(true);
  expect((await joining).isErr()).toBe(true);
  expect(attempts).toBe(1);
  expect(closes).toBe(1);

  expect((await connection.open(0, false))._unsafeUnwrap()).toBe("opened");
  expect(attempts).toBe(2);
  await connection.close();
});

test("close waits for a pending open and cleans up its transport", async () => {
  const portOpened = deferred<void>();
  let closeCalls = 0;
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
      await portOpened.promise;
      readable = new ReadableStream<Uint8Array>();
      writable = new WritableStream<Uint8Array>();
    },
    close: async () => {
      closeCalls++;
      readable = null;
      writable = null;
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as SerialPort;
  const connection = new V5SerialConnection({
    getPorts: async () => [port],
  } as unknown as Serial);

  const opening = connection.open(0, false);
  await Bun.sleep(0);
  const closing = connection.close();
  portOpened.resolve();

  expect((await opening)._unsafeUnwrap()).toBe("opened");
  await closing;
  expect(closeCalls).toBe(1);
  expect(connection.isConnected).toBe(false);
});

test("throwing lifecycle listeners do not interrupt a connection", async () => {
  class TestConnection extends V5SerialConnection {
    warn(): void {
      this.reportWarning("listener isolation test");
    }
  }

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
    removeEventListener: () => {},
  } as unknown as SerialPort;
  const connection = new TestConnection({
    getPorts: async () => [port],
  } as unknown as Serial);

  connection.on("connected", () => {
    throw new Error("connected listener failed");
  });
  connection.on("disconnected", () => {
    throw new Error("disconnected listener failed");
  });
  connection.on("warning", () => {
    throw new Error("warning listener failed");
  });

  expect((await connection.open(0, false))._unsafeUnwrap()).toBe("opened");
  expect(connection.isConnected).toBe(true);
  expect(() => connection.warn()).not.toThrow();
  expect(connection.isConnected).toBe(true);
  await expect(connection.close()).resolves.toBeUndefined();
});

test("openScreen accepts its matching reply packet", async () => {
  const connection = new V5SerialConnection({} as Serial);
  const reply = Object.create(
    SelectDashReplyD2HPacket.prototype,
  ) as SelectDashReplyD2HPacket;
  connection.writeDataAsync = async () => reply;

  expect((await connection.openScreen(0, 1))._unsafeUnwrap()).toBe(reply);
});

function initReply(windowSize: number, fileSize: number) {
  const reply = Object.create(
    InitFileTransferReplyD2HPacket.prototype,
  ) as InitFileTransferReplyD2HPacket;
  reply.windowSize = windowSize;
  reply.fileSize = fileSize;
  return reply;
}

function readReply(addr: number, bytes: number[]) {
  const reply = Object.create(
    ReadFileReplyD2HPacket.prototype,
  ) as ReadFileReplyD2HPacket;
  reply.addr = addr;
  reply.length = bytes.length;
  reply.buf = new Uint8Array(bytes);
  return reply;
}

test("downloads accept short chunks, report completion, and exit", async () => {
  const connection = new V5SerialConnection({} as Serial);
  const writes: object[] = [];
  const replies = [
    initReply(4, 5),
    readReply(USER_FLASH_USR_CODE_START, [1, 2]),
    readReply(USER_FLASH_USR_CODE_START + 2, [3, 4, 5]),
    Object.create(
      ExitFileTransferReplyD2HPacket.prototype,
    ) as ExitFileTransferReplyD2HPacket,
  ];
  connection.writeDataAsync = async (packet) => {
    writes.push(packet);
    return replies.shift() ?? AckType.CDC2_NACK;
  };
  const progress: Array<[number, number]> = [];

  const result = await connection.downloadFileToHost(
    { filename: "test.bin", vendor: FileVendor.USER },
    FileDownloadTarget.FILE_TARGET_QSPI,
    (current, total) => progress.push([current, total]),
  );

  expect(result._unsafeUnwrap()).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  expect(progress).toEqual([
    [2, 5],
    [5, 5],
  ]);
  expect(writes.at(-1)).toBeInstanceOf(ExitFileTransferH2DPacket);
});

test("downloads trim word padding from the final chunk", async () => {
  const connection = new V5SerialConnection({} as Serial);
  const replies = [
    initReply(4, 3),
    readReply(USER_FLASH_USR_CODE_START, [1, 2, 3, 0]),
    Object.create(
      ExitFileTransferReplyD2HPacket.prototype,
    ) as ExitFileTransferReplyD2HPacket,
  ];
  connection.writeDataAsync = async () => replies.shift() ?? AckType.CDC2_NACK;

  const result = await connection.downloadFileToHost({
    filename: "test.ini",
    vendor: FileVendor.USER,
  });

  expect(result._unsafeUnwrap()).toEqual(new Uint8Array([1, 2, 3]));
});

test.each([-1, 1.5, Number.NaN])(
  "downloads reject malformed device file size %p and still exit",
  async (fileSize) => {
    const connection = new V5SerialConnection({} as Serial);
    const writes: object[] = [];
    const replies = [
      initReply(4, fileSize),
      Object.create(
        ExitFileTransferReplyD2HPacket.prototype,
      ) as ExitFileTransferReplyD2HPacket,
    ];
    connection.writeDataAsync = async (packet) => {
      writes.push(packet);
      return replies.shift() ?? AckType.CDC2_NACK;
    };

    const result = await connection.downloadFileToHost({
      filename: "bad.bin",
      vendor: FileVendor.USER,
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("download size");
    expect(writes.at(-1)).toBeInstanceOf(ExitFileTransferH2DPacket);
  },
);

test("downloads reject oversized device files before allocation and still exit", async () => {
  const connection = new V5SerialConnection({} as Serial, {
    maxFileDownloadBytes: 4,
  });
  const writes: object[] = [];
  const replies = [
    initReply(4, 5),
    Object.create(
      ExitFileTransferReplyD2HPacket.prototype,
    ) as ExitFileTransferReplyD2HPacket,
  ];
  connection.writeDataAsync = async (packet) => {
    writes.push(packet);
    return replies.shift() ?? AckType.CDC2_NACK;
  };

  const result = await connection.downloadFileToHost({
    filename: "large.bin",
    vendor: FileVendor.USER,
  });

  expect(result.isErr()).toBe(true);
  expect(result._unsafeUnwrapErr().message).toContain(
    "exceeds download limit 4",
  );
  expect(writes.at(-1)).toBeInstanceOf(ExitFileTransferH2DPacket);
});

test("upload progress advances with each acknowledged chunk", async () => {
  const connection = new V5SerialConnection({} as Serial);
  connection.writeDataAsync = async (packet) => {
    if (packet instanceof InitFileTransferH2DPacket) return initReply(2, 0);
    if (packet instanceof WriteFileH2DPacket)
      return protocolReply(WriteFileReplyD2HPacket);
    return protocolReply(ExitFileTransferReplyD2HPacket);
  };
  const progress: Array<[number, number]> = [];

  const result = await connection.uploadFileToDevice(
    {
      filename: "f.bin",
      buf: new Uint8Array([1, 2, 3, 4]),
      downloadTarget: FileDownloadTarget.FILE_TARGET_QSPI,
      autoRun: false,
    },
    (current, total) => progress.push([current, total]),
  );

  expect(result._unsafeUnwrap()).toBe(true);
  expect(progress).toEqual([
    [2, 4],
    [4, 4],
  ]);
});

test("removeFile fails when the exit reply is not acknowledged", async () => {
  const connection = new V5SerialConnection({} as Serial);
  connection.writeDataAsync = async (packet) => {
    if (packet instanceof EraseFileH2DPacket)
      return Object.create(
        EraseFileReplyD2HPacket.prototype,
      ) as EraseFileReplyD2HPacket;
    return AckType.CDC2_NACK;
  };

  const result = await connection.removeFile("f.bin");
  expect(result.isErr()).toBe(true);
  expect(result._unsafeUnwrapErr().message).toContain("ExitFileTransfer");
});

test("download failures still exit file transfer mode", async () => {
  const connection = new V5SerialConnection({} as Serial);
  const writes: object[] = [];
  const replies = [
    initReply(4, 4),
    readReply(USER_FLASH_USR_CODE_START + 1, [1, 2, 3, 4]),
    Object.create(
      ExitFileTransferReplyD2HPacket.prototype,
    ) as ExitFileTransferReplyD2HPacket,
  ];
  connection.writeDataAsync = async (packet) => {
    writes.push(packet);
    return replies.shift() ?? AckType.CDC2_NACK;
  };

  const downloadResult = await connection.downloadFileToHost({
    filename: "test.bin",
    vendor: FileVendor.USER,
  });
  expect(downloadResult.isErr()).toBe(true);
  expect(downloadResult._unsafeUnwrapErr().message).toContain(
    "returned address",
  );
  expect(writes.at(-1)).toBeInstanceOf(ExitFileTransferH2DPacket);
});

test("linked upload failures still exit file transfer mode", async () => {
  const connection = new V5SerialConnection({} as Serial);
  const writes: object[] = [];
  const replies = [
    initReply(4, 4),
    AckType.CDC2_NACK,
    Object.create(
      ExitFileTransferReplyD2HPacket.prototype,
    ) as ExitFileTransferReplyD2HPacket,
  ];
  connection.writeDataAsync = async (packet) => {
    writes.push(packet);
    return replies.shift() ?? AckType.CDC2_NACK;
  };

  const uploadResult = await connection.uploadFileToDevice({
    filename: "test.bin",
    buf: new Uint8Array([1, 2, 3, 4]),
    downloadTarget: FileDownloadTarget.FILE_TARGET_QSPI,
    autoRun: false,
    linkedFile: {
      filename: "cold.bin",
      downloadTarget: FileDownloadTarget.FILE_TARGET_QSPI,
      autoRun: false,
    },
  });
  expect(uploadResult.isErr()).toBe(true);
  const error = uploadResult._unsafeUnwrapErr();
  expect(error.message).toContain("LinkFileReplyD2HPacket");
  expect(error.message).toContain("AckType.CDC2_NACK (255)");
  expect(error.ackType).toBe(AckType.CDC2_NACK);
  expect(writes.at(-2)).toBeInstanceOf(LinkFileH2DPacket);
  expect(writes.at(-1)).toBeInstanceOf(ExitFileTransferH2DPacket);
});

test("file transfers are serialized", async () => {
  const connection = new V5SerialConnection({} as Serial);
  let releaseFirstInit = () => {};
  const firstInit = new Promise<void>((resolve) => {
    releaseFirstInit = resolve;
  });
  let initCount = 0;
  connection.writeDataAsync = async (packet) => {
    if (packet instanceof InitFileTransferH2DPacket) {
      initCount++;
      if (initCount === 1) await firstInit;
      return initReply(4, 0);
    }
    return Object.create(
      ExitFileTransferReplyD2HPacket.prototype,
    ) as ExitFileTransferReplyD2HPacket;
  };

  const first = connection.downloadFileToHost({
    filename: "first.bin",
    vendor: FileVendor.USER,
  });
  const second = connection.downloadFileToHost({
    filename: "second.bin",
    vendor: FileVendor.USER,
  });
  await Bun.sleep(0);
  expect(initCount).toBe(1);

  releaseFirstInit();
  await first;
  await second;
  expect(initCount).toBe(2);
});

test("whole-program uploads block concurrent transfers until every file finishes", async () => {
  const connection = new V5SerialConnection({} as Serial);
  const firstInit = deferred<void>();
  const finalProgramExit = deferred<void>();
  let initCount = 0;
  connection.writeDataAsync = async (packet) => {
    if (packet instanceof InitFileTransferH2DPacket) {
      initCount++;
      if (initCount === 1) await firstInit.promise;
      return initReply(1024, 0);
    }
    if (packet instanceof WriteFileH2DPacket) {
      return protocolReply(WriteFileReplyD2HPacket);
    }
    if (packet instanceof LinkFileH2DPacket) {
      return protocolReply(LinkFileReplyD2HPacket);
    }
    if (packet instanceof ExitFileTransferH2DPacket && initCount === 3) {
      await finalProgramExit.promise;
    }
    return protocolReply(ExitFileTransferReplyD2HPacket);
  };

  const config = new ProgramIniConfig();
  const upload = connection.uploadProgramToDevice(
    config,
    new Uint8Array([1]),
    new Uint8Array([2]),
    () => {},
  );
  const download = connection.downloadFileToHost({
    filename: "queued.bin",
    vendor: FileVendor.USER,
  });
  await Bun.sleep(0);
  expect(initCount).toBe(1);

  firstInit.resolve();
  while (initCount < 3) await Bun.sleep(0);
  expect(initCount).toBe(3);
  finalProgramExit.resolve();
  expect((await upload)._unsafeUnwrap()).toBe(true);
  await download;
  expect(initCount).toBe(4);
});

test("concurrent closes await one cleanup operation", async () => {
  const connection = new V5SerialConnection({} as Serial);
  const writerClosed = deferred<void>();
  let writerCloseCount = 0;
  let portCloseCount = 0;
  connection.writer = {
    close: async () => {
      writerCloseCount++;
      await writerClosed.promise;
    },
    releaseLock: () => {},
  } as unknown as WritableStreamDefaultWriter<unknown>;
  connection.port = {
    close: async () => {
      portCloseCount++;
    },
  } as unknown as SerialPort;

  const first = connection.close();
  const second = connection.close();
  await Bun.sleep(0);
  expect(writerCloseCount).toBe(1);
  expect(portCloseCount).toBe(0);
  writerClosed.resolve();
  await Promise.all([first, second]);
  expect(portCloseCount).toBe(1);
});

test("open reports real port failures as errors, not as busy", async () => {
  const port = {
    readable: null,
    writable: null,
    getInfo: () => ({ usbVendorId: 10376, usbProductId: 1281 }),
    open: async () => {
      throw new Error("EACCES: permission denied");
    },
    close: async () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as SerialPort;
  const serial = {
    getPorts: async () => [port],
  } as unknown as Serial;
  const connection = new V5SerialConnection(serial);

  const result = await connection.open(0, false);
  expect(result.isErr()).toBe(true);
  expect(result._unsafeUnwrapErr().message).toContain("EACCES");
});

test("open resolves no-port when nothing matches and the user is not asked", async () => {
  const connection = new V5SerialConnection({
    getPorts: async () => [],
  } as unknown as Serial);
  expect((await connection.open(0, false))._unsafeUnwrap()).toBe("no-port");
});

test("reader shutdown only suppresses the dedicated close sentinel", async () => {
  const warnings: string[] = [];
  let closeCount = 0;
  const run = (error: Error) =>
    runPacketReader({
      readData: async () => {
        throw error;
      },
      shiftCallback: () => undefined,
      reportWarning: (message) => warnings.push(message),
      close: async () => {
        closeCount++;
      },
    });

  await run(new ReaderClosedError());
  expect(warnings).toEqual([]);

  await run(new Error("No data"));
  expect(warnings).toEqual(["reader loop stopped by a read error"]);
  expect(closeCount).toBe(2);
});

test("typed replies are not stolen by an earlier raw write", async () => {
  class ReadableConnection extends V5SerialConnection {
    start(): Promise<void> {
      return this.startReader();
    }
  }

  const packet = query1Reply(AckType.CDC2_ACK);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(packet);
    },
  });
  const connection = new ReadableConnection({} as Serial);
  connection.reader = stream.getReader();
  connection.writer = {
    write: async () => {},
    close: async () => {},
    releaseLock: () => {},
  } as unknown as WritableStreamDefaultWriter<unknown>;

  // The raw write sits ahead of the typed request in the queue but
  // must not consume the typed request's reply.
  const rawWrite = connection.writeDataAsync(new Uint8Array([1]), 200);
  const typed = connection.query1();
  const reading = connection.start();

  expect((await typed).isOk()).toBe(true);
  await connection.close();
  expect(await rawWrite).toBe(AckType.NOT_CONNECTED);
  await reading;
});

test("non-CDC2 NACK replies reject typed requests", async () => {
  class ReadableConnection extends V5SerialConnection {
    start(): Promise<void> {
      return this.startReader();
    }
  }

  const packet = query1Reply(AckType.CDC2_NACK);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(packet);
    },
  });
  const connection = new ReadableConnection({} as Serial);
  connection.reader = stream.getReader();
  connection.writer = {
    write: async () => {},
    close: async () => {},
    releaseLock: () => {},
  } as unknown as WritableStreamDefaultWriter<unknown>;

  const result = connection.query1();
  const reading = connection.start();

  const error = (await result)._unsafeUnwrapErr();
  expect(error.ackType).toBe(AckType.CDC2_NACK);

  await connection.close();
  await reading;
});

test("unmatched replies emit a warning event instead of logging", async () => {
  class ReadableConnection extends V5SerialConnection {
    start(): Promise<void> {
      return this.startReader();
    }
  }

  const packet = new Uint8Array([0xaa, 0x55, 33, 8, 0, 0, 1, 2, 0, 0, 3, 4]);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(packet);
    },
  });
  const connection = new ReadableConnection({} as Serial);
  connection.reader = stream.getReader();
  const warnings: unknown[] = [];
  connection.on("warning", (warning) => warnings.push(warning));

  const reading = connection.start();
  for (let i = 0; i < 100 && warnings.length === 0; i++) await Bun.sleep(0);
  await connection.close();
  await reading;

  expect(warnings).toContainEqual({
    message: "received a reply with no matching request",
    details: { commandId: 33, commandExtendedId: undefined, ack: 0 },
  });
});

test("reader resynchronizes after leading garbage", async () => {
  class ReadableConnection extends V5SerialConnection {
    start(): Promise<void> {
      return this.startReader();
    }
  }

  const packet = query1Reply(AckType.CDC2_ACK);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([9, 8, 7, ...packet]));
    },
  });
  const connection = new ReadableConnection({} as Serial);
  connection.reader = stream.getReader();
  connection.writer = {
    write: async () => {},
    close: async () => {},
    releaseLock: () => {},
  } as unknown as WritableStreamDefaultWriter<unknown>;
  const result = connection.query1();
  const reading = connection.start();
  expect((await result).isOk()).toBe(true);
  await connection.close();
  await reading;
});

test("reader parses a reply delivered one byte at a time", async () => {
  class ReadableConnection extends V5SerialConnection {
    start(): Promise<void> {
      return this.startReader();
    }
  }

  let replyStream: ReadableStreamDefaultController<Uint8Array> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      replyStream = controller;
    },
  });
  const connection = new ReadableConnection({} as Serial);
  connection.reader = stream.getReader();
  connection.writer = {
    write: async () => {},
    close: async () => {},
    releaseLock: () => {},
  } as unknown as WritableStreamDefaultWriter<unknown>;
  const result = connection.query1();
  const reading = connection.start();

  for (const byte of query1Reply(AckType.CDC2_ACK)) {
    replyStream?.enqueue(Uint8Array.of(byte));
  }

  expect((await result).isOk()).toBe(true);
  await connection.close();
  await reading;
});

test("reader discards a corrupt CDC reply and continues to the next reply", async () => {
  class ReadableConnection extends V5SerialConnection {
    start(): Promise<void> {
      return this.startReader();
    }
  }

  const corrupt = cdc2Reply(86, 30, AckType.CDC2_ACK);
  corrupt[corrupt.length - 1]! ^= 0xff;
  const valid = cdc2Reply(86, 30, AckType.CDC2_ACK);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([...corrupt, ...valid]));
    },
  });
  const connection = new ReadableConnection({} as Serial);
  connection.reader = stream.getReader();
  connection.writer = {
    write: async () => {},
    close: async () => {},
    releaseLock: () => {},
  } as unknown as WritableStreamDefaultWriter<unknown>;
  const warnings: unknown[] = [];
  connection.on("warning", (warning) => warnings.push(warning));

  const result = connection.request(
    new FileClearUpH2DPacket(FileVendor.USER),
    FileClearUpReplyD2HPacket,
  );
  const reading = connection.start();

  expect((await result).isOk()).toBe(true);
  expect(warnings).toContainEqual({
    message: "discarding a reply with an invalid CDC CRC",
    details: { commandId: 86, commandExtendedId: 30, ack: AckType.CDC2_ACK },
  });
  expect(connection.callbacksQueue).toHaveLength(0);

  await connection.close();
  await reading;
});

test("validates a CDC reply independently from a coalesced simple reply", async () => {
  class ReadableConnection extends V5SerialConnection {
    start(): Promise<void> {
      return this.startReader();
    }
  }

  const extended = cdc2Reply(86, 30, AckType.CDC2_ACK);
  const simple = query1Reply(AckType.CDC2_ACK);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([...extended, ...simple]));
    },
  });
  const connection = new ReadableConnection({} as Serial);
  connection.reader = stream.getReader();
  connection.writer = {
    write: async () => {},
    close: async () => {},
    releaseLock: () => {},
  } as unknown as WritableStreamDefaultWriter<unknown>;

  const extendedResult = connection.request(
    new FileClearUpH2DPacket(FileVendor.USER),
    FileClearUpReplyD2HPacket,
  );
  const simpleResult = connection.query1();
  const reading = connection.start();

  expect((await extendedResult).isOk()).toBe(true);
  expect((await simpleResult).isOk()).toBe(true);
  expect(connection.callbacksQueue).toHaveLength(0);

  await connection.close();
  await reading;
});

describe("whole-program upload atomicity", () => {
  test("INI, cold, and binary uploads share one transaction", async () => {
    const connection = new V5SerialConnection({} as Serial);
    const writes: object[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    let releaseFirstInit = () => {};
    const firstInitGate = new Promise<void>((resolve) => {
      releaseFirstInit = resolve;
    });
    let initCount = 0;
    connection.writeDataAsync = async (packet) => {
      if (packet instanceof InitFileTransferH2DPacket) {
        initCount++;
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        if (initCount === 1) {
          await firstInitGate;
        }
        inFlight--;
        return initReply(4, 0);
      }
      if (packet instanceof LinkFileH2DPacket) {
        return Object.create(
          LinkFileReplyD2HPacket.prototype,
        ) as LinkFileReplyD2HPacket;
      }
      if (packet instanceof WriteFileH2DPacket) {
        return Object.create(
          WriteFileReplyD2HPacket.prototype,
        ) as WriteFileReplyD2HPacket;
      }
      if (packet instanceof ExitFileTransferH2DPacket) {
        return Object.create(
          ExitFileTransferReplyD2HPacket.prototype,
        ) as ExitFileTransferReplyD2HPacket;
      }
      writes.push(packet);
      return Object.create(
        ExitFileTransferReplyD2HPacket.prototype,
      ) as ExitFileTransferReplyD2HPacket;
    };

    const { ProgramIniConfig } = await import("./VexIniConfig");
    const iniConfig = new ProgramIniConfig();
    iniConfig.baseName = "robot";

    const upload = connection.uploadProgramToDevice(
      iniConfig,
      new Uint8Array([1, 2, 3, 4]),
      new Uint8Array([9, 9, 9, 9]),
      () => {},
    );
    await Bun.sleep(0);
    expect(initCount).toBe(1);

    const concurrent = connection.downloadFileToHost({
      filename: "concurrent.bin",
      vendor: FileVendor.USER,
    });
    await Bun.sleep(0);
    expect(initCount).toBe(1);

    releaseFirstInit();
    expect((await upload)._unsafeUnwrap()).toBe(true);
    expect((await concurrent)._unsafeUnwrap()).toEqual(new Uint8Array(0));
    expect(initCount).toBe(4);
    expect(maxInFlight).toBe(1);
  });
});

describe("transfer cleanup on every failure point", () => {
  function buildExitTrackingConnection() {
    const connection = new V5SerialConnection({} as Serial);
    const writes: object[] = [];
    let queue: Array<HostBoundPacket | AckType> = [];
    connection.writeDataAsync = async (packet) => {
      writes.push(packet);
      const next = queue.shift();
      if (next === undefined) return AckType.CDC2_NACK;
      return next;
    };
    return {
      connection,
      writes,
      pushReplies: (...replies: Array<HostBoundPacket | AckType>) => {
        queue.push(...replies);
      },
    };
  }

  function nack() {
    return AckType.CDC2_NACK;
  }

  function exitReply() {
    return Object.create(
      ExitFileTransferReplyD2HPacket.prototype,
    ) as ExitFileTransferReplyD2HPacket;
  }

  function writeReply() {
    return Object.create(
      WriteFileReplyD2HPacket.prototype,
    ) as WriteFileReplyD2HPacket;
  }

  function initReply() {
    return Object.create(
      InitFileTransferReplyD2HPacket.prototype,
    ) as InitFileTransferReplyD2HPacket;
  }

  test("upload link failure still exits", async () => {
    const { connection, writes, pushReplies } = buildExitTrackingConnection();
    pushReplies(initReply(), nack(), exitReply());
    const result = await connection.uploadFileToDevice({
      filename: "f.bin",
      buf: new Uint8Array([1]),
      downloadTarget: FileDownloadTarget.FILE_TARGET_QSPI,
      autoRun: false,
      linkedFile: {
        filename: "cold.bin",
        downloadTarget: FileDownloadTarget.FILE_TARGET_QSPI,
        autoRun: false,
      },
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("LinkFileH2DPacket");
    expect(writes.at(-1)).toBeInstanceOf(ExitFileTransferH2DPacket);
  });

  test("upload write failure still exits", async () => {
    const { connection, writes, pushReplies } = buildExitTrackingConnection();
    pushReplies(initReply(), nack(), exitReply());
    const result = await connection.uploadFileToDevice({
      filename: "f.bin",
      buf: new Uint8Array([1, 2, 3, 4]),
      downloadTarget: FileDownloadTarget.FILE_TARGET_QSPI,
      autoRun: false,
    });
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.message).toContain("WriteFileReplyD2HPacket");
    expect(error.message).toContain("AckType.CDC2_NACK (255)");
    expect(error.ackType).toBe(AckType.CDC2_NACK);
    expect(writes.at(-1)).toBeInstanceOf(ExitFileTransferH2DPacket);
  });

  test("download read failure still exits", async () => {
    const { connection, writes, pushReplies } = buildExitTrackingConnection();
    pushReplies(
      Object.assign(Object.create(InitFileTransferReplyD2HPacket.prototype), {
        windowSize: 4,
        fileSize: 4,
        crc32: 0,
      }) as InitFileTransferReplyD2HPacket,
      nack(),
      exitReply(),
    );
    const result = await connection.downloadFileToHost({
      filename: "f.bin",
      vendor: FileVendor.USER,
    });
    expect(result.isErr()).toBe(true);
    expect(writes.at(-1)).toBeInstanceOf(ExitFileTransferH2DPacket);
  });

  test("download read failure is not masked by exit failure", async () => {
    const connection = new V5SerialConnection({} as Serial);
    let sawReadAttempt = false;
    connection.writeDataAsync = async (packet) => {
      if (packet instanceof InitFileTransferH2DPacket) {
        return Object.assign(
          Object.create(InitFileTransferReplyD2HPacket.prototype),
          {
            windowSize: 4,
            fileSize: 4,
            crc32: 0,
          },
        ) as InitFileTransferReplyD2HPacket;
      }
      if (packet instanceof ExitFileTransferH2DPacket) {
        throw new Error("exit failed");
      }
      sawReadAttempt = true;
      return AckType.CDC2_NACK;
    };

    const result = await connection.downloadFileToHost({
      filename: "f.bin",
      vendor: FileVendor.USER,
    });
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.message).toContain("ReadFileReplyD2HPacket");
    expect(error.message).toContain("AckType.CDC2_NACK (255)");
    expect(error.ackType).toBe(AckType.CDC2_NACK);
    expect(sawReadAttempt).toBe(true);
  });

  test("remove file failure still exits transfer mode", async () => {
    const { connection, writes, pushReplies } = buildExitTrackingConnection();
    pushReplies(nack(), exitReply());
    const result = await connection.removeFile("user-file.bin");
    expect(result.isErr()).toBe(true);
    expect(writes[0]).toBeInstanceOf(EraseFileH2DPacket);
    expect(writes.at(-1)).toBeInstanceOf(ExitFileTransferH2DPacket);
  });

  test("removeAllFiles failure still exits transfer mode", async () => {
    const { connection, writes, pushReplies } = buildExitTrackingConnection();
    pushReplies(nack(), exitReply());
    const result = await connection.removeAllFiles();
    expect(result.isErr()).toBe(true);
    expect(writes[0]).toBeInstanceOf(FileClearUpH2DPacket);
    expect(writes.at(-1)).toBeInstanceOf(ExitFileTransferH2DPacket);
  });

  test("init reply is required before transfer mode is entered", async () => {
    const { connection, writes, pushReplies } = buildExitTrackingConnection();
    pushReplies(nack() as unknown as HostBoundPacket);
    const result = await connection.downloadFileToHost({
      filename: "f.bin",
      vendor: FileVendor.USER,
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain(
      "InitFileTransferH2DPacket",
    );
    // The device never acknowledged the init, so no exit is sent.
    expect(writes).toHaveLength(1);
    expect(writes[0]).toBeInstanceOf(InitFileTransferH2DPacket);
    // The depth counter must still drop back to zero so refresh resumes.
    expect(connection.isFileTransferring).toBe(false);
  });

  test("use existing WriteFileReply reply shape to avoid surprise", () => {
    expect(writeReply()).toBeInstanceOf(WriteFileReplyD2HPacket);
  });
});

test("captureScreenSetup rejects NACK and timeout replies", async () => {
  const cases: AckType[] = [
    AckType.CDC2_NACK,
    AckType.CDC2_NACK_FILE,
    AckType.CDC2_NACK_FUNC,
    AckType.CDC2_NACK_INIT,
    AckType.TIMEOUT,
  ];
  for (const reply of cases) {
    const connection = new V5SerialConnection({} as Serial);
    connection.writeDataAsync = async () => reply;
    expect((await connection.captureScreenSetup()).isErr()).toBe(true);
  }
});

test("request errors include the NACK type", async () => {
  const connection = new V5SerialConnection({} as Serial);
  connection.writeDataAsync = async () => AckType.CDC2_NACK_FILE_SYS_FULL;

  const result = await connection.captureScreenSetup();

  expect(result.isErr()).toBe(true);
  const error = result._unsafeUnwrapErr();
  expect(error.ackType).toBe(AckType.CDC2_NACK_FILE_SYS_FULL);
  expect(error.message).toContain("AckType.CDC2_NACK_FILE_SYS_FULL (220)");
});

test("captureScreenSetup accepts the matching reply packet", async () => {
  const connection = new V5SerialConnection({} as Serial);
  const reply = Object.create(
    ScreenCaptureReplyD2HPacket.prototype,
  ) as ScreenCaptureReplyD2HPacket;
  connection.writeDataAsync = async () => reply;
  expect((await connection.captureScreenSetup())._unsafeUnwrap()).toBe(reply);
});

test("captureScreen converts the device framebuffer from BGRA to RGB", async () => {
  const connection = new V5SerialConnection({} as Serial);
  const framebuffer = new Uint8Array(512 * 272 * 4);
  framebuffer.set([3, 2, 1, 255]);
  connection.writeDataAsync = async () =>
    protocolReply(ScreenCaptureReplyD2HPacket);
  connection.downloadFileToHostUnlocked = () => okAsync(framebuffer);

  const result = await connection.captureScreen();
  const pixels = result._unsafeUnwrap();
  expect(pixels).toHaveLength(480 * 272 * 3);
  expect(pixels.slice(0, 3)).toEqual(new Uint8Array([1, 2, 3]));
});

test("screen conversion skips row padding and converts the final pixel", () => {
  const framebuffer = new Uint8Array(512 * 272 * 4);
  const lastVisiblePixel = (271 * 512 + 479) * 4;
  const firstPaddingPixel = (271 * 512 + 480) * 4;
  framebuffer.set([30, 20, 10, 255], lastVisiblePixel);
  framebuffer.set([60, 50, 40, 255], firstPaddingPixel);

  const pixels = convertScreenCapture(framebuffer);

  expect(pixels.slice(-3)).toEqual(new Uint8Array([10, 20, 30]));
});

test("screen conversion rejects invalid framebuffer sizes", () => {
  expect(() => convertScreenCapture(new Uint8Array(512 * 272 * 4 - 1))).toThrow(
    "bad screen capture framebuffer size: 557055; expected 557056",
  );
});

test("captureScreen waits behind an in-flight transfer", async () => {
  const connection = new V5SerialConnection({} as Serial);
  const uploadInit = deferred<void>();
  const framebuffer = new Uint8Array(512 * 272 * 4);
  let initCount = 0;
  let screenRequests = 0;

  connection.writeDataAsync = async (packet) => {
    if (packet instanceof InitFileTransferH2DPacket) {
      initCount++;
      await uploadInit.promise;
      return initReply(4, 0);
    }
    if (packet instanceof WriteFileH2DPacket) {
      return protocolReply(WriteFileReplyD2HPacket);
    }
    if (packet instanceof ScreenCaptureH2DPacket) {
      screenRequests++;
      return protocolReply(ScreenCaptureReplyD2HPacket);
    }
    return protocolReply(ExitFileTransferReplyD2HPacket);
  };
  connection.downloadFileToHostUnlocked = () => okAsync(framebuffer);

  const upload = connection.uploadFileToDevice({
    filename: "program.bin",
    buf: new Uint8Array([1, 2, 3, 4]),
    downloadTarget: FileDownloadTarget.FILE_TARGET_QSPI,
    autoRun: false,
  });
  await Bun.sleep(0);
  expect(initCount).toBe(1);

  const screen = connection.captureScreen();
  await Bun.sleep(0);
  expect(screenRequests).toBe(0);

  uploadInit.resolve();
  expect((await upload)._unsafeUnwrap()).toBe(true);
  await screen;
  expect(screenRequests).toBe(1);
});

describe("lifecycle hardening", () => {
  function buildLifecycleConnection() {
    const listeners: Record<string, Array<() => void>> = {};
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
      addEventListener: (name: string, cb: () => void) => {
        (listeners[name] ??= []).push(cb);
      },
      removeEventListener: (name: string, cb: () => void) => {
        const list = listeners[name];
        if (list === undefined) return;
        const idx = list.indexOf(cb);
        if (idx >= 0) list.splice(idx, 1);
      },
    } as unknown as SerialPort;
    const serial = {
      getPorts: async () => [port],
    } as unknown as Serial;
    return { port, serial, listeners };
  }

  test("retained disconnect listener count is exactly one per open", async () => {
    const { serial, listeners } = buildLifecycleConnection();
    const connection = new V5SerialConnection(serial);
    for (let i = 0; i < 3; i++) {
      expect((await connection.open(0, false))._unsafeUnwrap()).toBe("opened");
      expect((listeners["disconnect"] ?? []).length).toBe(1);
      await connection.close();
      expect((listeners["disconnect"] ?? []).length).toBe(0);
    }
  });

  test("concurrent close calls await one cleanup and emit one event", async () => {
    const { port, serial: _serial, listeners } = buildLifecycleConnection();
    let closeCalls = 0;
    let resolvePortClose = () => {};
    const portCloseGate = new Promise<void>((resolve) => {
      resolvePortClose = resolve;
    });
    let readable: ReadableStream<Uint8Array> | null = null;
    let writable: WritableStream<Uint8Array> | null = null;
    const wrappedPort = {
      get readable() {
        return readable;
      },
      get writable() {
        return writable;
      },
      getInfo: port.getInfo,
      open: async () => {
        readable = new ReadableStream<Uint8Array>();
        writable = new WritableStream<Uint8Array>();
      },
      close: async () => {
        closeCalls++;
        await portCloseGate;
        readable = null;
        writable = null;
      },
      addEventListener: port.addEventListener,
      removeEventListener: port.removeEventListener,
    } as unknown as SerialPort;
    const wrappedSerial = {
      getPorts: async () => [wrappedPort],
    } as unknown as Serial;

    const connection = new V5SerialConnection(wrappedSerial);
    expect((await connection.open(0, false))._unsafeUnwrap()).toBe("opened");

    let disconnects = 0;
    connection.on("disconnected", () => disconnects++);

    const first = connection.close();
    const second = connection.close();
    const third = connection.close();
    await Bun.sleep(0);
    expect(closeCalls).toBe(1);
    resolvePortClose();
    await Promise.all([first, second, third]);
    expect(closeCalls).toBe(1);
    expect(disconnects).toBe(1);
    expect((listeners["disconnect"] ?? []).length).toBe(0);
  });

  test("close without an active connection is a no-op and emits no event", async () => {
    const connection = new V5SerialConnection({} as Serial);
    let disconnects = 0;
    connection.on("disconnected", () => disconnects++);
    await connection.close();
    expect(disconnects).toBe(0);
  });

  test("reader, writer, and port are released in deterministic order", async () => {
    const events: string[] = [];
    const writer = {
      write: async () => {},
      close: async () => {
        events.push("writer.close");
      },
      releaseLock: () => {
        events.push("writer.releaseLock");
      },
    } as unknown as WritableStreamDefaultWriter<unknown>;
    const reader = {
      cancel: async () => {
        events.push("reader.cancel");
      },
      read: async () => ({ done: true, value: undefined }),
      releaseLock: () => {
        events.push("reader.releaseLock");
      },
    } as unknown as ReadableStreamDefaultReader<unknown>;
    const port = {
      get readable() {
        return new ReadableStream<Uint8Array>();
      },
      get writable() {
        return new WritableStream<Uint8Array>();
      },
      getInfo: () => ({ usbVendorId: 10376, usbProductId: 1281 }),
      open: async () => {},
      close: async () => {
        events.push("port.close");
      },
      addEventListener: () => {},
    } as unknown as SerialPort;
    const connection = new V5SerialConnection({
      getPorts: async () => [port],
    } as unknown as Serial);
    connection.writer = writer;
    connection.reader = reader;
    connection.port = port;
    // Bypass the private flag so the deterministic-close test can
    // assert the disconnect event without going through `open()`.
    (connection as unknown as { _wasConnected: boolean })._wasConnected = true;

    await connection.close();
    expect(events).toEqual([
      "writer.close",
      "writer.releaseLock",
      "reader.cancel",
      "reader.releaseLock",
      "port.close",
    ]);
  });
});

describe("removeFile and removeAllFiles go through the transaction queue", () => {
  test("removeFile waits for an in-flight upload", async () => {
    const connection = new V5SerialConnection({} as Serial);
    let releaseFirstInit = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseFirstInit = resolve;
    });
    let initCount = 0;
    let eraseSeen = false;
    connection.writeDataAsync = async (packet) => {
      if (packet instanceof InitFileTransferH2DPacket) {
        initCount++;
        if (initCount === 1) await gate;
        return initReply(4, 0);
      }
      if (packet instanceof EraseFileH2DPacket) {
        eraseSeen = true;
        return Object.create(
          EraseFileReplyD2HPacket.prototype,
        ) as EraseFileReplyD2HPacket;
      }
      if (packet instanceof WriteFileH2DPacket) {
        return Object.create(
          WriteFileReplyD2HPacket.prototype,
        ) as WriteFileReplyD2HPacket;
      }
      // Cover the upload's ExitFileTransfer and removeFile's exit.
      return Object.create(
        ExitFileTransferReplyD2HPacket.prototype,
      ) as ExitFileTransferReplyD2HPacket;
    };

    const upload = connection.uploadFileToDevice({
      filename: "f.bin",
      buf: new Uint8Array([1, 2, 3, 4]),
      downloadTarget: FileDownloadTarget.FILE_TARGET_QSPI,
      autoRun: false,
    });
    await Bun.sleep(0);
    expect(initCount).toBe(1);

    const removePromise = connection.removeFile("user.bin");
    await Bun.sleep(0);
    expect(eraseSeen).toBe(false);

    releaseFirstInit();
    expect((await upload)._unsafeUnwrap()).toBe(true);
    expect((await removePromise).isOk()).toBe(true);
    expect(eraseSeen).toBe(true);
  });

  test("removeAllFiles waits for an in-flight download", async () => {
    const connection = new V5SerialConnection({} as Serial);
    let releaseFirstInit = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseFirstInit = resolve;
    });
    let initCount = 0;
    let clearSeen = false;
    connection.writeDataAsync = async (packet) => {
      if (packet instanceof InitFileTransferH2DPacket) {
        initCount++;
        if (initCount === 1) await gate;
        return initReply(4, 0);
      }
      if (packet instanceof FileClearUpH2DPacket) {
        clearSeen = true;
        return Object.create(
          FileClearUpReplyD2HPacket.prototype,
        ) as FileClearUpReplyD2HPacket;
      }
      return Object.create(
        ExitFileTransferReplyD2HPacket.prototype,
      ) as ExitFileTransferReplyD2HPacket;
    };

    const download = connection.downloadFileToHost({
      filename: "f.bin",
      vendor: FileVendor.USER,
    });
    await Bun.sleep(0);
    expect(initCount).toBe(1);

    const clearPromise = connection.removeAllFiles();
    await Bun.sleep(0);
    expect(clearSeen).toBe(false);

    releaseFirstInit();
    await download;
    expect((await clearPromise).isOk()).toBe(true);
    expect(clearSeen).toBe(true);
  });
});
