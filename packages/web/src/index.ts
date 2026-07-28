import * as client from "./client.js";
import * as errors from "./errors.js";
import * as support from "./support.js";

export const createV5Client = client.createV5Client;
export const V5WebError = errors.V5WebError;
export const getWebSerialUnavailableReason =
  support.getWebSerialUnavailableReason;
export const isWebSerialSupported = support.isWebSerialSupported;
export type {
  V5Client,
  V5ClientOptions,
  V5ConnectionStatus,
  V5DeviceSnapshot,
  V5Snapshot,
  V5Store,
  V5Unsubscribe,
} from "./client.js";
export type {
  V5Console,
  V5ConsoleOptions,
  V5ConsoleSnapshot,
  V5ConsoleStatus,
} from "./console.js";
export type { WebSerialUnavailableReason } from "./support.js";
