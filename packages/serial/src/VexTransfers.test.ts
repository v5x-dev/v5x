import { afterEach, expect, test } from "bun:test";
import { AckType, FileVendor } from "./Vex";
import { V5SerialConnection } from "./VexConnection";
import { V5SerialDevice } from "./VexDevice";
import {
  EraseFileReplyD2HPacket,
  ExitFileTransferReplyD2HPacket,
  FileClearUpReplyD2HPacket,
  ReadKeyValueReplyD2HPacket,
  ScreenCaptureReplyD2HPacket,
  WriteKeyValueReplyD2HPacket,
} from "./VexPacketModels";
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
    downloadFileToHost: async () => framebuffer,
    close: async () => {},
  } as unknown as V5SerialConnection;

  const result = await device.brain.captureScreen();
  expect(result?.length).toBe(480 * 272 * 3);
  expect(result?.slice(0, 3)).toEqual(new Uint8Array([1, 2, 3]));
});
