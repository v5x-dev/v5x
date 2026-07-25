import { createRequire } from "node:module";

interface PacketType {
  name: string;
}

interface PacketEncoderInstance {
  getPacketType(
    commandId: number,
    commandExtendedId: number | undefined,
  ): PacketType | undefined;
}

interface PacketEncoderConstructor {
  getInstance(): PacketEncoderInstance;
}

interface ReplyPacketConstructor extends PacketType {
  COMMAND_ID: number;
  COMMAND_EXTENDED_ID: number | undefined;
}

interface BuiltSerialModule {
  PacketEncoder: PacketEncoderConstructor;
  Query1ReplyD2HPacket: ReplyPacketConstructor;
  ReadFileReplyD2HPacket: ReplyPacketConstructor;
}

function verifyRegistry(module: BuiltSerialModule, format: string): void {
  const encoder = module.PacketEncoder.getInstance();
  for (const ReplyType of [
    module.Query1ReplyD2HPacket,
    module.ReadFileReplyD2HPacket,
  ]) {
    const registered = encoder.getPacketType(
      ReplyType.COMMAND_ID,
      ReplyType.COMMAND_EXTENDED_ID,
    );
    if (registered !== ReplyType) {
      throw new Error(
        `${format} serial bundle did not register ${ReplyType.name}`,
      );
    }
  }
}

interface BuiltPacketCoreModule {
  PacketEncoder: PacketEncoderConstructor;
  HostBoundPacket: new (data: Uint8Array) => unknown;
}

/**
 * The `packet-core` entry exposes the packet classes without the reply
 * registry, so it has its own way to leave `Packet.ENCODER` unpopulated.
 * Construct a packet to prove the encoder is wired up on this path too.
 */
function verifyPacketCore(module: BuiltPacketCoreModule, format: string): void {
  try {
    new module.HostBoundPacket(Uint8Array.of(170, 85, 0, 0, 0));
  } catch (error) {
    throw new Error(
      `${format} packet-core bundle cannot construct a packet: ${String(error)}`,
    );
  }
}

const esm = (await import("../dist/index.js")) as BuiltSerialModule;
const esmPacketCore =
  (await import("../dist/packet-core.js")) as BuiltPacketCoreModule;
const require = createRequire(import.meta.url);
const cjs = require("../dist/index.cjs") as BuiltSerialModule;
const cjsPacketCore =
  require("../dist/packet-core.cjs") as BuiltPacketCoreModule;

verifyRegistry(esm, "ESM");
verifyRegistry(cjs, "CommonJS");
verifyPacketCore(esmPacketCore, "ESM");
verifyPacketCore(cjsPacketCore, "CommonJS");
