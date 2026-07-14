import { VexEventsApiError, VexEventsResponseError } from "./errors.js";
import type {
  ApiErrorBody,
  Award,
  DateInput,
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
  PaginatedResponse,
  PaginationOptions,
  Program,
  Ranking,
  Season,
  Skill,
  Team,
} from "./types.js";

const DEFAULT_BASE_URL = "https://events.vex.com/api/v2";

type QueryValue = DateInput | boolean | number | readonly (number | string)[];
type QueryEntry = readonly [name: string, value: QueryValue | undefined];

export interface RequestOptions {
  signal?: AbortSignal;
}

export type Fetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface VexEventsClientOptions {
  /** Personal access token sent using bearer authentication. */
  token: string;
  /** Override for tests, proxies, or compatible API deployments. */
  baseUrl?: string;
  /** Fetch implementation to use. Defaults to globalThis.fetch. */
  fetch?: Fetch;
  /** Additional headers included with every request. */
  headers?: Readonly<Record<string, string>>;
}

export interface EventsResource {
  list(
    options?: ListEventsOptions,
    request?: RequestOptions,
  ): Promise<PaginatedResponse<Event>>;
  get(id: number, request?: RequestOptions): Promise<Event>;
  teams(
    id: number,
    options?: ListEventTeamsOptions,
    request?: RequestOptions,
  ): Promise<PaginatedResponse<Team>>;
  skills(
    id: number,
    options?: ListEventSkillsOptions,
    request?: RequestOptions,
  ): Promise<PaginatedResponse<Skill>>;
  awards(
    id: number,
    options?: ListEventAwardsOptions,
    request?: RequestOptions,
  ): Promise<PaginatedResponse<Award>>;
  matches(
    id: number,
    division: number,
    options?: ListDivisionMatchesOptions,
    request?: RequestOptions,
  ): Promise<PaginatedResponse<Match>>;
  finalistRankings(
    id: number,
    division: number,
    options?: ListDivisionRankingsOptions,
    request?: RequestOptions,
  ): Promise<PaginatedResponse<Ranking>>;
  rankings(
    id: number,
    division: number,
    options?: ListDivisionRankingsOptions,
    request?: RequestOptions,
  ): Promise<PaginatedResponse<Ranking>>;
}

export interface TeamsResource {
  list(
    options?: ListTeamsOptions,
    request?: RequestOptions,
  ): Promise<PaginatedResponse<Team>>;
  get(id: number, request?: RequestOptions): Promise<Team>;
  events(
    id: number,
    options?: ListTeamEventsOptions,
    request?: RequestOptions,
  ): Promise<PaginatedResponse<Event>>;
  matches(
    id: number,
    options?: ListTeamMatchesOptions,
    request?: RequestOptions,
  ): Promise<PaginatedResponse<Match>>;
  rankings(
    id: number,
    options?: ListTeamRankingsOptions,
    request?: RequestOptions,
  ): Promise<PaginatedResponse<Ranking>>;
  skills(
    id: number,
    options?: ListTeamSkillsOptions,
    request?: RequestOptions,
  ): Promise<PaginatedResponse<Skill>>;
  awards(
    id: number,
    options?: ListTeamAwardsOptions,
    request?: RequestOptions,
  ): Promise<PaginatedResponse<Award>>;
}

export interface ProgramsResource {
  list(
    options?: ListProgramsOptions,
    request?: RequestOptions,
  ): Promise<PaginatedResponse<Program>>;
  get(id: number, request?: RequestOptions): Promise<Program>;
}

export interface SeasonsResource {
  list(
    options?: ListSeasonsOptions,
    request?: RequestOptions,
  ): Promise<PaginatedResponse<Season>>;
  get(id: number, request?: RequestOptions): Promise<Season>;
  events(
    id: number,
    options?: ListSeasonEventsOptions,
    request?: RequestOptions,
  ): Promise<PaginatedResponse<Event>>;
}

function paginationEntries(options: PaginationOptions): QueryEntry[] {
  return [
    ["page", options.page],
    ["per_page", options.perPage],
  ];
}

function serializeDate(value: DateInput): string {
  return value instanceof Date ? value.toISOString() : value;
}

