import * as client from "./client.js";
import * as errors from "./errors.js";

export const Robot = client.Robot;
export const VexEventsApiError = errors.VexEventsApiError;
export const VexEventsResponseError = errors.VexEventsResponseError;
export type Robot = client.Robot;
export type VexEventsApiError = errors.VexEventsApiError;
export type VexEventsResponseError = errors.VexEventsResponseError;
export type {
  EventsResource,
  Fetch,
  ProgramsResource,
  RequestOptions,
  RetryOptions,
  SeasonsResource,
  TeamsResource,
  VexEventsClientOptions,
} from "./client.js";
export type * from "./types.js";
