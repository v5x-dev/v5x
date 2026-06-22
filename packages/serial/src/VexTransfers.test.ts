import { afterEach, expect, test } from "bun:test";
import {
  AckType,
  FileDownloadTarget,
  FileVendor,
  type IFileWriteRequest,
} from "./Vex";
import { V5SerialConnection } from "./VexConnection";
import { V5SerialDevice } from "./VexDevice";
import {
  EraseFileReplyD2HPacket,
  ExitFileTransferReplyD2HPacket,
  FileClearUpReplyD2HPacket,
  GetDirectoryEntryReplyD2HPacket,
  GetDirectoryFileCountReplyD2HPacket,
  GetProgramSlotInfoReplyD2HPacket,
  ReadKeyValueReplyD2HPacket,
  ScreenCaptureReplyD2HPacket,
  WriteKeyValueReplyD2HPacket,
} from "./VexPacketModels";
import { VexFirmwareVersion } from "./VexFirmwareVersion";
import { protocolReply } from "./protocol.test-support";

const serial = { getPorts: async () => [] } as unknown as Serial;
const devices: V5SerialDevice[] = [];

afterEach(async () => {
  await Promise.all(devices.splice(0).map((device) => device.dispose()));
});

test("file and key-value operations report protocol outcomes", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  const replies = [
    protocolReply(ReadKeyValueReplyD2HPacket, { value: "value" }),
    protocolReply(WriteKeyValueReplyD2HPacket),
    protocolReply(EraseFileReplyD2HPacket),
    protocolReply(ExitFileTransferReplyD2HPacket),
    protocolReply(FileClearUpReplyD2HPacket),
  ];
  device.connection = {
    isConnected: true,
    writeDataAsync: async () => replies.shift(),
    removeFile: async () => true,
    removeAllFiles: async () => true,
    close: async () => {},
  } as unknown as V5SerialConnection;

  expect(await device.brain.getValue("key")).toBe("value");
  expect(await device.brain.setValue("key", "value")).toBe(true);
  expect(
    await device.brain.removeFile({
      filename: "program.bin",
      vendor: FileVendor.USER,
    }),
  ).toBe(true);
  expect(await device.brain.removeAllFiles()).toBe(true);
});

test("screen capture rejects NACK and timeout without downloading", async () => {
  for (const response of [AckType.CDC2_NACK, AckType.TIMEOUT]) {
    const device = new V5SerialDevice(serial);
    devices.push(device);
    let downloads = 0;
    const writeData = ((_packet, resolve) =>
      resolve(response)) satisfies V5SerialConnection["writeData"];
    device.connection = {
      isConnected: true,
      writeData,
      downloadFileToHost: async () => {
        downloads++;
        return new Uint8Array();
      },
      close: async () => {},
    } as unknown as V5SerialConnection;

    await expect(device.brain.captureScreen()).rejects.toThrow("rejected");
    expect(downloads).toBe(0);
  }
});

test("screen capture converts the device framebuffer from BGRA to RGB", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  const framebuffer = new Uint8Array(512 * 272 * 4);
  framebuffer.set([3, 2, 1, 255]);
  const writeData = ((_packet, resolve) =>
    resolve(
      protocolReply(ScreenCaptureReplyD2HPacket),
    )) satisfies V5SerialConnection["writeData"];
  device.connection = {
    isConnected: true,
    writeData,
    downloadFileToHostUnlocked: async () => framebuffer,
    close: async () => {},
  } as unknown as V5SerialConnection;

  const result = await device.brain.captureScreen();
  expect(result?.length).toBe(480 * 272 * 3);
  expect(result?.slice(0, 3)).toEqual(new Uint8Array([1, 2, 3]));
});

