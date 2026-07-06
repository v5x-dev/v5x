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

If a background or explicit `refresh()` fails, the snapshot moves to `error`
with a normalized `refresh-error`. The stale device is disconnected or disposed,
background refresh stops, and the attached device is cleared. Call `connect()`
again to make a fresh connection attempt; call `disconnect()` from the error
state to clear the error and return to `idle` without retrying.

Framework bindings are available as subpath exports:

```ts
import { V5Provider, useV5Snapshot } from "@v5x/web/react";
import { createV5State } from "@v5x/web/svelte";
import { createV5Snapshot } from "@v5x/web/solid";
```

Testing and examples that need a fake device can use the testing subpath:

```ts
import { createV5ClientWithFactory } from "@v5x/web/testing";
```
