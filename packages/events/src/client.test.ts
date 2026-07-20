import { describe, expect, test } from "bun:test";
import {
  VexEventsApiError,
  Robot,
  VexEventsResponseError,
  type Event,
  type Fetch,
  type PaginatedResponse,
} from "./index.js";

interface CapturedRequest {
  url: URL;
  init: RequestInit | undefined;
}

function createMockClient(
  body: unknown = { data: [], meta: {} },
  responseInit: ResponseInit = {},
) {
  const requests: CapturedRequest[] = [];
  const mockFetch: Fetch = async (input, init) => {
    const inputUrl =
      input instanceof URL
        ? input.href
        : input instanceof Request
          ? input.url
          : input;
    requests.push({ url: new URL(inputUrl), init });
    return Response.json(body, responseInit);
  };
  const client = new Robot({
    token: "test-token",
    baseUrl: "https://example.test/api/v2/",
    fetch: mockFetch,
    headers: { "X-Client": "test" },
  });

  return { client, requests };
}

function createDynamicClient(
  respond: (
    request: CapturedRequest,
    requestNumber: number,
  ) => Response | Promise<Response>,
) {
  const requests: CapturedRequest[] = [];
  const mockFetch: Fetch = async (input, init) => {
    const inputUrl =
      input instanceof URL
        ? input.href
        : input instanceof Request
          ? input.url
          : input;
    const request = { url: new URL(inputUrl), init };
    requests.push(request);
    return respond(request, requests.length);
  };
  const client = new Robot({
    token: "test-token",
    baseUrl: "https://example.test/api/v2/",
    fetch: mockFetch,
  });

  return { client, requests };
}

const idInfo = { id: 1, name: "V5RC" };

function validEvent(id: number = 1) {
  return {
    id,
    sku: `RE-V5RC-${id}`,
    name: `Event ${id}`,
    season: idInfo,
    program: idInfo,
    location: {},
  };
}

function validTeam(id: number = 1) {
  return { id, number: `${id}A`, program: idInfo };
}

function endpointResponse(url: URL): Response {
  if (/\/events\/\d+$/.test(url.pathname)) {
    return Response.json(validEvent());
  }
  if (/\/teams\/\d+$/.test(url.pathname)) {
    return Response.json(validTeam());
  }
  if (/\/programs\/\d+$/.test(url.pathname)) {
    return Response.json({ id: 1, name: "V5RC" });
  }
  if (/\/seasons\/\d+$/.test(url.pathname)) {
    return Response.json({ id: 1, name: "2026" });
  }
  return Response.json({ data: [], meta: {} });
}

