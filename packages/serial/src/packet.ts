export * from "./packet-base.js";
export * from "./packet-encoder.js";
export * from "./packet-models.js";

import { PacketEncoder } from "./packet-encoder.js";
import { defaultReplyPacketTypes } from "./packet-registry.js";

PacketEncoder.getInstance().registerPacketTypes(defaultReplyPacketTypes);
