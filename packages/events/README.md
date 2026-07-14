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
import { VexEventsClient } from "@v5x/events";

const vex = new VexEventsClient({
  token: process.env.VEX_EVENTS_TOKEN!,
});

const teams = await vex.teams.list({
  numbers: ["123A"],
  registered: true,
  perPage: 100,
});

for (const team of teams.data ?? []) {
  console.log(team.number, team.team_name);
}
```

Resources mirror the API:

- `vex.events`: events, event teams, skills, awards, division matches, and rankings
- `vex.teams`: teams and their events, matches, rankings, skills, and awards
- `vex.programs`: programs
- `vex.seasons`: seasons and season events

All filters, response models, pagination metadata, and API error bodies are
exported as TypeScript types. Array filters use normal arrays; the client
encodes them using the API's repeated `field[]` query parameters. `Date` values
are converted to RFC 3339 strings automatically.

```ts
import { VexEventsApiError } from "@v5x/events";

try {
  const event = await vex.events.get(123);
  console.log(event.name);
} catch (error) {
  if (error instanceof VexEventsApiError) {
    console.error(error.status, error.body);
  }
}
```

## Build

```sh
bun run build
```
