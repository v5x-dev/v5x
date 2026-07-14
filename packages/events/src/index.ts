import * as client from "./client.js";
import * as errors from "./errors.js";

export const VexEventsClient = client.VexEventsClient;
export const VexEventsApiError = errors.VexEventsApiError;
export const VexEventsResponseError = errors.VexEventsResponseError;
export type VexEventsClient = client.VexEventsClient;
export type VexEventsApiError = errors.VexEventsApiError;
export type VexEventsResponseError = errors.VexEventsResponseError;
export type {
  EventsResource,
  Fetch,
  ProgramsResource,
  RequestOptions,
  SeasonsResource,
  TeamsResource,
  VexEventsClientOptions,
} from "./client.js";
export type * from "./types.js";
