import { createV5ClientWithFactory as createClientWithFactory } from "./client.js";

export function createV5ClientWithFactory(
  ...parameters: Parameters<typeof createClientWithFactory>
): ReturnType<typeof createClientWithFactory> {
  return createClientWithFactory(...parameters);
}
export type {
  V5Client,
  V5ClientOptions,
  V5ConnectionStatus,
  V5DeviceFactory,
  V5DeviceLike,
  V5DeviceSnapshot,
  V5Snapshot,
  V5Store,
  V5Unsubscribe,
} from "./client.js";
