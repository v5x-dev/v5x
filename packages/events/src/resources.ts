import { programs as programIds } from "./constants.js";
import type {
  Award,
  Event,
  ListDivisionMatchesOptions,
  ListDivisionRankingsOptions,
  ListEventAwardsOptions,
  ListEventsOptions,
  ListEventSkillsOptions,
  ListEventTeamsOptions,
  ListProgramsOptions,
  ListSeasonEventsOptions,
  ListSeasonsOptions,
  ListTeamAwardsOptions,
  ListTeamEventsOptions,
  ListTeamMatchesOptions,
  ListTeamRankingsOptions,
  ListTeamsOptions,
  ListTeamSkillsOptions,
  Match,
  Program,
  Ranking,
  Season,
  Skill,
  Team,
} from "./types.js";

export interface RequestOptions {
  signal?: AbortSignal;
  /**
   * Upper bound on how many pages a list method fetches before returning what
   * it has. List methods otherwise walk every page the API reports, which is
   * an unbounded sequential fetch for a large result set. Must be a positive
   * integer when provided.
   */
  maxPages?: number;
}

export type Fetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface RetryOptions {
  /** Total attempts per request, including the first. Defaults to 3. */
  maxAttempts?: number;
  /**
   * Upper bound on a single retry delay in milliseconds. Responses that
   * advertise a longer Retry-After fail immediately. Defaults to 30000.
   */
  maxDelayMs?: number;
}

export interface VexEventsClientOptions {
  /** Personal access token sent using bearer authentication. */
  token: string;
  /** Override for tests, proxies, or compatible API deployments. */
  baseUrl?: string;
  /** Fetch implementation to use. Defaults to globalThis.fetch. */
  fetch?: Fetch;
  /** Additional headers included with every request. */
  headers?: Readonly<Record<string, string>>;
  /**
   * Opt in to retrying rate-limited (429) and unavailable (503) requests after
   * the delay the API advertises through Retry-After. Requests still honor
   * abort signals while waiting. Disabled when omitted.
   */
  retry?: RetryOptions;
}

export interface EventsResource {
  search(
    options?: ListEventsOptions,
    request?: RequestOptions,
  ): Promise<Event[]>;
  get(id: number, request?: RequestOptions): Promise<Event>;
  getBySku(sku: string, request?: RequestOptions): Promise<Event | null>;
  teams(
    id: number,
    options?: ListEventTeamsOptions,
    request?: RequestOptions,
  ): Promise<Team[]>;
  skills(
    id: number,
    options?: ListEventSkillsOptions,
    request?: RequestOptions,
  ): Promise<Skill[]>;
  awards(
    id: number,
    options?: ListEventAwardsOptions,
    request?: RequestOptions,
  ): Promise<Award[]>;
  matches(
    id: number,
    division: number,
    options?: ListDivisionMatchesOptions,
    request?: RequestOptions,
  ): Promise<Match[]>;
  finalistRankings(
    id: number,
    division: number,
    options?: ListDivisionRankingsOptions,
    request?: RequestOptions,
  ): Promise<Ranking[]>;
  rankings(
    id: number,
    division: number,
    options?: ListDivisionRankingsOptions,
    request?: RequestOptions,
  ): Promise<Ranking[]>;
}

export interface TeamsResource {
  search(options?: ListTeamsOptions, request?: RequestOptions): Promise<Team[]>;
  get(id: number, request?: RequestOptions): Promise<Team>;
  getByNumber(
    number: string,
    programId: number,
    request?: RequestOptions,
  ): Promise<Team | null>;
  events(
    id: number,
    options?: ListTeamEventsOptions,
    request?: RequestOptions,
  ): Promise<Event[]>;
  matches(
    id: number,
    options?: ListTeamMatchesOptions,
    request?: RequestOptions,
  ): Promise<Match[]>;
  rankings(
    id: number,
    options?: ListTeamRankingsOptions,
    request?: RequestOptions,
  ): Promise<Ranking[]>;
  skills(
    id: number,
    options?: ListTeamSkillsOptions,
    request?: RequestOptions,
  ): Promise<Skill[]>;
  awards(
    id: number,
    options?: ListTeamAwardsOptions,
    request?: RequestOptions,
  ): Promise<Award[]>;
}

export type ProgramsResource = typeof programIds & {
  all(
    options?: ListProgramsOptions,
    request?: RequestOptions,
  ): Promise<Program[]>;
  get(id: number, request?: RequestOptions): Promise<Program>;
};

export interface SeasonsResource {
  all(
    options?: ListSeasonsOptions,
    request?: RequestOptions,
  ): Promise<Season[]>;
  get(id: number, request?: RequestOptions): Promise<Season>;
  events(
    id: number,
    options?: ListSeasonEventsOptions,
    request?: RequestOptions,
  ): Promise<Event[]>;
}
