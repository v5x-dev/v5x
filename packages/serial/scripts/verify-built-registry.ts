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

const esm = (await import("../dist/index.js")) as BuiltSerialModule;
const require = createRequire(import.meta.url);
const cjs = require("../dist/index.cjs") as BuiltSerialModule;

verifyRegistry(esm, "ESM");
verifyRegistry(cjs, "CommonJS");
