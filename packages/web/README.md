# @v5x/web

Browser workflow layer for VEX V5 Web Serial applications.

`@v5x/web` wraps `@v5x/serial` with a small subscription-based client that tracks connection status, Web Serial support, and normalized errors.

```ts
import { createV5Client } from "@v5x/web";

const client = createV5Client();

client.subscribe(() => {
  console.log(client.getSnapshot());
});

const connected = await client.connect();

if (connected) {
  await client.refresh();
}
```

Web Serial is browser-only and requires HTTPS or `localhost`. Call `connect()` from a user gesture so the browser can show the permission prompt.

When Web Serial is unavailable, `V5Snapshot.unavailableReason` and
`getWebSerialUnavailableReason()` return one of these stable strings:

- `non-browser-runtime`: `window` or `navigator` is not available.
- `insecure-context`: the page is not running in a secure context.
- `unsupported-browser`: the current browser is known not to support Web Serial.
- `web-serial-unavailable`: stable fallback for a missing Serial implementation.

Framework bindings are available as subpath exports:

```ts
import { V5Provider, useV5Snapshot } from "@v5x/web/react";
import { createV5State } from "@v5x/web/svelte";
import { createV5Snapshot } from "@v5x/web/solid";
```
