import { describe, expect, test } from "bun:test";
import {
  Robot,
  VexEventsApiError,
  VexEventsResponseError,
  type Event,
  type Fetch,
  type ListEventsOptions,
  type Match,
  type Team,
} from "./index.js";

interface CapturedRequest {
  url: URL;
  init?: RequestInit;
}

type Responder = (
  request: CapturedRequest,
  requestNumber: number,
) => Response | Promise<Response>;

function toUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) return new URL(input);
  return new URL(typeof input === "string" ? input : input.url);
}

const idInfo = { id: 1, name: "V5RC", code: "V5RC" } as const;

function validEvent(id = 1): Event {
  return {
    id,
    sku: `RE-${id}`,
    name: `Event ${id}`,
    season: idInfo,
    program: idInfo,
    location: {},
    event_type: "tournament",
  };
}

function validTeam(id = 1): Team {
  return {
    id,
    number: `123${id}`,
    program: idInfo,
  };
}

function validMatch(id = 1): Match {
  return {
    id,
    event: idInfo,
    division: idInfo,
    round: 2,
    instance: 1,
    matchnum: id,
    scored: true,
    name: `Qualification ${id}`,
    alliances: [],
  };
}

function createDynamicClient(responder: Responder) {
  const requests: CapturedRequest[] = [];
  const mockFetch: Fetch = async (input, init) => {
    const request = { url: toUrl(input), init };
    requests.push(request);
    return responder(request, requests.length);
  };
  return {
    client: new Robot({
      token: "test-token",
      baseUrl: "https://example.test/api/v2",
      fetch: mockFetch,
      headers: { "X-Client": "test" },
    }),
    requests,
  };
}

function createMockClient(
  body: unknown = { data: [], meta: {} },
  init?: ResponseInit,
) {
  return createDynamicClient(() => Response.json(body, init));
}

function endpointResponse(url: URL): Response {
  const path = url.pathname;
  if (/\/events\/\d+$/.test(path)) return Response.json(validEvent(10));
  if (/\/teams\/\d+$/.test(path)) return Response.json(validTeam(20));
  if (/\/programs\/\d+$/.test(path)) {
    return Response.json({ id: 1, name: "V5RC", abbr: "V5RC" });
  }
  if (/\/seasons\/\d+$/.test(path)) {
    return Response.json({ id: 2, name: "Season", program: idInfo });
  }

  let data: unknown[] = [];
  if (path.endsWith("/matches")) data = [validMatch()];
  else if (path.endsWith("/rankings") || path.endsWith("/finalistRankings")) {
    data = [{ id: 1, event: idInfo, division: idInfo, team: idInfo, rank: 1 }];
  } else if (path.endsWith("/skills")) {
    data = [{ id: 1, event: idInfo, team: idInfo, type: "driver", score: 42 }];
  } else if (path.endsWith("/awards")) {
    data = [{ id: 1, event: idInfo, title: "Excellence Award" }];
  } else if (path.endsWith("/teams")) {
    data = [validTeam()];
  } else if (path.endsWith("/events")) {
    data = [validEvent()];
  } else if (path.endsWith("/programs")) {
    data = [{ id: 1, name: "V5RC", abbr: "V5RC" }];
  } else if (path.endsWith("/seasons")) {
    data = [{ id: 2, name: "Season", program: idInfo }];
  }
  return Response.json({ data, meta: { current_page: 1, last_page: 1 } });
}

