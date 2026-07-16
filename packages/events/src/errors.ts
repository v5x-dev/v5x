import type { ApiErrorBody } from "./types.js";

export class VexEventsApiError extends Error {
  override readonly name = "VexEventsApiError";

  constructor(
    readonly status: number,
    readonly statusText: string,
    readonly body: ApiErrorBody | string | null,
    readonly url: string,
    /** Delay advertised by a Retry-After header on 429/503 responses. */
    readonly retryAfterMs?: number,
  ) {
    const apiMessage =
      typeof body === "object" && body !== null ? body.message : undefined;
    super(
      apiMessage ?? `VEX Events API request failed: ${status} ${statusText}`,
    );
  }
}

export class VexEventsResponseError extends Error {
  override readonly name = "VexEventsResponseError";

  constructor(
    message: string,
    readonly url: string,
    override readonly cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
  }
}
