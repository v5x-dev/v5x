import { describe, expect, test } from "bun:test";
import {
  AckType,
  FileDownloadTarget,
  FileInitAction,
  FileInitOption,
  FileVendor,
} from "./Vex";
import {
  EraseFileH2DPacket,
  ExitFileTransferReplyD2HPacket,
  GetDirectoryEntryReplyD2HPacket,
  GetFileMetadataH2DPacket,
  InitFileTransferH2DPacket,
  PacketEncoder,
  ReadFileReplyD2HPacket,
  ReadKeyValueH2DPacket,
  WriteKeyValueH2DPacket,
} from "./VexPacket";

const encoder = PacketEncoder.getInstance();

function hostPacket(
  command: number,
  extendedCommand: number,
  body: Uint8Array,
) {
  const payloadSize = body.byteLength + 4;
  const extendedLength = payloadSize >= 128;
  const headerLength = extendedLength ? 5 : 4;
  const packet = new Uint8Array(headerLength + payloadSize);
  packet.set([0xaa, 0x55, command], 0);
  if (extendedLength) {
    packet.set([0x80 | (payloadSize >>> 8), payloadSize & 0xff], 3);
  } else {
    packet[3] = payloadSize;
  }
  packet[headerLength] = extendedCommand;
  packet[headerLength + 1] = AckType.CDC2_ACK;
  packet.set(body, headerLength + 2);
  const crc = encoder.crcgen.crc16(packet.subarray(0, -2), 0);
  packet.set([crc >>> 8, crc & 0xff], packet.byteLength - 2);
  return packet;
}

test("exact 128-byte host payloads use the extended header", () => {
  const packet = hostPacket(86, 18, new Uint8Array(124));
  const reply = new ExitFileTransferReplyD2HPacket(packet);

  expect(encoder.getPayloadSize(packet)).toBe(128);
  expect(encoder.getHostHeaderLength(packet)).toBe(5);
  expect(reply.ack).toBe(AckType.CDC2_ACK);
});

test("read replies parse their address and exact data bytes", () => {
  const body = new Uint8Array(7);
  new DataView(body.buffer).setUint32(0, 0x03800000, true);
  body.set([1, 2, 3], 4);
  const reply = new ReadFileReplyD2HPacket(hostPacket(86, 20, body));

  expect(reply.addr).toBe(0x03800000);
  expect(reply.length).toBe(3);
  expect(new Uint8Array(reply.buf)).toEqual(new Uint8Array([1, 2, 3]));
});

describe("fixed-width text fields", () => {
  const initFileTransfer = (name: string) =>
    new InitFileTransferH2DPacket(
      FileInitAction.READ,
      FileDownloadTarget.FILE_TARGET_QSPI,
      FileVendor.USER,
      FileInitOption.NONE,
      new Uint8Array(),
      0,
      name,
    );

  test("uses the complete 24-byte filename field", () => {
    const twentyThreeBytes = "x".repeat(23);
    const twentyFourBytes = "x".repeat(24);

    expect(initFileTransfer(twentyThreeBytes).data.slice(35, 59)).toEqual(
      Uint8Array.from([...new TextEncoder().encode(twentyThreeBytes), 0]),
    );
    expect(initFileTransfer(twentyFourBytes).data.slice(35, 59)).toEqual(
      new TextEncoder().encode(twentyFourBytes),
    );
  });

  test("rejects filenames longer than the 24-byte field and overlong types", () => {
    expect(() => initFileTransfer("x".repeat(25))).toThrow(
      "Filename must be at most 24 UTF-8 bytes",
    );
    expect(
      () =>
        new InitFileTransferH2DPacket(
          FileInitAction.READ,
          FileDownloadTarget.FILE_TARGET_QSPI,
          FileVendor.USER,
          FileInitOption.NONE,
          new Uint8Array(),
          0,
          "test.bin",
          "abcde",
        ),
    ).toThrow("File type must be at most 4 UTF-8 bytes");
  });

  test("reuses a 24-byte directory filename in file requests", () => {
    const name = "directory-entry-name-24x";
    expect(new TextEncoder().encode(name)).toHaveLength(24);

    const body = new Uint8Array(57);
    body.set(new TextEncoder().encode(name), 25);
    const directoryEntry = new GetDirectoryEntryReplyD2HPacket(
      hostPacket(86, 23, body),
    );
    expect(directoryEntry.file?.filename).toBe(name);

    const packets = [
      initFileTransfer(directoryEntry.file!.filename),
      new EraseFileH2DPacket(FileVendor.USER, directoryEntry.file!.filename),
      new GetFileMetadataH2DPacket(
        FileVendor.USER,
        directoryEntry.file!.filename,
        0,
      ),
    ];
    for (const packet of packets) {
      const filenameOffset =
        packet instanceof InitFileTransferH2DPacket ? 35 : 9;
      expect(packet.data.slice(filenameOffset, filenameOffset + 24)).toEqual(
        new TextEncoder().encode(name),
      );
    }
  });

  test("rejects keys that cannot fit with a null terminator", () => {
    expect(() => new ReadKeyValueH2DPacket("x".repeat(32))).toThrow(
      "Key must be at most 31 UTF-8 bytes",
    );
    expect(() => new WriteKeyValueH2DPacket("x".repeat(32), "value")).toThrow(
      "Key must be at most 31 UTF-8 bytes",
    );
  });
});