function appendQuery(url: URL, entries: readonly QueryEntry[]): void {
  for (const [name, value] of entries) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(name, String(item));
      continue;
    }
    url.searchParams.set(
      name,
      value instanceof Date ? serializeDate(value) : String(value),
    );
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  return (
    (body.code === undefined || typeof body.code === "number") &&
    (body.message === undefined || typeof body.message === "string")
  );
}

function normalizeErrorBody(value: unknown): ApiErrorBody | string | null {
  if (isApiErrorBody(value)) return value;
  return typeof value === "string" ? value : null;
}

export class VexEventsClient {
  readonly events: EventsResource;
  readonly teams: TeamsResource;
  readonly programs: ProgramsResource;
  readonly seasons: SeasonsResource;

  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetch: Fetch;
  private readonly headers: Readonly<Record<string, string>>;

  constructor(options: VexEventsClientOptions) {
    if (options.token.trim() === "") {
      throw new TypeError("token must not be empty");
    }

    this.token = options.token;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetch = options.fetch ?? globalThis.fetch;
    this.headers = options.headers ?? {};

    this.events = {
      list: (options = {}, request) =>
        this.request("/events", eventEntries(options), request),
      get: (id, request) => this.request(`/events/${id}`, [], request),
      teams: (id, options = {}, request) =>
        this.request(`/events/${id}/teams`, eventTeamEntries(options), request),
      skills: (id, options = {}, request) =>
        this.request(
          `/events/${id}/skills`,
          eventSkillEntries(options),
          request,
        ),
      awards: (id, options = {}, request) =>
        this.request(
          `/events/${id}/awards`,
          eventAwardEntries(options),
          request,
        ),
      matches: (id, division, options = {}, request) =>
        this.request(
          `/events/${id}/divisions/${division}/matches`,
          divisionMatchEntries(options),
          request,
        ),
      finalistRankings: (id, division, options = {}, request) =>
        this.request(
          `/events/${id}/divisions/${division}/finalistRankings`,
          divisionRankingEntries(options),
          request,
        ),
      rankings: (id, division, options = {}, request) =>
        this.request(
          `/events/${id}/divisions/${division}/rankings`,
          divisionRankingEntries(options),
          request,
        ),
    };

    this.teams = {
      list: (options = {}, request) =>
        this.request("/teams", teamEntries(options), request),
      get: (id, request) => this.request(`/teams/${id}`, [], request),
      events: (id, options = {}, request) =>
        this.request(`/teams/${id}/events`, teamEventEntries(options), request),
      matches: (id, options = {}, request) =>
        this.request(
          `/teams/${id}/matches`,
          teamMatchEntries(options),
          request,
        ),
      rankings: (id, options = {}, request) =>
        this.request(
          `/teams/${id}/rankings`,
          teamRankingEntries(options),
          request,
        ),
      skills: (id, options = {}, request) =>
        this.request(`/teams/${id}/skills`, teamSkillEntries(options), request),
      awards: (id, options = {}, request) =>
        this.request(`/teams/${id}/awards`, teamAwardEntries(options), request),
    };

    this.programs = {
      list: (options = {}, request) =>
        this.request(
          "/programs",
          [...paginationEntries(options), ["id[]", options.ids]],
          request,
        ),
      get: (id, request) => this.request(`/programs/${id}`, [], request),
    };

    this.seasons = {
      list: (options = {}, request) =>
        this.request("/seasons", seasonEntries(options), request),
      get: (id, request) => this.request(`/seasons/${id}`, [], request),
      events: (id, options = {}, request) =>
        this.request(
          `/seasons/${id}/events`,
          seasonEventEntries(options),
          request,
        ),
    };
  }