describe("Robot", () => {
  test("requires a non-empty token", () => {
    expect(() => new Robot({ token: "  " })).toThrow("token must not be empty");
  });

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid retry maxAttempts %p",
    (maxAttempts) => {
      expect(
        () => new Robot({ token: "token", retry: { maxAttempts } }),
      ).toThrow("retry.maxAttempts must be a positive integer");
    },
  );

  test.each([
    -1,
    Number.NaN,
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ])("rejects invalid retry maxDelayMs %p", (maxDelayMs) => {
    expect(() => new Robot({ token: "token", retry: { maxDelayMs } })).toThrow(
      "retry.maxDelayMs must be a finite non-negative number",
    );
  });

  test("serializes filters and always starts automatic pagination at 250 items", async () => {
    const { client, requests } = createDynamicClient(() =>
      Response.json({
        data: [validEvent()],
        meta: { current_page: 1, last_page: 1 },
      }),
    );

    await expect(
      client.events.search({
        ids: [1, 2],
        skus: ["RE-1"],
        teams: [3],
        seasons: [4],
        start: new Date("2026-01-02T03:04:05.000Z"),
        end: "2026-02-03T04:05:06Z",
        region: "Texas",
        levels: ["World"],
        myEvents: true,
        eventTypes: ["tournament"],
      }),
    ).resolves.toEqual([validEvent()]);

    const params = requests[0]?.url.searchParams;
    expect(params?.get("page")).toBe("1");
    expect(params?.get("per_page")).toBe("250");
    expect(params?.getAll("id[]")).toEqual(["1", "2"]);
    expect(params?.getAll("sku[]")).toEqual(["RE-1"]);
    expect(params?.getAll("team[]")).toEqual(["3"]);
    expect(params?.getAll("season[]")).toEqual(["4"]);
    expect(params?.get("start")).toBe("2026-01-02T03:04:05.000Z");
    expect(params?.get("end")).toBe("2026-02-03T04:05:06Z");
    expect(params?.get("region")).toBe("Texas");
    expect(params?.getAll("level[]")).toEqual(["World"]);
    expect(params?.get("myEvents")).toBe("true");
    expect(params?.getAll("eventTypes[]")).toEqual(["tournament"]);
  });

  test("leaves event type filtering to the API", async () => {
    const tournament = validEvent(1);
    const virtual = { ...validEvent(2), event_type: "virtual" } as const;
    const { client } = createMockClient({
      data: [tournament, virtual],
      meta: { current_page: 1, last_page: 1 },
    });

    await expect(
      client.events.search({ eventTypes: ["tournament"] }),
    ).resolves.toEqual([tournament, virtual]);
  });

  test("collects all pages in order and follows an advancing next_page_url", async () => {
    const { client, requests } = createDynamicClient(({ url }) => {
      const page = Number(url.searchParams.get("page"));
      const next = page === 1 ? 3 : page + 1;
      return Response.json({
        data: [validEvent(page)],
        meta: {
          current_page: page,
          last_page: 5,
          next_page_url:
            page < 5 ? `https://untrusted.example/events?page=${next}` : null,
        },
      });
    });

    await expect(client.events.search()).resolves.toEqual([
      validEvent(1),
      validEvent(3),
      validEvent(4),
      validEvent(5),
    ]);
    expect(requests.map(({ url }) => url.searchParams.get("page"))).toEqual([
      "1",
      "3",
      "4",
      "5",
    ]);
    expect(requests.every(({ url }) => url.host === "example.test")).toBe(true);
  });

  test("falls back to last_page when links are malformed, stale, or repeated", async () => {
    const { client, requests } = createDynamicClient(({ url }) => {
      const page = Number(url.searchParams.get("page"));
      const nextPageUrl =
        page === 1
          ? "not a valid URL?page=nope"
          : `https://example.test/events?page=${page}`;
      return Response.json({
        data: [validEvent(page)],
        meta: { current_page: 1, last_page: 3, next_page_url: nextPageUrl },
      });
    });

    await expect(client.events.search()).resolves.toEqual([
      validEvent(1),
      validEvent(2),
      validEvent(3),
    ]);
    expect(requests.map(({ url }) => url.searchParams.get("page"))).toEqual([
      "1",
      "2",
      "3",
    ]);
  });

  test("stops safely when pagination metadata cannot advance", async () => {
    const { client, requests } = createMockClient({
      data: [validEvent()],
      meta: { current_page: 1, next_page_url: "?page=1" },
    });

    await expect(client.events.search()).resolves.toEqual([validEvent()]);
    expect(requests).toHaveLength(1);
  });

  test("filters cancelled events after collecting every page", async () => {
    const { client } = createDynamicClient(({ url }) => {
      const page = Number(url.searchParams.get("page"));
      return Response.json({
        data: [
          { ...validEvent(page * 2), name: `Active ${page}` },
          { ...validEvent(page * 2 + 1), name: `Cancelled ${page}` },
        ],
        meta: { current_page: page, last_page: 2 },
      });
    });

    const events = await client.events.search({ includeCancelled: false });
    expect(events.map(({ name }) => name)).toEqual(["Active 1", "Active 2"]);
  });

  test("supports exact event SKU lookup and rejects blank SKUs", async () => {
    const requested = { ...validEvent(2), sku: "RE-EXACT" };
    const { client, requests } = createMockClient({
      data: [validEvent(1), requested],
      meta: { current_page: 1, last_page: 1 },
    });

    await expect(client.events.getBySku("RE-EXACT")).resolves.toEqual(
      requested,
    );
    expect(requests[0]?.url.searchParams.getAll("sku[]")).toEqual(["RE-EXACT"]);
    await expect(client.events.getBySku("RE-MISSING")).resolves.toBeNull();
    await expect(client.events.getBySku("   ")).rejects.toThrow(
      "sku must not be empty",
    );
  });

  test("supports exact team number and program lookup", async () => {
    const wrongProgram = { ...validTeam(1), number: "123A" };
    const requested = {
      ...validTeam(2),
      number: "123A",
      program: { id: 4, name: "VURC", code: "VURC" },
    };
    const { client, requests } = createMockClient({
      data: [wrongProgram, requested],
      meta: { current_page: 1, last_page: 1 },
    });

    await expect(client.teams.getByNumber("123A", 4)).resolves.toEqual(
      requested,
    );
    expect(requests[0]?.url.searchParams.getAll("number[]")).toEqual(["123A"]);
    expect(requests[0]?.url.searchParams.getAll("program[]")).toEqual(["4"]);
    await expect(client.teams.getByNumber("999Z", 4)).resolves.toBeNull();
    await expect(client.teams.getByNumber(" ", 1)).rejects.toThrow(
      "team number must not be empty",
    );
  });

  test("exposes constants through the client", () => {
    const { client } = createMockClient();
    expect(client.rounds.qualification).toBe(2);
    expect(client.programs.V5RC).toBe(1);
    expect(client.programs.VAIRC).toBe(57);
  });

  test("covers every event collection endpoint with array results", async () => {
    const { client, requests } = createDynamicClient(({ url }) =>
      endpointResponse(url),
    );

    await expect(
      client.events.teams(10, { numbers: ["123A"] }),
    ).resolves.toHaveLength(1);
    await expect(
      client.events.skills(10, { teams: [20] }),
    ).resolves.toHaveLength(1);
    await expect(
      client.events.awards(10, { winners: ["Ada"] }),
    ).resolves.toHaveLength(1);
    await expect(
      client.events.matches(10, 30, { rounds: [2], matchNumbers: [4] }),
    ).resolves.toHaveLength(1);
    await expect(client.events.finalistRankings(10, 30)).resolves.toHaveLength(
      1,
    );
    await expect(client.events.rankings(10, 30)).resolves.toHaveLength(1);

    expect(requests.map(({ url }) => url.pathname)).toEqual([
      "/api/v2/events/10/teams",
      "/api/v2/events/10/skills",
      "/api/v2/events/10/awards",
      "/api/v2/events/10/divisions/30/matches",
      "/api/v2/events/10/divisions/30/finalistRankings",
      "/api/v2/events/10/divisions/30/rankings",
    ]);
    expect(
      requests.every(({ url }) => url.searchParams.get("per_page") === "250"),
    ).toBe(true);
  });

  test("covers every team collection endpoint with array results", async () => {
    const { client, requests } = createDynamicClient(({ url }) =>
      endpointResponse(url),
    );

    await expect(client.teams.search({ programs: [1] })).resolves.toHaveLength(
      1,
    );
    await expect(
      client.teams.events(1, { seasons: [2] }),
    ).resolves.toHaveLength(1);
    await expect(
      client.teams.matches(1, { rounds: [2] }),
    ).resolves.toHaveLength(1);
    await expect(
      client.teams.rankings(1, { ranks: [1] }),
    ).resolves.toHaveLength(1);
    await expect(
      client.teams.skills(1, { types: ["driver"] }),
    ).resolves.toHaveLength(1);
    await expect(
      client.teams.awards(1, { seasons: [2] }),
    ).resolves.toHaveLength(1);

    expect(requests.map(({ url }) => url.pathname)).toEqual([
      "/api/v2/teams",
      "/api/v2/teams/1/events",
      "/api/v2/teams/1/matches",
      "/api/v2/teams/1/rankings",
      "/api/v2/teams/1/skills",
      "/api/v2/teams/1/awards",
    ]);
  });

  test("covers program and season all-page endpoints", async () => {
    const { client, requests } = createDynamicClient(({ url }) =>
      endpointResponse(url),
    );

    await expect(client.programs.all({ ids: [1] })).resolves.toHaveLength(1);
    await expect(client.seasons.all({ programs: [1] })).resolves.toHaveLength(
      1,
    );
    await expect(
      client.seasons.events(2, { teams: [3] }),
    ).resolves.toHaveLength(1);

    expect(requests.map(({ url }) => url.pathname)).toEqual([
      "/api/v2/programs",
      "/api/v2/seasons",
      "/api/v2/seasons/2/events",
    ]);
  });

  test("keeps single-resource get methods unchanged", async () => {
    const { client } = createDynamicClient(({ url }) => endpointResponse(url));

    await expect(client.events.get(10)).resolves.toEqual(validEvent(10));
    await expect(client.teams.get(20)).resolves.toEqual(validTeam(20));
    await expect(client.programs.get(1)).resolves.toMatchObject({ id: 1 });
    await expect(client.seasons.get(2)).resolves.toMatchObject({ id: 2 });
  });

  test("reuses authentication, custom headers, and abort signals on every page", async () => {
    const controller = new AbortController();
    const { client, requests } = createDynamicClient(({ url }) => {
      const page = Number(url.searchParams.get("page"));
      return Response.json({
        data: [],
        meta: { current_page: page, last_page: 2 },
      });
    });

    await client.programs.all({}, { signal: controller.signal });

    expect(requests).toHaveLength(2);
    for (const request of requests) {
      const headers = new Headers(request.init?.headers);
      expect(headers.get("accept")).toBe("application/json");
      expect(headers.get("authorization")).toBe("Bearer test-token");
      expect(headers.get("x-client")).toBe("test");
      expect(request.init?.signal).toBe(controller.signal);
    }
  });

  test("rejects the entire result when a later page returns an API error", async () => {
    const { client } = createDynamicClient(({ url }) => {
      const page = Number(url.searchParams.get("page"));
      if (page === 1) {
        return Response.json({
          data: [validEvent()],
          meta: { current_page: 1, last_page: 2 },
        });
      }
      return Response.json(
        { message: "Page unavailable" },
        { status: 503, statusText: "Service Unavailable" },
      );
    });

    const error = await client.events
      .search()
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(VexEventsApiError);
    expect(error).toMatchObject({ status: 503, message: "Page unavailable" });
  });

  test("rejects the entire result when a later page is malformed", async () => {
    const { client } = createDynamicClient(({ url }) => {
      const page = Number(url.searchParams.get("page"));
      return page === 1
        ? Response.json({
            data: [validEvent()],
            meta: { current_page: 1, last_page: 2 },
          })
        : Response.json({
            data: [{}],
            meta: { current_page: 2, last_page: 2 },
          });
    });

    const error = await client.events
      .search()
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(VexEventsResponseError);
    expect(error).toHaveProperty(
      "message",
      "VEX Events API returned an invalid response for /events",
    );
  });

  test("retries a rate-limited later page independently", async () => {
    let pageTwoAttempts = 0;
    const requests: URL[] = [];
    const mockFetch: Fetch = async (input) => {
      const url = toUrl(input);
      requests.push(url);
      const page = Number(url.searchParams.get("page"));
      if (page === 2 && pageTwoAttempts++ === 0) {
        return Response.json(
          { message: "Too Many Requests" },
          { status: 429, headers: { "retry-after": "0" } },
        );
      }
      return Response.json({
        data: [validEvent(page)],
        meta: { current_page: page, last_page: 2 },
      });
    };
    const client = new Robot({
      token: "token",
      fetch: mockFetch,
      retry: { maxAttempts: 2 },
    });

    await expect(client.events.search()).resolves.toEqual([
      validEvent(1),
      validEvent(2),
    ]);
    expect(requests.map((url) => url.searchParams.get("page"))).toEqual([
      "1",
      "2",
      "2",
    ]);
  });

  test("honors abort signals while waiting to retry a page", async () => {
    const controller = new AbortController();
    let attempts = 0;
    const mockFetch: Fetch = async () => {
      attempts++;
      return Response.json(
        { message: "Too Many Requests" },
        { status: 429, headers: { "retry-after": "5" } },
      );
    };
    const client = new Robot({
      token: "token",
      fetch: mockFetch,
      retry: { maxAttempts: 3 },
    });

    const pending = client.events
      .search({}, { signal: controller.signal })
      .catch((reason: unknown) => reason);
    queueMicrotask(() => controller.abort());
    const error = await pending;

    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe("AbortError");
    expect(attempts).toBe(1);
  });

  test("throws a typed API error with the complete requested URL", async () => {
    const { client } = createMockClient(
      { code: 404, message: "No events" },
      { status: 404, statusText: "Not Found" },
    );

    const error = await client.events
      .search()
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(VexEventsApiError);
    expect(error).toMatchObject({
      status: 404,
      body: { code: 404, message: "No events" },
      url: "https://example.test/api/v2/events?page=1&per_page=250",
    });
  });

  test("rejects successful non-JSON responses", async () => {
    const mockFetch: Fetch = async () =>
      new Response("login page", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    const client = new Robot({ token: "token", fetch: mockFetch });

    await expect(client.programs.all()).rejects.toBeInstanceOf(
      VexEventsResponseError,
    );
  });

  test("accepts nullable event fields and date-keyed locations", async () => {
    const event = {
      ...validEvent(59997),
      location: {
        address_2: null,
        region: null,
        postcode: null,
      },
      locations: {
        "2025-09-12": { region: "New Jersey", postcode: "07103" },
      },
      event_type: null,
    } satisfies Event;
    const { client } = createMockClient({
      data: [event],
      meta: { current_page: 1, last_page: 1 },
    });

    await expect(client.events.search()).resolves.toEqual([event]);
  });
});

type Assert<T extends true> = T;
type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

type EventsResourceType = InstanceType<typeof Robot>["events"];
type TeamsResourceType = InstanceType<typeof Robot>["teams"];

type NoList = Assert<"list" extends keyof EventsResourceType ? false : true>;
type NoListPages = Assert<
  "listPages" extends keyof EventsResourceType ? false : true
>;
type NoMatchesPages = Assert<
  "matchesPages" extends keyof EventsResourceType ? false : true
>;
type NoPageOption = Assert<
  "page" extends keyof ListEventsOptions ? false : true
>;
type NoPerPageOption = Assert<
  "perPage" extends keyof ListEventsOptions ? false : true
>;
type EventSearchReturnsArray = Assert<
  IsEqual<ReturnType<EventsResourceType["search"]>, Promise<Event[]>>
>;
type TeamSearchReturnsArray = Assert<
  IsEqual<ReturnType<TeamsResourceType["search"]>, Promise<Team[]>>
>;

export type ClientTypeAssertions = [
  NoList,
  NoListPages,
  NoMatchesPages,
  NoPageOption,
  NoPerPageOption,
  EventSearchReturnsArray,
  TeamSearchReturnsArray,
];
