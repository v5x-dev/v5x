export * from "./VexPacketBase.js";
export * from "./VexPacketEncoder.js";
export * from "./VexPacketModels.js";

import { PacketEncoder } from "./VexPacketEncoder.js";
import { defaultReplyPacketTypes } from "./VexPacketRegistry.js";

PacketEncoder.getInstance().registerPacketTypes(defaultReplyPacketTypes);
