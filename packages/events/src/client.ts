import { VexEventsApiError, VexEventsResponseError } from "./errors.js";
import { programs as programIds, rounds as roundIds } from "./constants.js";
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
  Program,
  Ranking,
  Season,
  Skill,
  Team,
} from "./types.js";
import {
  isAward,
  isEvent,
  isMatch,
  isProgram,
  isRanking,
  isSeason,
  isSkill,
  isTeam,
  paginated,
  type Validator,
} from "./validation.js";

const DEFAULT_BASE_URL = "https://events.vex.com/api/v2";
const DEFAULT_RETRY_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_MAX_DELAY_MS = 30_000;
const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
const RETRY_AFTER_STATUSES = new Set([429, 503]);
const PER_PAGE = 250;
/**
 * How many pages a list method fetches at once once the page count is known.
 * Kept small so walking a large result set stays well clear of the API's rate
 * limit, which costs a retry round trip and erases the gain.
 */
const PAGE_CONCURRENCY = 4;

type QueryValue = DateInput | boolean | number | readonly (number | string)[];
type QueryEntry = readonly [name: string, value: QueryValue | undefined];

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

/**
 * Runs `map` over `items` with at most `limit` in flight, resolving to the
 * results in input order. The first rejection propagates and no further items
 * are started, matching the fail-fast behavior of a sequential walk.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  map: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;

  const worker = async (): Promise<void> => {
    while (!failed) {
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = await map(items[index]!);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

function isUsablePage(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 1;
}

function pageFromUrl(value: string | null | undefined): number | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  try {
    const page = Number(
      new URL(value, DEFAULT_BASE_URL).searchParams.get("page"),
    );
    return isUsablePage(page) ? page : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The API exposes no cancellation flag, so the event name is the only
 * available signal. This necessarily misses cancellations that are not
 * spelled out in the name.
 */
const CANCELLED_EVENT_NAME = /cancelled|canceled/i;