test("listFiles enumerates directory entries returned by the device", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  const replies = [
    protocolReply(GetDirectoryFileCountReplyD2HPacket, { count: 2 }),
    protocolReply(GetDirectoryEntryReplyD2HPacket, {
      file: {
        index: 0,
        size: 128,
        loadAddress: 0x07800000,
        crc32: 0,
        type: "bin",
        timestamp: 0,
        version: new VexFirmwareVersion(1, 0, 0, 0),
        filename: "robot.bin",
      },
    }),
    protocolReply(GetDirectoryEntryReplyD2HPacket),
  ];
  device.connection = {
    isConnected: true,
    writeDataAsync: async () => replies.shift(),
    close: async () => {},
  } as unknown as V5SerialConnection;

  const files = await device.brain.listFiles();
  expect(files).toHaveLength(1);
  expect(files?.[0]?.filename).toBe("robot.bin");
});

test("listProgram reports program slots returned by the device", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  const replies = [
    protocolReply(GetDirectoryFileCountReplyD2HPacket, { count: 2 }),
    protocolReply(GetDirectoryEntryReplyD2HPacket, {
      file: {
        index: 0,
        size: 64,
        loadAddress: 0x07800000,
        crc32: 0,
        type: "ini",
        timestamp: 1000,
        version: new VexFirmwareVersion(1, 0, 0, 0),
        filename: "robot.ini",
      },
    }),
    protocolReply(GetDirectoryEntryReplyD2HPacket, {
      file: {
        index: 1,
        size: 256,
        loadAddress: 0x07800000,
        crc32: 0,
        type: "bin",
        timestamp: 1000,
        version: new VexFirmwareVersion(1, 0, 0, 0),
        filename: "robot.bin",
      },
    }),
    protocolReply(GetProgramSlotInfoReplyD2HPacket, {
      slot: 3,
      requestedSlot: 3,
    }),
  ];
  device.connection = {
    isConnected: true,
    writeDataAsync: async () => replies.shift(),
    close: async () => {},
  } as unknown as V5SerialConnection;

  const programs = await device.brain.listProgram();
  expect(programs).toHaveLength(1);
  expect(programs?.[0]?.name).toBe("robot");
  expect(programs?.[0]?.slot).toBe(3);
});

test("readFile routes through the connection with parsed metadata", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  const expected = new Uint8Array([1, 2, 3, 4]);
  let observed: unknown;
  device.connection = {
    isConnected: true,
    downloadFileToHost: async (request: {
      filename: string;
      vendor: FileVendor;
    }) => {
      observed = request;
      return expected;
    },
    close: async () => {},
  } as unknown as V5SerialConnection;

  const data = await device.brain.readFile("robot.bin");
  expect(data).toEqual(expected);
  expect(observed).toEqual({ filename: "robot.bin", vendor: FileVendor.USER });
});

test("writeFile forwards the request through the connection", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  const request: IFileWriteRequest = {
    filename: "robot.bin",
    buf: new Uint8Array([1, 2, 3]),
    downloadTarget: FileDownloadTarget.FILE_TARGET_QSPI,
    vendor: FileVendor.USER,
    autoRun: false,
  };
  let observed: unknown;
  device.connection = {
    isConnected: true,
    uploadFileToDevice: async (req: IFileWriteRequest) => {
      observed = req;
      return true;
    },
    close: async () => {},
  } as unknown as V5SerialConnection;

  expect(await device.brain.writeFile(request)).toBe(true);
  expect(observed).toBe(request);
});

test("uploadProgram on a controller switches to and from the download channel", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  Object.defineProperty(device, "isV5Controller", { get: () => true });
  device.state.brain.isAvailable = true;
  const channels: number[] = [];
  Object.defineProperty(device, "radio", {
    get: () => ({
      changeChannel: async (channel: number) => {
        channels.push(channel);
        return true;
      },
    }),
  });
  device.refresh = async () => true;
  device.connection = {
    isConnected: true,
    getSystemStatus: async () => ({}),
    uploadProgramToDevice: async () => true,
    close: async () => {},
  } as unknown as V5SerialConnection;

  const config = { baseName: "robot" } as never;
  expect(
    await device.brain.uploadProgram(
      config,
      new Uint8Array([1]),
      undefined,
      () => {},
    ),
  ).toBe(true);
  expect(channels).toEqual([1, 0]);
});
