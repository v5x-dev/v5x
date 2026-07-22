import { V5WebError as RootV5WebError } from "../dist/index.js";
import { V5WebError as TestingV5WebError } from "../dist/testing.js";
import { V5WebError as ReactV5WebError } from "../dist/react/index.js";
import { V5WebError as SvelteV5WebError } from "../dist/svelte/index.js";
import { V5WebError as SolidV5WebError } from "../dist/solid/index.js";

const entrypointErrors = [
  TestingV5WebError,
  ReactV5WebError,
  SvelteV5WebError,
  SolidV5WebError,
];

for (const EntrypointV5WebError of entrypointErrors) {
  const error = new EntrypointV5WebError("connect-error", "test error");
  if (
    EntrypointV5WebError !== RootV5WebError ||
    !(error instanceof RootV5WebError)
  ) {
    throw new Error("@v5x/web entrypoints do not share V5WebError");
  }
}
