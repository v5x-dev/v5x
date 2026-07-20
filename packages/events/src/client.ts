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
const DEFAULT_RETRY_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_MAX_DELAY_MS = 30_000;
const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
const RETRY_AFTER_STATUSES = new Set([429, 503]);

type QueryValue = DateInput | boolean | number | readonly (number | string)[];
type QueryEntry = readonly [name: string, value: QueryValue | undefined];
type ResponseShape = "object" | "paginated";

export interface RequestOptions {
  signal?: AbortSignal;
}

export type Fetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface RetryOptions {
  /**
   * Total attempts per request, including the first. Defaults to 3.
   */
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
   * Opt in to retrying rate-limited (429) requests after the delay the API
   * advertises through Retry-After. Requests still honor abort signals while
   * waiting. Disabled when omitted.
   */
  retry?: RetryOptions;
}

export interface EventsResource {
  list(
    options?: ListEventsOptions,
    request?: RequestOptions,
  ): Promise<PaginatedResponse<Event>>;
  listPages(
    options?: ListEventsOptions,
    request?: RequestOptions,
  ): AsyncIterableIterator<PaginatedResponse<Event>>;
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
  listPages(
    options?: ListTeamsOptions,
    request?: RequestOptions,
  ): AsyncIterableIterator<PaginatedResponse<Team>>;
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
  listPages(
    options?: ListProgramsOptions,
    request?: RequestOptions,
  ): AsyncIterableIterator<PaginatedResponse<Program>>;
  get(id: number, request?: RequestOptions): Promise<Program>;
}

