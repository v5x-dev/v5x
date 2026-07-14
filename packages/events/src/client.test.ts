import { describe, expect, test } from "bun:test";
import {
  VexEventsApiError,
  VexEventsClient,
  VexEventsResponseError,
  type Fetch,
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
  const client = new VexEventsClient({
    token: "test-token",
    baseUrl: "https://example.test/api/v2/",
    fetch: mockFetch,
    headers: { "X-Client": "test" },
  });

  return { client, requests };
}

describe("VexEventsClient", () => {
  test("requires a non-empty token", () => {
    expect(() => new VexEventsClient({ token: "  " })).toThrow(
      "token must not be empty",
    );
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

  test("covers every event endpoint", async () => {
    const { client, requests } = createMockClient();

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
    const { client, requests } = createMockClient();

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
    const client = new VexEventsClient({ token: "token", fetch: mockFetch });

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
    const client = new VexEventsClient({ token: "token", fetch: mockFetch });

    await expect(client.programs.get(1)).resolves.toEqual({
      id: 1,
      name: "V5RC",
    });
  });

  test("rejects malformed paginated success responses with endpoint context", async () => {
    const { client } = createMockClient({ data: {}, meta: [] });

    const error = await client.events.list().catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(VexEventsResponseError);
    expect(error).toMatchObject({
      message: "VEX Events API returned an invalid response for /events",
      url: "https://example.test/api/v2/events",
    });
  });

  test("rejects malformed single-resource success responses", async () => {
    const { client } = createMockClient([]);

    const error = await client.teams.get(1).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(VexEventsResponseError);
    expect(error).toHaveProperty(
      "message",
      "VEX Events API returned an invalid response for /teams/1",
    );
  });
});