  private async request<T>(
    path: string,
    query: readonly QueryEntry[],
    options: RequestOptions | undefined,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    appendQuery(url, query);

    const response = await this.fetch(url, {
      headers: {
        ...this.headers,
        Accept: "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      signal: options?.signal,
    });

    const contentType = response.headers.get("content-type") ?? "";
    const isJson = contentType.includes("application/json");
    let body: unknown;
    try {
      body = isJson ? await response.json() : await response.text();
    } catch (error) {
      throw new VexEventsResponseError(
        "VEX Events API returned an unreadable response",
        url.toString(),
        error,
      );
    }

    if (!response.ok) {
      throw new VexEventsApiError(
        response.status,
        response.statusText,
        normalizeErrorBody(body),
        url.toString(),
      );
    }

    if (!isJson) {
      throw new VexEventsResponseError(
        "VEX Events API returned a non-JSON response",
        url.toString(),
      );
    }

    return body as T;
  }
}

function eventEntries(options: ListEventsOptions): QueryEntry[] {
  return [
    ...paginationEntries(options),
    ["id[]", options.ids],
    ["sku[]", options.skus],
    ["team[]", options.teams],
    ["season[]", options.seasons],
    ["start", options.start],
    ["end", options.end],
    ["region", options.region],
    ["level[]", options.levels],
    ["myEvents", options.myEvents],
    ["eventTypes[]", options.eventTypes],
  ];
}

function eventTeamEntries(options: ListEventTeamsOptions): QueryEntry[] {
  return [
    ...paginationEntries(options),
    ["number[]", options.numbers],
    ["registered", options.registered],
    ["grade[]", options.grades],
    ["country[]", options.countries],
    ["myTeams", options.myTeams],
  ];
}

function eventSkillEntries(options: ListEventSkillsOptions): QueryEntry[] {
  return [
    ...paginationEntries(options),
    ["team[]", options.teams],
    ["type[]", options.types],
  ];
}

function eventAwardEntries(options: ListEventAwardsOptions): QueryEntry[] {
  return [
    ...paginationEntries(options),
    ["team[]", options.teams],
    ["winner[]", options.winners],
  ];
}

function divisionMatchEntries(
  options: ListDivisionMatchesOptions,
): QueryEntry[] {
  return [
    ...paginationEntries(options),
    ["team[]", options.teams],
    ["round[]", options.rounds],
    ["instance[]", options.instances],
    ["matchnum[]", options.matchNumbers],
  ];
}

function divisionRankingEntries(
  options: ListDivisionRankingsOptions,
): QueryEntry[] {
  return [
    ...paginationEntries(options),
    ["team[]", options.teams],
    ["rank[]", options.ranks],
  ];
}

function teamEntries(options: ListTeamsOptions): QueryEntry[] {
  return [
    ...paginationEntries(options),
    ["id[]", options.ids],
    ["number[]", options.numbers],
    ["event[]", options.events],
    ["registered", options.registered],
    ["program[]", options.programs],
    ["grade[]", options.grades],
    ["country[]", options.countries],
    ["myTeams", options.myTeams],
  ];
}

function teamEventEntries(options: ListTeamEventsOptions): QueryEntry[] {
  return [
    ...paginationEntries(options),
    ["sku[]", options.skus],
    ["season[]", options.seasons],
    ["start", options.start],
    ["end", options.end],
    ["level[]", options.levels],
  ];
}

function teamMatchEntries(options: ListTeamMatchesOptions): QueryEntry[] {
  return [
    ...paginationEntries(options),
    ["event[]", options.events],
    ["season[]", options.seasons],
    ["round[]", options.rounds],
    ["instance[]", options.instances],
    ["matchnum[]", options.matchNumbers],
  ];
}

function teamRankingEntries(options: ListTeamRankingsOptions): QueryEntry[] {
  return [
    ...paginationEntries(options),
    ["event[]", options.events],
    ["rank[]", options.ranks],
    ["season[]", options.seasons],
  ];
}

function teamSkillEntries(options: ListTeamSkillsOptions): QueryEntry[] {
  return [
    ...paginationEntries(options),
    ["event[]", options.events],
    ["type[]", options.types],
    ["season[]", options.seasons],
  ];
}

function teamAwardEntries(options: ListTeamAwardsOptions): QueryEntry[] {
  return [
    ...paginationEntries(options),
    ["event[]", options.events],
    ["season[]", options.seasons],
  ];
}

function seasonEntries(options: ListSeasonsOptions): QueryEntry[] {
  return [
    ...paginationEntries(options),
    ["id[]", options.ids],
    ["program[]", options.programs],
    ["team[]", options.teams],
    ["start", options.start],
    ["end", options.end],
    ["active", options.active],
  ];
}

function seasonEventEntries(options: ListSeasonEventsOptions): QueryEntry[] {
  return [
    ...paginationEntries(options),
    ["sku[]", options.skus],
    ["team[]", options.teams],
    ["start", options.start],
    ["end", options.end],
    ["level[]", options.levels],
  ];
}
