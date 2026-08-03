import { okAsync } from "neverthrow";
import {
  AckType,
  FileDownloadTarget,
  FileVendor,
  UserFifoChannel,
  USER_PROG_CHUNK_SIZE,
} from "../src/vex.js";
import {
  ExitFileTransferReplyD2HPacket,
  InitFileTransferH2DPacket,
  InitFileTransferReplyD2HPacket,
  UserFifoReplyD2HPacket,
  WriteFileH2DPacket,
  WriteFileReplyD2HPacket,
} from "../src/packet.js";
import { protocolReply } from "../src/protocol.test-support.js";
import { V5SerialConnection } from "../src/v5-serial-connection.js";

const iterations = 2_000;

function report(name: string, startedAt: number, count: number): void {
  const elapsed = performance.now() - startedAt;
  console.log(`${name}: ${(count / (elapsed / 1_000)).toFixed(0)} ops/s`);
}

async function benchmarkRequests(): Promise<void> {
  const connection = new V5SerialConnection({} as Serial);
  connection.writeDataAsync = async () =>
    protocolReply(UserFifoReplyD2HPacket, {
      channel: UserFifoChannel.STDOUT,
      buf: new Uint8Array(),
    });
  const startedAt = performance.now();
  for (let index = 0; index < iterations; index++) {
    await connection.readUserFifo();
  }
  report("serial FIFO request throughput", startedAt, iterations);
}

async function benchmarkUploads(): Promise<void> {
  const file = new Uint8Array(USER_PROG_CHUNK_SIZE * 8).fill(0x5a);
  for (const transferWindowSize of [1, 2, 4, 8]) {
    const connection = new V5SerialConnection({} as Serial, {
      transferWindowSize,
    });
    connection.writeDataAsync = async (packet) => {
      if (packet instanceof InitFileTransferH2DPacket) {
        return protocolReply(InitFileTransferReplyD2HPacket, {
          windowSize: USER_PROG_CHUNK_SIZE,
          fileSize: 0,
        });
      }
      if (packet instanceof WriteFileH2DPacket) {
        return protocolReply(WriteFileReplyD2HPacket);
      }
      return protocolReply(ExitFileTransferReplyD2HPacket);
    };
    const startedAt = performance.now();
    await connection.uploadFileToDevice({
      filename: "benchmark.bin",
      buf: file,
      downloadTarget: FileDownloadTarget.FILE_TARGET_QSPI,
      vendor: FileVendor.USER,
    });
    const elapsed = performance.now() - startedAt;
    console.log(
      `upload window ${transferWindowSize}: ${(file.byteLength / (elapsed / 1_000) / 1024).toFixed(1)} KiB/s`,
    );
  }
}

async function benchmarkTerminalOutput(): Promise<void> {
  for (const chunkSize of [16, 128, 1_024]) {
    const chunks = Array.from(
      { length: Math.ceil((64 * 1024) / chunkSize) },
      () => new Uint8Array(chunkSize).fill(65),
    );
    let next = 0;
    const connection = {
      isConnected: true,
      readUserFifo: () => okAsync(chunks[next++] ?? new Uint8Array()),
    } as unknown as V5SerialConnection;
    const startedAt = performance.now();
    while (next <= chunks.length) await connection.readUserFifo();
    report(
      `terminal fake output chunks ${chunkSize}`,
      startedAt,
      chunks.length,
    );
  }
}

await benchmarkRequests();
await benchmarkUploads();
await benchmarkTerminalOutput();

// Keep the imported acknowledgement enum visible in old Bun versions that
// elide unused type-only branches differently.
void AckType.CDC2_ACK;