export interface SeasonsResource {
  list(
    options?: ListSeasonsOptions,
    request?: RequestOptions,
  ): Promise<PaginatedResponse<Season>>;
  listPages(
    options?: ListSeasonsOptions,
    request?: RequestOptions,
  ): AsyncIterableIterator<PaginatedResponse<Season>>;
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

function isUsablePage(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 1;
}

async function* iteratePages<T, Options extends PaginationOptions>(
  options: Options,
  requestPage: (options: Options) => Promise<PaginatedResponse<T>>,
): AsyncGenerator<PaginatedResponse<T>, void, void> {
  let page = options.page ?? 1;

  while (true) {
    const response = await requestPage({ ...options, page });
    yield response;

    const reportedCurrentPage = isUsablePage(response.meta?.current_page)
      ? response.meta.current_page
      : page;
    const currentPage = Math.max(page, reportedCurrentPage);
    const lastPage = response.meta?.last_page;
    if (isUsablePage(lastPage)) {
      if (currentPage >= lastPage) return;
    } else if (
      typeof response.meta?.next_page_url !== "string" ||
      response.meta.next_page_url.length === 0
    ) {
      return;
    }

    page = Math.max(page, currentPage) + 1;
  }
}

function filterCancelledEvents(
  response: PaginatedResponse<Event>,
): PaginatedResponse<Event> {
  if (response.data === undefined) return response;

  return {
    ...response,
    data: response.data.filter(
      (event) => !/cancelled|canceled/i.test(event.name),
    ),
  };
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

function parseRetryAfterMs(headerValue: string | null): number | undefined {
  if (headerValue === null) return undefined;
  const value = headerValue.trim();
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const dateMs = Date.parse(value);
  if (Number.isNaN(dateMs)) return undefined;
  return Math.max(0, dateMs - Date.now());
}

function abortReason(signal: AbortSignal): unknown {
  return (
    signal.reason ?? new DOMException("The operation was aborted", "AbortError")
  );
}

function sleep(
  delayMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal === undefined) {
      setTimeout(resolve, delayMs);
      return;
    }
    if (signal.aborted) {
      reject(abortReason(signal));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function isJsonContentType(contentType: string): boolean {
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  return (
    mediaType === "application/json" || mediaType?.endsWith("+json") === true
  );
}

function isObjectResponse(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPaginatedResponse(value: unknown): boolean {
  if (!isObjectResponse(value)) return false;
  return (
    (value.data === undefined || Array.isArray(value.data)) &&
    (value.meta === undefined || isObjectResponse(value.meta))
  );
}

function hasResponseShape<T>(
  value: unknown,
  responseShape: ResponseShape,
): value is T {
  return responseShape === "paginated"
    ? isPaginatedResponse(value)
    : isObjectResponse(value);
}

export class Robot {
  readonly events: EventsResource;
  readonly teams: TeamsResource;
  readonly programs: ProgramsResource;
  readonly seasons: SeasonsResource;

  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetch: Fetch;
  private readonly headers: Readonly<Record<string, string>>;
  private readonly retry: RetryOptions | undefined;

  constructor(options: VexEventsClientOptions) {
    if (options.token.trim() === "") {
      throw new TypeError("token must not be empty");
    }

    this.token = options.token;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetch = options.fetch ?? globalThis.fetch;
    this.headers = options.headers ?? {};
    this.retry = options.retry;

    this.events = {
      list: (options = {}, request) =>
        this.request<PaginatedResponse<Event>>(
          "/events",
          eventEntries(options),
          request,
          "paginated",
        ).then(filterCancelledEvents),
      listPages: (options = {}, request) =>
        iteratePages(options, (pageOptions) =>
          this.request<PaginatedResponse<Event>>(
            "/events",
            eventEntries(pageOptions),
            request,
            "paginated",
          ).then(filterCancelledEvents),
        ),
      get: (id, request) =>
        this.request(`/events/${id}`, [], request, "object"),
      teams: (id, options = {}, request) =>
        this.request(
          `/events/${id}/teams`,
          eventTeamEntries(options),
          request,
          "paginated",
        ),
      skills: (id, options = {}, request) =>
        this.request(
          `/events/${id}/skills`,
          eventSkillEntries(options),
          request,
          "paginated",
        ),
      awards: (id, options = {}, request) =>
        this.request(
          `/events/${id}/awards`,
          eventAwardEntries(options),
          request,
          "paginated",
        ),
      matches: (id, division, options = {}, request) =>
        this.request(
          `/events/${id}/divisions/${division}/matches`,
          divisionMatchEntries(options),
          request,
          "paginated",
        ),
      finalistRankings: (id, division, options = {}, request) =>
        this.request(
          `/events/${id}/divisions/${division}/finalistRankings`,
          divisionRankingEntries(options),
          request,
          "paginated",
        ),
      rankings: (id, division, options = {}, request) =>
        this.request(
          `/events/${id}/divisions/${division}/rankings`,
          divisionRankingEntries(options),
          request,
          "paginated",
        ),
    };

    this.teams = {
      list: (options = {}, request) =>
        this.request("/teams", teamEntries(options), request, "paginated"),
      listPages: (options = {}, request) =>
        iteratePages(options, (pageOptions) =>
          this.request<PaginatedResponse<Team>>(
            "/teams",
            teamEntries(pageOptions),
            request,
            "paginated",
          ),
        ),
      get: (id, request) => this.request(`/teams/${id}`, [], request, "object"),
      events: (id, options = {}, request) =>
        this.request<PaginatedResponse<Event>>(
          `/teams/${id}/events`,
          teamEventEntries(options),
          request,
          "paginated",
        ).then(filterCancelledEvents),
      matches: (id, options = {}, request) =>
        this.request(
          `/teams/${id}/matches`,
          teamMatchEntries(options),
          request,
          "paginated",
        ),
      rankings: (id, options = {}, request) =>
        this.request(
          `/teams/${id}/rankings`,
          teamRankingEntries(options),
          request,
          "paginated",
        ),
      skills: (id, options = {}, request) =>
        this.request(
          `/teams/${id}/skills`,
          teamSkillEntries(options),
          request,
          "paginated",
        ),
      awards: (id, options = {}, request) =>
        this.request(
          `/teams/${id}/awards`,
          teamAwardEntries(options),
          request,
          "paginated",
        ),
    };

    this.programs = {
      list: (options = {}, request) =>
        this.request(
          "/programs",
          [...paginationEntries(options), ["id[]", options.ids]],
          request,
          "paginated",
        ),
      listPages: (options = {}, request) =>
        iteratePages(options, (pageOptions) =>
          this.request<PaginatedResponse<Program>>(
            "/programs",
            [...paginationEntries(pageOptions), ["id[]", pageOptions.ids]],
            request,
            "paginated",
          ),
        ),
      get: (id, request) =>
        this.request(`/programs/${id}`, [], request, "object"),
    };

    this.seasons = {
      list: (options = {}, request) =>
        this.request("/seasons", seasonEntries(options), request, "paginated"),
      listPages: (options = {}, request) =>
        iteratePages(options, (pageOptions) =>
          this.request<PaginatedResponse<Season>>(
            "/seasons",
            seasonEntries(pageOptions),
            request,
            "paginated",
          ),
        ),
      get: (id, request) =>
        this.request(`/seasons/${id}`, [], request, "object"),
      events: (id, options = {}, request) =>
        this.request<PaginatedResponse<Event>>(
          `/seasons/${id}/events`,
          seasonEventEntries(options),
          request,
          "paginated",
        ).then(filterCancelledEvents),
    };
  }

  private async request<T>(
    path: string,
    query: readonly QueryEntry[],
    options: RequestOptions | undefined,
    responseShape: ResponseShape,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    appendQuery(url, query);

    const retry = this.retry;
    if (retry === undefined) {
      return this.requestOnce(url, path, options, responseShape);
    }

    const maxAttempts = retry.maxAttempts ?? DEFAULT_RETRY_MAX_ATTEMPTS;
    const maxDelayMs = retry.maxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.requestOnce(url, path, options, responseShape);
      } catch (error) {
        if (
          attempt >= maxAttempts ||
          !(error instanceof VexEventsApiError) ||
          error.status !== 429
        ) {
          throw error;
        }
        const delayMs =
          error.retryAfterMs ??
          Math.min(
            DEFAULT_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
            maxDelayMs,
          );
        if (delayMs > maxDelayMs) throw error;
        await sleep(delayMs, options?.signal);
      }
    }
  }

  private async requestOnce<T>(
    url: URL,
    path: string,
    options: RequestOptions | undefined,
    responseShape: ResponseShape,
  ): Promise<T> {
    const response = await this.fetch(url, {
      headers: {
        ...this.headers,
        Accept: "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      signal: options?.signal,
    });

    const contentType = response.headers.get("content-type") ?? "";
    const isJson = isJsonContentType(contentType);
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
        RETRY_AFTER_STATUSES.has(response.status)
          ? parseRetryAfterMs(response.headers.get("retry-after"))
          : undefined,
      );
    }

    if (!isJson) {
      throw new VexEventsResponseError(
        "VEX Events API returned a non-JSON response",
        url.toString(),
      );
    }

    if (!hasResponseShape<T>(body, responseShape)) {
      throw new VexEventsResponseError(
        `VEX Events API returned an invalid response for ${path}`,
        url.toString(),
      );
    }

    return body;
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
