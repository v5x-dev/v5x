import { describe, expect, test } from "bun:test";
import {
  AckType,
  FileDownloadTarget,
  FileVendor,
  USER_FLASH_USR_CODE_START,
} from "./Vex";
import { V5SerialConnection } from "./VexConnection";
import {
  ExitFileTransferH2DPacket,
  ExitFileTransferReplyD2HPacket,
  InitFileTransferH2DPacket,
  InitFileTransferReplyD2HPacket,
  LinkFileH2DPacket,
  LinkFileReplyD2HPacket,
  ReadFileReplyD2HPacket,
  SelectDashReplyD2HPacket,
  WriteFileH2DPacket,
  WriteFileReplyD2HPacket,
} from "./VexPacket";
import { ProgramIniConfig } from "./VexIniConfig";
import { deferred, protocolReply } from "./protocol.test-support";

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
  reply.buf = new Uint8Array(bytes).buffer;
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

  expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  expect(progress).toEqual([
    [2, 5],
    [5, 5],
  ]);
  expect(writes.at(-1)).toBeInstanceOf(ExitFileTransferH2DPacket);
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

  await expect(
    connection.downloadFileToHost({
      filename: "test.bin",
      vendor: FileVendor.USER,
    }),
  ).rejects.toThrow("returned address");
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

  await expect(
    connection.uploadFileToDevice({
      filename: "test.bin",
      buf: new Uint8Array([1, 2, 3, 4]),
      downloadTarget: FileDownloadTarget.FILE_TARGET_QSPI,
      autoRun: false,
      linkedFile: {
        filename: "cold.bin",
        downloadTarget: FileDownloadTarget.FILE_TARGET_QSPI,
        autoRun: false,
      },
    }),
  ).rejects.toThrow("LinkFileH2DPacket failed");
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
  expect(await upload).toBe(true);
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

test("reader resynchronizes after leading garbage", async () => {
  class ReadableConnection extends V5SerialConnection {
    start(): Promise<void> {
      return this.startReader();
    }
  }

  const packet = new Uint8Array([0xaa, 0x55, 33, 8, 0, 0, 1, 2, 0, 0, 3, 4]);
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
  expect(await result).not.toBeNull();
  await connection.close();
  await reading;
});