function filterCancelledEvents(
  events: Event[],
  includeCancelled: boolean | undefined,
): Event[] {
  if (includeCancelled !== false) return events;
  return events.filter((event) => !CANCELLED_EVENT_NAME.test(event.name));
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

export class Robot {
  readonly rounds = roundIds;
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
    if (
      options.retry?.maxAttempts !== undefined &&
      (!Number.isInteger(options.retry.maxAttempts) ||
        options.retry.maxAttempts <= 0)
    ) {
      throw new RangeError("retry.maxAttempts must be a positive integer");
    }
    if (
      options.retry?.maxDelayMs !== undefined &&
      (!Number.isFinite(options.retry.maxDelayMs) ||
        options.retry.maxDelayMs < 0)
    ) {
      throw new RangeError(
        "retry.maxDelayMs must be a finite non-negative number",
      );
    }

    this.token = options.token;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetch = options.fetch ?? globalThis.fetch;
    this.headers = options.headers ?? {};
    this.retry = options.retry;

    this.events = {
      search: (options = {}, request) =>
        this.requestAllPages(
          "/events",
          eventEntries(options),
          request,
          isEvent,
        ).then((events) =>
          filterCancelledEvents(events, options.includeCancelled),
        ),
      get: (id, request) => this.request(`/events/${id}`, [], request, isEvent),
      getBySku: async (sku, request) => {
        if (sku.trim() === "") throw new TypeError("sku must not be empty");
        const events = await this.requestAllPages(
          "/events",
          [["sku[]", [sku]]],
          request,
          isEvent,
        );
        return events.find((event) => event.sku === sku) ?? null;
      },
      teams: (id, options = {}, request) =>
        this.requestAllPages(
          `/events/${id}/teams`,
          eventTeamEntries(options),
          request,
          isTeam,
        ),
      skills: (id, options = {}, request) =>
        this.requestAllPages(
          `/events/${id}/skills`,
          eventSkillEntries(options),
          request,
          isSkill,
        ),
      awards: (id, options = {}, request) =>
        this.requestAllPages(
          `/events/${id}/awards`,
          eventAwardEntries(options),
          request,
          isAward,
        ),
      matches: (id, division, options = {}, request) =>
        this.requestAllPages(
          `/events/${id}/divisions/${division}/matches`,
          divisionMatchEntries(options),
          request,
          isMatch,
        ),
      finalistRankings: (id, division, options = {}, request) =>
        this.requestAllPages(
          `/events/${id}/divisions/${division}/finalistRankings`,
          divisionRankingEntries(options),
          request,
          isRanking,
        ),
      rankings: (id, division, options = {}, request) =>
        this.requestAllPages(
          `/events/${id}/divisions/${division}/rankings`,
          divisionRankingEntries(options),
          request,
          isRanking,
        ),
    };

    this.teams = {
      search: (options = {}, request) =>
        this.requestAllPages("/teams", teamEntries(options), request, isTeam),
      get: (id, request) => this.request(`/teams/${id}`, [], request, isTeam),
      getByNumber: async (number, programId, request) => {
        if (number.trim() === "") {
          throw new TypeError("team number must not be empty");
        }
        const teams = await this.requestAllPages(
          "/teams",
          [
            ["number[]", [number]],
            ["program[]", [programId]],
          ],
          request,
          isTeam,
        );
        return (
          teams.find(
            (team) => team.number === number && team.program.id === programId,
          ) ?? null
        );
      },
      events: (id, options = {}, request) =>
        this.requestAllPages(
          `/teams/${id}/events`,
          teamEventEntries(options),
          request,
          isEvent,
        ).then((events) =>
          filterCancelledEvents(events, options.includeCancelled),
        ),
      matches: (id, options = {}, request) =>
        this.requestAllPages(
          `/teams/${id}/matches`,
          teamMatchEntries(options),
          request,
          isMatch,
        ),
      rankings: (id, options = {}, request) =>
        this.requestAllPages(
          `/teams/${id}/rankings`,
          teamRankingEntries(options),
          request,
          isRanking,
        ),
      skills: (id, options = {}, request) =>
        this.requestAllPages(
          `/teams/${id}/skills`,
          teamSkillEntries(options),
          request,
          isSkill,
        ),
      awards: (id, options = {}, request) =>
        this.requestAllPages(
          `/teams/${id}/awards`,
          teamAwardEntries(options),
          request,
          isAward,
        ),
    };

    this.programs = {
      ...programIds,
      all: (options = {}, request) =>
        this.requestAllPages(
          "/programs",
          [["id[]", options.ids]],
          request,
          isProgram,
        ),
      get: (id, request) =>
        this.request(`/programs/${id}`, [], request, isProgram),
    };

    this.seasons = {
      all: (options = {}, request) =>
        this.requestAllPages(
          "/seasons",
          seasonEntries(options),
          request,
          isSeason,
        ),
      get: (id, request) =>
        this.request(`/seasons/${id}`, [], request, isSeason),
      events: (id, options = {}, request) =>
        this.requestAllPages(
          `/seasons/${id}/events`,
          seasonEventEntries(options),
          request,
          isEvent,
        ).then((events) =>
          filterCancelledEvents(events, options.includeCancelled),
        ),
    };
  }

  private async requestAllPages<T>(
    path: string,
    query: readonly QueryEntry[],
    options: RequestOptions | undefined,
    validateItem: Validator<T>,
  ): Promise<T[]> {
    const maxPages = options?.maxPages;
    if (
      maxPages !== undefined &&
      (!Number.isInteger(maxPages) || maxPages <= 0)
    ) {
      throw new RangeError("maxPages must be a positive integer");
    }

    const data: T[] = [];
    const visitedPages = new Set<number>([1]);
    let page = 1;
    let response = await this.requestPage(
      path,
      query,
      options,
      validateItem,
      1,
    );

    for (let isFirstPage = true; ; isFirstPage = false) {
      data.push(...response.data);

      const reportedCurrentPage = isUsablePage(response.meta.current_page)
        ? response.meta.current_page
        : page;
      const currentPage = Math.max(page, reportedCurrentPage);
      const lastPage = response.meta.last_page;
      if (isUsablePage(lastPage) && currentPage >= lastPage) break;

      const linkedPage = pageFromUrl(response.meta.next_page_url);
      let nextPage: number | undefined;
      if (
        linkedPage !== undefined &&
        linkedPage > currentPage &&
        (!isUsablePage(lastPage) || linkedPage <= lastPage)
      ) {
        nextPage = linkedPage;
      } else if (isUsablePage(lastPage) && currentPage < lastPage) {
        nextPage = currentPage + 1;
      }
      if (nextPage === undefined) break;

      // When the first response reports a page count and links straight to the
      // next page, the rest of the result set is a contiguous run of
      // independent requests rather than a chain, so it can be fetched
      // concurrently. A chain that skips pages stays a one-hop-at-a-time walk,
      // because only the previous response reveals where it goes next.
      if (
        isFirstPage &&
        isUsablePage(lastPage) &&
        nextPage === currentPage + 1
      ) {
        const budget =
          maxPages === undefined ? Infinity : maxPages - visitedPages.size;
        const limit = Math.min(lastPage, nextPage + budget - 1);
        const pages: number[] = [];
        for (let next = nextPage; next <= limit; next++) pages.push(next);

        const pageData = await mapWithConcurrency(
          pages,
          PAGE_CONCURRENCY,
          (next) =>
            this.requestPage(path, query, options, validateItem, next).then(
              (page) => page.data,
            ),
        );
        for (const items of pageData) data.push(...items);
        break;
      }

      if (visitedPages.has(nextPage)) break;
      if (maxPages !== undefined && visitedPages.size >= maxPages) break;
      visitedPages.add(nextPage);
      page = nextPage;
      response = await this.requestPage(
        path,
        query,
        options,
        validateItem,
        page,
      );
    }

    return data;
  }

  private requestPage<T>(
    path: string,
    query: readonly QueryEntry[],
    options: RequestOptions | undefined,
    validateItem: Validator<T>,
    page: number,
  ): Promise<PaginatedResponse<T>> {
    return this.request(
      path,
      [["page", page], ["per_page", PER_PAGE], ...query],
      options,
      paginated(validateItem),
    );
  }

  private async request<T>(
    path: string,
    query: readonly QueryEntry[],
    options: RequestOptions | undefined,
    validate: Validator<T>,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    appendQuery(url, query);

    const retry = this.retry;
    if (retry === undefined) {
      return this.requestOnce(url, path, options, validate);
    }

    const maxAttempts = retry.maxAttempts ?? DEFAULT_RETRY_MAX_ATTEMPTS;
    const maxDelayMs = retry.maxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.requestOnce(url, path, options, validate);
      } catch (error) {
        if (
          attempt >= maxAttempts ||
          !(error instanceof VexEventsApiError) ||
          !RETRY_AFTER_STATUSES.has(error.status)
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
    validate: Validator<T>,
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

    if (!validate(body)) {
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
    ["number[]", options.numbers],
    ["registered", options.registered],
    ["grade[]", options.grades],
    ["country[]", options.countries],
    ["myTeams", options.myTeams],
  ];
}

function eventSkillEntries(options: ListEventSkillsOptions): QueryEntry[] {
  return [
    ["team[]", options.teams],
    ["type[]", options.types],
  ];
}

function eventAwardEntries(options: ListEventAwardsOptions): QueryEntry[] {
  return [
    ["team[]", options.teams],
    ["winner[]", options.winners],
  ];
}

function divisionMatchEntries(
  options: ListDivisionMatchesOptions,
): QueryEntry[] {
  return [
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
    ["team[]", options.teams],
    ["rank[]", options.ranks],
  ];
}

function teamEntries(options: ListTeamsOptions): QueryEntry[] {
  return [
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
    ["sku[]", options.skus],
    ["season[]", options.seasons],
    ["start", options.start],
    ["end", options.end],
    ["level[]", options.levels],
  ];
}

function teamMatchEntries(options: ListTeamMatchesOptions): QueryEntry[] {
  return [
    ["event[]", options.events],
    ["season[]", options.seasons],
    ["round[]", options.rounds],
    ["instance[]", options.instances],
    ["matchnum[]", options.matchNumbers],
  ];
}

function teamRankingEntries(options: ListTeamRankingsOptions): QueryEntry[] {
  return [
    ["event[]", options.events],
    ["rank[]", options.ranks],
    ["season[]", options.seasons],
  ];
}

function teamSkillEntries(options: ListTeamSkillsOptions): QueryEntry[] {
  return [
    ["event[]", options.events],
    ["type[]", options.types],
    ["season[]", options.seasons],
  ];
}

function teamAwardEntries(options: ListTeamAwardsOptions): QueryEntry[] {
  return [
    ["event[]", options.events],
    ["season[]", options.seasons],
  ];
}

function seasonEntries(options: ListSeasonsOptions): QueryEntry[] {
  return [
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
    ["sku[]", options.skus],
    ["team[]", options.teams],
    ["start", options.start],
    ["end", options.end],
    ["level[]", options.levels],
  ];
}
