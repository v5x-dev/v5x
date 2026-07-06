export type V5WebErrorCode =
  | "web-serial-unavailable"
  | "connect-failed"
  | "connect-error"
  | "disconnect-error"
  | "refresh-error";

export class V5WebError extends Error {
  override readonly name = "V5WebError";

  constructor(
    readonly code: V5WebErrorCode,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
  }
}

export function normalizeV5WebError(
  code: V5WebErrorCode,
  error: unknown,
  fallbackMessage: string,
): V5WebError {
  if (error instanceof V5WebError) return error;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string" && error !== ""
        ? error
        : fallbackMessage;
  return new V5WebError(code, message, error);
}
