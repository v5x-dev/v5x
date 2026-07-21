# @v5x/events

Strictly typed TypeScript client for the [VEX Events API v2](https://events.vex.com/api/v2).

## Install

```sh
bun add @v5x/events
```

## Usage

Create a personal access token in your VEX Events account, then pass it to the
client. The package works in browsers, Bun, and modern Node.js runtimes with
`fetch`.

```ts
import { Robot } from "@v5x/events";

const robot = new Robot({
  token: process.env.VEX_EVENTS_TOKEN!,
});

const teams = await robot.teams.list({
  numbers: ["123A"],
  registered: true,
  perPage: 100,
});

for (const team of teams.data ?? []) {
  console.log(team.number, team.team_name);
}
```

Resources mirror the API:

- `robot.events`: events, event teams, skills, awards, division matches, and rankings
- `robot.teams`: teams and their events, matches, rankings, skills, and awards
- `robot.programs`: programs
- `robot.seasons`: seasons and season events

All filters, response models, pagination metadata, and API error bodies are
exported as TypeScript types. Array filters use normal arrays; the client
encodes them using the API's repeated `field[]` query parameters. `Date` values
are converted to RFC 3339 strings automatically.

Event listings include every upstream event by default, including names that
contain `cancelled` or `canceled`. Pass `includeCancelled: false` to
`robot.events.list()`, `robot.events.listPages()`, `robot.teams.events()`, or
`robot.seasons.events()` to apply the legacy name-based filter. That filter is
applied to each page's `data`; pagination metadata continues to describe the
unfiltered upstream response.

## Pagination

The top-level event, team, program, and season collections expose lazy
`listPages()` async iterators. Each iteration yields a complete page, including
its `data` and `meta` fields:

```ts
for await (const page of robot.events.listPages({
  seasons: [196],
  perPage: 250,
})) {
  for (const event of page.data ?? []) {
    console.log(event.name);
  }
}
```

Pages are requested sequentially. The `page` option selects the starting page,
and breaking out of the loop prevents any later page requests. When request
options contain an `AbortSignal`, that same signal is used for every page:

```ts
const controller = new AbortController();

for await (const page of robot.teams.listPages(
  { registered: true },
  { signal: controller.signal },
)) {
  // Each value is a complete PaginatedResponse<Team>.
}
```

Only top-level `list()` endpoints have a corresponding `listPages()` method;
nested paginated endpoints continue to return a single requested page.

```ts
import { VexEventsApiError } from "@v5x/events";

try {
  const event = await robot.events.get(123);
  console.log(event.name);
} catch (error) {
  if (error instanceof VexEventsApiError) {
    console.error(error.status, error.body);
  }
}
```

## Rate limiting

Rate-limited (429) and unavailable (503) responses expose the API's
`Retry-After` hint as `retryAfterMs` on the thrown `VexEventsApiError`. Pass
the opt-in `retry` option to retry rate-limited requests automatically after
the advertised delay; abort signals are honored while waiting.

```ts
const robot = new Robot({
  token: process.env.VEX_EVENTS_TOKEN!,
  retry: { maxAttempts: 3, maxDelayMs: 30_000 },
});
```

## Build

```sh
bun run build
```
