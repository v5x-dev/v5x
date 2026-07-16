import type { IPacketCallback } from "./Vex.js";
import { PacketEncoder } from "./VexPacket.js";
import { ReceiveBuffer } from "./ReceiveBuffer.js";
import { ReaderClosedError } from "./ReaderClosedError.js";

export interface PacketReaderOptions {
  readData: (cache: ReceiveBuffer, expectedSize: number) => Promise<void>;
  shiftCallback: (
    commandId: number,
    commandExtendedId: number | undefined,
  ) => IPacketCallback | undefined;
  reportWarning: (message: string, details?: unknown) => void;
  close: () => Promise<void>;
}

/** Frame, validate, and dispatch packets until the transport reader closes. */
export async function runPacketReader({
  readData,
  shiftCallback,
  reportWarning,
  close,
}: PacketReaderOptions): Promise<void> {
  const encoder = PacketEncoder.getInstance();
  const cache = new ReceiveBuffer();
  let sliceIdx = 0;
  for (;;)
    try {
      await readData(cache, 5);
      sliceIdx = 0;

      while (!encoder.validateHeader(cache.bytes)) {
        const bytes = cache.bytes;
        const nextHeader = bytes.findIndex(
          (byte, index) =>
            index > 0 &&
            byte === PacketEncoder.HEADER_TO_HOST[0] &&
            bytes[index + 1] === PacketEncoder.HEADER_TO_HOST[1],
        );
        if (nextHeader >= 0) {
          cache.discard(nextHeader);
        } else {
          cache.discard(
            bytes.at(-1) === PacketEncoder.HEADER_TO_HOST[0]
              ? -1
              : bytes.length,
          );
        }
        await readData(cache, 5);
      }

      const payloadExpectedSize = encoder.getPayloadSize(cache.bytes);
      const headerLength = encoder.getHostHeaderLength(cache.bytes);
      const totalSize = headerLength + payloadExpectedSize;

      await readData(cache, totalSize);
      sliceIdx = totalSize;
      const packet = cache.copy(totalSize);

      const commandId = packet[2]!;
      const hasExtendedId = commandId === 88 || commandId === 86;
      const commandExtendedId = hasExtendedId
        ? packet[headerLength]
        : undefined;
      const ack = packet[headerLength + 1]!;

      if (hasExtendedId && !encoder.validateMessageCdc(packet)) {
        reportWarning("discarding a reply with an invalid CDC CRC", {
          commandId,
          commandExtendedId,
          ack,
        });
        continue;
      }

      const callback = shiftCallback(commandId, commandExtendedId);
      if (callback === undefined) {
        reportWarning("received a reply with no matching request", {
          commandId,
          commandExtendedId,
          ack,
        });
        continue;
      }

      const wantedCommandId = callback.wantedCommandId;
      const wantedCommandExtendedId = callback.wantedCommandExId;
      const PacketType = encoder.getPacketType(
        wantedCommandId,
        wantedCommandExtendedId,
      );
      if (wantedCommandId === undefined || PacketType === undefined) {
        if (wantedCommandId !== undefined) {
          reportWarning(
            "no packet class is registered for the wanted command",
            {
              commandId: wantedCommandId,
              commandExtendedId: wantedCommandExtendedId,
            },
          );
        }
        callback.callback(packet.buffer);
      } else if (PacketType.isValidPacket(packet, headerLength)) {
        callback.callback(new PacketType(packet));
      } else {
        reportWarning(
          "reply failed packet validation; delivering its ack instead",
          { commandId, commandExtendedId, ack },
        );
        callback.callback(ack);
      }

      clearTimeout(callback.timeout);
    } catch (error) {
      if (!(error instanceof ReaderClosedError)) {
        reportWarning("reader loop stopped by a read error", {
          error,
          pendingBytes: cache.bytes,
        });
      }

      await close();
      break;
    } finally {
      cache.discard(sliceIdx);
    }
}
