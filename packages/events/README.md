# @v5x/events

Strictly typed TypeScript client for the [VEX Events API v2](https://events.vex.com/api/v2).

## Install

```sh
bun add @v5x/events
```

## Usage

Create a personal access token in your VEX Events account, then initialize the
client. The package works in browsers, Bun, and modern Node.js runtimes with
`fetch`.

```ts
import { Robot } from "@v5x/events";

const robot = new Robot({
  token: process.env.VEX_EVENTS_TOKEN!,
});

const events = await robot.events.search({
  seasons: [seasonId],
  eventTypes: ["tournament"],
});

for (const event of events) {
  console.log(event.name);
}
```

Resources mirror the complete API:

- `robot.events`: search events and get event teams, skills, awards, matches,
  and rankings
- `robot.teams`: search teams and get their events, matches, rankings, skills,
  and awards
- `robot.programs`: program constants plus `all()` and `get()`
- `robot.seasons`: `all()`, `get()`, and season events

Every collection method automatically retrieves all matching API pages and
returns a plain array. The client starts at page 1, requests 250 items per
page, and follows the API's pagination metadata until the collection is
complete.

```ts
const team = await robot.teams.getByNumber("123A", robot.programs.V5RC);

const matches = await robot.events.matches(eventId, divisionId, {
  rounds: [robot.rounds.qualification],
});
```

Broad searches can make many requests and retain the complete result in
memory. Pass an `AbortSignal` as the separate request argument when an
operation needs to be cancellable:

```ts
const controller = new AbortController();

const teams = await robot.teams.search(
  { registered: true },
  { signal: controller.signal },
);
```

Options use camelCase names and normal arrays. The client translates these to
the API's `snake_case` and repeated `field[]` parameters. Date filters accept
an RFC 3339 string or a `Date`; `Date` values are serialized with
`toISOString()`.

`eventTypes` is sent to the API as `eventTypes[]`; returned events are not
filtered again by the client. Event listings include cancelled events by
default. Pass `includeCancelled: false` to apply the legacy name-based filter
after all pages have been collected.

## Constants and helpers

Stable program and round identifiers are available from both the package and
the client. Seasons are intentionally queried dynamically rather than shipped
as a dated constant table.

```ts
import {
  getEventUrl,
  getMatchShortName,
  getTeamOutcome,
  programs,
  rounds,
} from "@v5x/events";

const program = await robot.programs.get(programs.V5RC);
const qualificationMatches = await robot.events.matches(eventId, divisionId, {
  rounds: [rounds.qualification],
});

for (const match of qualificationMatches) {
  console.log(getMatchShortName(match), getTeamOutcome(match, "123A"));
}

console.log(getEventUrl(events[0]!));
```

The package also exports `getTeamUrl`, `getAlliance`, `getMatchOutcome`, and
`getMatchTeams`. All helpers operate on the same plain response objects
returned by the client.

## Errors and rate limiting

HTTP errors throw `VexEventsApiError`, including `status`, `statusText`,
`body`, and the requested `url`. Invalid or unreadable successful responses
throw `VexEventsResponseError`. If a later page fails, the collection method
rejects without returning partial results.

Rate-limited (429) and unavailable (503) responses expose the API's
`Retry-After` hint as `retryAfterMs`. Pass the opt-in `retry` option to retry
429 responses automatically while honoring abort signals:

```ts
const robot = new Robot({
  token: process.env.VEX_EVENTS_TOKEN!,
  retry: { maxAttempts: 3, maxDelayMs: 30_000 },
});
```

## Migrating from 0.1

The 0.2 API replaces page-oriented collection methods with complete arrays:

| 0.1                              | 0.2                           |
| -------------------------------- | ----------------------------- |
| `robot.events.list()`            | `robot.events.search()`       |
| `robot.teams.list()`             | `robot.teams.search()`        |
| `robot.programs.list()`          | `robot.programs.all()`        |
| `robot.seasons.list()`           | `robot.seasons.all()`         |
| `PaginatedResponse<T>`           | `T[]`                         |
| `listPages()` / `matchesPages()` | Automatic internal pagination |

```ts
// 0.1
const page = await robot.events.list(options);
for (const event of page.data) console.log(event.name);

// 0.2
const events = await robot.events.search(options);
for (const event of events) console.log(event.name);
```

The `page` and `perPage` options have been removed because collection methods
always fetch the complete result set.

## Build

```sh
bun run build
```

## Acknowledgements

The resource naming, automatic pagination, lookup helpers, domain constants,
URL helpers, and match utilities were inspired by
[`events.vex`](https://better-hub.com/Jerrylum/events.vex) by Brendan McGuire
and Jerry Lum.
