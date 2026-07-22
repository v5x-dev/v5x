import * as client from "./client.js";
import * as constants from "./constants.js";
import * as errors from "./errors.js";

export const Robot = client.Robot;
export const programs = constants.programs;
export const rounds = constants.rounds;
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
export type {
  KnownProgramId,
  ProgramAbbreviation,
  Round,
} from "./constants.js";
export {
  getAlliance,
  getMatchOutcome,
  getMatchShortName,
  getMatchTeams,
  getTeamOutcome,
} from "./match.js";
export type { MatchOutcome, MatchTeamsOptions, TeamOutcome } from "./match.js";
export type * from "./types.js";
export { getEventUrl, getTeamUrl } from "./urls.js";