describe("Robot", () => {
  test("requires a non-empty token", () => {
    expect(() => new Robot({ token: "  " })).toThrow("token must not be empty");
  });

  test("serializes event filters using the API's repeated array format", async () => {
    const { client, requests } = createMockClient();

    await client.events.list({
      ids: [1, 2],
      skus: ["RE-V5RC-1"],
      teams: [3],
      seasons: [4],
      start: new Date("2026-01-02T03:04:05.000Z"),
      end: "2026-02-03T04:05:06Z",
      region: "Texas",
      levels: ["State", "Signature"],
      myEvents: false,
      eventTypes: ["tournament", "league"],
      page: 2,
      perPage: 250,
    });

    const request = requests[0];
    expect(request).toBeDefined();
    expect(request?.url.pathname).toBe("/api/v2/events");
    expect(request?.url.searchParams.getAll("id[]")).toEqual(["1", "2"]);
    expect(request?.url.searchParams.getAll("sku[]")).toEqual(["RE-V5RC-1"]);
    expect(request?.url.searchParams.getAll("team[]")).toEqual(["3"]);
    expect(request?.url.searchParams.getAll("season[]")).toEqual(["4"]);
    expect(request?.url.searchParams.get("start")).toBe(
      "2026-01-02T03:04:05.000Z",
    );
    expect(request?.url.searchParams.get("end")).toBe("2026-02-03T04:05:06Z");
    expect(request?.url.searchParams.get("region")).toBe("Texas");
    expect(request?.url.searchParams.getAll("level[]")).toEqual([
      "State",
      "Signature",
    ]);
    expect(request?.url.searchParams.get("myEvents")).toBe("false");
    expect(request?.url.searchParams.getAll("eventTypes[]")).toEqual([
      "tournament",
      "league",
    ]);
    expect(request?.url.searchParams.get("page")).toBe("2");
    expect(request?.url.searchParams.get("per_page")).toBe("250");
  });

  test("filters cancelled events from every event listing", async () => {
    const { client } = createDynamicClient(() =>
      Response.json({
        data: [
          { ...validEvent(1), name: "Active Event" },
          { ...validEvent(2), name: "Cancelled Event" },
          { ...validEvent(3), name: "CANCELED: Venue unavailable" },
          { ...validEvent(4), name: "Event cancellation policy" },
        ],
        meta: { current_page: 1, last_page: 1, total: 4 },
      }),
    );

    const globalEvents = await client.events.list();
    const iteratedPage = await client.events.listPages().next();
    const teamEvents = await client.teams.events(1);
    const seasonEvents = await client.seasons.events(1);

    const responses: PaginatedResponse<Event>[] = [
      globalEvents,
      iteratedPage.value ?? {},
      teamEvents,
      seasonEvents,
    ];
    for (const response of responses) {
      expect(response?.data?.map(({ name }) => name)).toEqual([
        "Active Event",
        "Event cancellation policy",
      ]);
      expect(response?.meta?.total).toBe(4);
    }
  });

  test("lazily iterates complete event pages from an explicit starting page", async () => {
    const controller = new AbortController();
    const { client, requests } = createDynamicClient(({ url }) => {
      const page = Number(url.searchParams.get("page"));
      return Response.json({
        data: [validEvent(page)],
        meta: { current_page: page, last_page: 4 },
      });
    });
    const options = { seasons: [196], page: 2, perPage: 250 } as const;
    const iterator = client.events.listPages(options, {
      signal: controller.signal,
    });
    const pages: unknown[] = [];

    expect(requests).toHaveLength(0);
    for await (const page of iterator) pages.push(page);

    expect(pages).toEqual([
      {
        data: [validEvent(2)],
        meta: { current_page: 2, last_page: 4 },
      },
      {
        data: [validEvent(3)],
        meta: { current_page: 3, last_page: 4 },
      },
      {
        data: [validEvent(4)],
        meta: { current_page: 4, last_page: 4 },
      },
    ]);
    expect(requests.map(({ url }) => url.searchParams.get("page"))).toEqual([
      "2",
      "3",
      "4",
    ]);
    for (const { url, init } of requests) {
      expect(url.searchParams.getAll("season[]")).toEqual(["196"]);
      expect(url.searchParams.get("per_page")).toBe("250");
      expect(init?.signal).toBe(controller.signal);
    }
    expect(options.page).toBe(2);
  });

  test("does not prefetch after a consumer breaks iteration", async () => {
    const { client, requests } = createDynamicClient(({ url }) => {
      const page = Number(url.searchParams.get("page"));
      return Response.json({
        data: [],
        meta: { current_page: page, last_page: 10 },
      });
    });
    const iterator = client.events.listPages();

    expect(requests).toHaveLength(0);
    for await (const _page of iterator) break;

    expect(requests).toHaveLength(1);
  });

  test("uses next_page_url when last_page is absent and stops without usable metadata", async () => {
    const { client, requests } = createDynamicClient(
      (_request, requestNumber) =>
        Response.json({
          data: [{ ...validEvent(requestNumber), requestNumber }],
          meta:
            requestNumber === 1
              ? { next_page_url: "https://example.test/api/v2/events?page=2" }
              : { last_page: 0, next_page_url: "" },
        }),
    );
    let yieldedPages = 0;

    for await (const _page of client.events.listPages()) yieldedPages++;

    expect(yieldedPages).toBe(2);
    expect(requests.map(({ url }) => url.searchParams.get("page"))).toEqual([
      "1",
      "2",
    ]);
  });

  test("advances monotonically when current_page metadata is stale", async () => {
    const { client, requests } = createDynamicClient(() =>
      Response.json({
        data: [],
        meta: { current_page: 1, last_page: 4 },
      }),
    );

    for await (const _page of client.events.listPages({ page: 3 })) {
      // Consume every page to exercise the iterator's termination logic.
    }

    expect(requests.map(({ url }) => url.searchParams.get("page"))).toEqual([
      "3",
      "4",
    ]);
  });

  test("propagates an API error from a later page", async () => {
    const { client, requests } = createDynamicClient(
      (_request, requestNumber) => {
        if (requestNumber === 1) {
          return Response.json({
            data: [],
            meta: { current_page: 1, last_page: 2 },
          });
        }
        return Response.json(
          { message: "Page unavailable" },
          { status: 503, statusText: "Service Unavailable" },
        );
      },
    );
    const iterator = client.events.listPages();

    await expect(iterator.next()).resolves.toMatchObject({ done: false });
    const error = await iterator.next().catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(VexEventsApiError);
    expect(error).toMatchObject({
      status: 503,
      message: "Page unavailable",
    });
    expect(requests).toHaveLength(2);
  });

  test("exposes listPages on every top-level collection resource", async () => {
    const { client, requests } = createDynamicClient(({ url }) =>
      Response.json({
        data: [],
        meta: {
          current_page: Number(url.searchParams.get("page")),
          last_page: 1,
        },
      }),
    );

    await client.events.listPages({ ids: [1] }).next();
    await client.teams.listPages({ ids: [2] }).next();
    await client.programs.listPages({ ids: [3] }).next();
    await client.seasons.listPages({ ids: [4] }).next();

    expect(requests.map(({ url }) => url.pathname)).toEqual([
      "/api/v2/events",
      "/api/v2/teams",
      "/api/v2/programs",
      "/api/v2/seasons",
    ]);
    expect(
      requests.map(({ url }) => [
        url.searchParams.get("page"),
        url.searchParams.getAll("id[]"),
      ]),
    ).toEqual([
      ["1", ["1"]],
      ["1", ["2"]],
      ["1", ["3"]],
      ["1", ["4"]],
    ]);
  });

  test("covers every event endpoint", async () => {
    const { client, requests } = createDynamicClient(({ url }) =>
      endpointResponse(url),
    );

    await client.events.get(10);
    await client.events.teams(10, { numbers: ["123A"], registered: true });
    await client.events.skills(10, { teams: [20], types: ["driver"] });
    await client.events.awards(10, { teams: [20], winners: ["Ada"] });
    await client.events.matches(10, 30, {
      teams: [20],
      rounds: [2],
      instances: [1],
      matchNumbers: [4],
    });
    await client.events.finalistRankings(10, 30, {
      teams: [20],
      ranks: [1],
    });
    await client.events.rankings(10, 30, { teams: [20], ranks: [2] });

    expect(requests.map(({ url }) => `${url.pathname}${url.search}`)).toEqual([
      "/api/v2/events/10",
      "/api/v2/events/10/teams?number%5B%5D=123A&registered=true",
      "/api/v2/events/10/skills?team%5B%5D=20&type%5B%5D=driver",
      "/api/v2/events/10/awards?team%5B%5D=20&winner%5B%5D=Ada",
      "/api/v2/events/10/divisions/30/matches?team%5B%5D=20&round%5B%5D=2&instance%5B%5D=1&matchnum%5B%5D=4",
      "/api/v2/events/10/divisions/30/finalistRankings?team%5B%5D=20&rank%5B%5D=1",
      "/api/v2/events/10/divisions/30/rankings?team%5B%5D=20&rank%5B%5D=2",
    ]);
  });

  test("covers every team endpoint", async () => {
    const { client, requests } = createDynamicClient(({ url }) =>
      endpointResponse(url),
    );

    await client.teams.list({
      ids: [1],
      numbers: ["123A"],
      events: [2],
      registered: false,
      programs: [3],
      grades: ["High School"],
      countries: ["United States"],
      myTeams: true,
    });
    await client.teams.get(1);
    await client.teams.events(1, { skus: ["RE-1"], seasons: [2] });
    await client.teams.matches(1, {
      events: [2],
      seasons: [3],
      rounds: [4],
      instances: [5],
      matchNumbers: [6],
    });
    await client.teams.rankings(1, {
      events: [2],
      ranks: [3],
      seasons: [4],
    });
    await client.teams.skills(1, {
      events: [2],
      types: ["programming"],
      seasons: [3],
    });
    await client.teams.awards(1, { events: [2], seasons: [3] });

    expect(requests.map(({ url }) => url.pathname)).toEqual([
      "/api/v2/teams",
      "/api/v2/teams/1",
      "/api/v2/teams/1/events",
      "/api/v2/teams/1/matches",
      "/api/v2/teams/1/rankings",
      "/api/v2/teams/1/skills",
      "/api/v2/teams/1/awards",
    ]);
    expect(requests[0]?.url.searchParams.get("registered")).toBe("false");
    expect(requests[3]?.url.searchParams.getAll("matchnum[]")).toEqual(["6"]);
  });

  test("covers program and season endpoints", async () => {
    const { client, requests } = createMockClient();

    await client.programs.list({ ids: [1] });
    await client.programs.get(1);
    await client.seasons.list({
      ids: [2],
      programs: [3],
      teams: [4],
      active: true,
    });
    await client.seasons.get(2);
    await client.seasons.events(2, {
      skus: ["RE-2"],
      teams: [4],
      levels: ["World"],
    });

    expect(requests.map(({ url }) => url.pathname)).toEqual([
      "/api/v2/programs",
      "/api/v2/programs/1",
      "/api/v2/seasons",
      "/api/v2/seasons/2",
      "/api/v2/seasons/2/events",
    ]);
    expect(requests[2]?.url.searchParams.get("active")).toBe("true");
  });

  test("sends authentication, custom headers, and abort signals", async () => {
    const { client, requests } = createMockClient();
    const controller = new AbortController();

    await client.programs.get(1, { signal: controller.signal });

    const request = requests[0];
    const headers = new Headers(request?.init?.headers);
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("authorization")).toBe("Bearer test-token");
    expect(headers.get("x-client")).toBe("test");
    expect(request?.init?.signal).toBe(controller.signal);
  });

  test("throws a typed API error with a parsed error body", async () => {
    const { client } = createMockClient(
      { code: 404, message: "Team not found" },
      { status: 404, statusText: "Not Found" },
    );

    const error = await client.teams
      .get(999)
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(VexEventsApiError);
    expect(error).toMatchObject({
      status: 404,
      statusText: "Not Found",
      body: { code: 404, message: "Team not found" },
      message: "Team not found",
      url: "https://example.test/api/v2/teams/999",
    });
  });

  test("rejects successful non-JSON responses", async () => {
    const mockFetch: Fetch = async () =>
      new Response("login page", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    const client = new Robot({ token: "token", fetch: mockFetch });

    const error = await client.programs
      .list()
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(VexEventsResponseError);
    expect(error).toHaveProperty(
      "message",
      "VEX Events API returned a non-JSON response",
    );
  });

  test("accepts structured JSON content types", async () => {
    const mockFetch: Fetch = async () =>
      new Response(JSON.stringify({ id: 1, name: "V5RC" }), {
        headers: { "content-type": "application/problem+json; charset=utf-8" },
      });
    const client = new Robot({ token: "token", fetch: mockFetch });

    await expect(client.programs.get(1)).resolves.toEqual({
      id: 1,
      name: "V5RC",
    });
  });

  test.each([{ meta: {} }, { data: [] }, { data: {}, meta: [] }])(
    "rejects malformed paginated success response %p with endpoint context",
    async (body) => {
      const { client } = createMockClient(body);

      const error = await client.events
        .list()
        .catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(VexEventsResponseError);
      expect(error).toMatchObject({
        message: "VEX Events API returned an invalid response for /events",
        url: "https://example.test/api/v2/events",
      });
    },
  );

  test("rejects an empty single-resource success response", async () => {
    const { client } = createMockClient({});

    const error = await client.teams.get(1).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(VexEventsResponseError);
    expect(error).toHaveProperty(
      "message",
      "VEX Events API returned an invalid response for /teams/1",
    );
  });

  test("rejects malformed nested resources in paginated responses", async () => {
    const malformedEvent = { ...validEvent(), season: { id: 1 } };
    const { client } = createMockClient({ data: [malformedEvent], meta: {} });

    const error = await client.events.list().catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(VexEventsResponseError);
    expect(error).toMatchObject({
      message: "VEX Events API returned an invalid response for /events",
      url: "https://example.test/api/v2/events",
    });
  });

  test("accepts valid entries from every supported resource family", async () => {
    const resources = [
      validEvent(),
      validTeam(),
      { id: 1, name: "V5RC", abbr: "V5RC" },
      { id: 1, name: "2026", program: idInfo },
      {
        id: 1,
        event: idInfo,
        division: idInfo,
        round: 2,
        instance: 1,
        matchnum: 3,
        scored: true,
        name: "Qualification 3",
        alliances: [{ color: "red", score: 10, teams: [] }],
      },
      { id: 1, event: idInfo, division: idInfo, team: idInfo, rank: 1 },
      { id: 1, event: idInfo, team: idInfo, type: "driver", score: 42 },
      { id: 1, event: idInfo, title: "Excellence Award" },
    ];
    const { client } = createDynamicClient((_request, requestNumber) =>
      Response.json({ data: [resources[requestNumber - 1]], meta: {} }),
    );

    await expect(client.events.list()).resolves.toBeDefined();
    await expect(client.teams.list()).resolves.toBeDefined();
    await expect(client.programs.list()).resolves.toBeDefined();
    await expect(client.seasons.list()).resolves.toBeDefined();
    await expect(client.events.matches(1, 1)).resolves.toBeDefined();
    await expect(client.events.rankings(1, 1)).resolves.toBeDefined();
    await expect(client.events.skills(1)).resolves.toBeDefined();
    await expect(client.events.awards(1)).resolves.toBeDefined();
  });

  test("exposes Retry-After seconds on rate-limited responses", async () => {
    const { client } = createMockClient(
      { message: "Too Many Requests" },
      {
        status: 429,
        statusText: "Too Many Requests",
        headers: { "retry-after": "12" },
      },
    );

    const error = await client.teams.get(1).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(VexEventsApiError);
    expect(error).toMatchObject({ status: 429, retryAfterMs: 12_000 });
  });

  test("exposes HTTP-date Retry-After values on 503 responses", async () => {
    const retryAt = new Date(Date.now() + 30_000).toUTCString();
    const { client } = createMockClient(
      { message: "Service Unavailable" },
      {
        status: 503,
        statusText: "Service Unavailable",
        headers: { "retry-after": retryAt },
      },
    );

    const error = await client.teams.get(1).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(VexEventsApiError);
    const { retryAfterMs } = error as VexEventsApiError;
    expect(retryAfterMs).toBeGreaterThan(0);
    expect(retryAfterMs).toBeLessThanOrEqual(30_000);
  });

  test("omits retryAfterMs when the header is missing or unparseable", async () => {
    const { client } = createMockClient(
      { message: "Too Many Requests" },
      {
        status: 429,
        statusText: "Too Many Requests",
        headers: { "retry-after": "soon" },
      },
    );

    const error = await client.teams.get(1).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(VexEventsApiError);
    expect((error as VexEventsApiError).retryAfterMs).toBeUndefined();
  });

  test("retries rate-limited requests after the advertised delay when opted in", async () => {
    let attempts = 0;
    const mockFetch: Fetch = async () => {
      attempts++;
      if (attempts < 3) {
        return Response.json(
          { message: "Too Many Requests" },
          { status: 429, headers: { "retry-after": "0" } },
        );
      }
      return Response.json({ id: 1, name: "V5RC" });
    };
    const client = new Robot({
      token: "token",
      fetch: mockFetch,
      retry: { maxAttempts: 3 },
    });

    await expect(client.programs.get(1)).resolves.toEqual({
      id: 1,
      name: "V5RC",
    });
    expect(attempts).toBe(3);
  });

  test("stops retrying once maxAttempts is exhausted", async () => {
    let attempts = 0;
    const mockFetch: Fetch = async () => {
      attempts++;
      return Response.json(
        { message: "Too Many Requests" },
        { status: 429, headers: { "retry-after": "0" } },
      );
    };
    const client = new Robot({
      token: "token",
      fetch: mockFetch,
      retry: { maxAttempts: 2 },
    });

    const error = await client.programs
      .get(1)
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(VexEventsApiError);
    expect((error as VexEventsApiError).status).toBe(429);
    expect(attempts).toBe(2);
  });

  test("does not retry when the advertised delay exceeds maxDelayMs", async () => {
    let attempts = 0;
    const mockFetch: Fetch = async () => {
      attempts++;
      return Response.json(
        { message: "Too Many Requests" },
        { status: 429, headers: { "retry-after": "60" } },
      );
    };
    const client = new Robot({
      token: "token",
      fetch: mockFetch,
      retry: { maxAttempts: 3, maxDelayMs: 1_000 },
    });

    const error = await client.programs
      .get(1)
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(VexEventsApiError);
    expect((error as VexEventsApiError).retryAfterMs).toBe(60_000);
    expect(attempts).toBe(1);
  });

  test("does not retry non-rate-limit errors even when opted in", async () => {
    let attempts = 0;
    const mockFetch: Fetch = async () => {
      attempts++;
      return Response.json({ message: "Server Error" }, { status: 500 });
    };
    const client = new Robot({
      token: "token",
      fetch: mockFetch,
      retry: { maxAttempts: 3 },
    });

    const error = await client.programs
      .get(1)
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(VexEventsApiError);
    expect((error as VexEventsApiError).status).toBe(500);
    expect(attempts).toBe(1);
  });

  test("honors abort signals while waiting to retry", async () => {
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

    const pending = client.programs
      .get(1, { signal: controller.signal })
      .catch((reason: unknown) => reason);
    queueMicrotask(() => controller.abort());
    const error = await pending;

    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe("AbortError");
    expect(attempts).toBe(1);
  });
});
