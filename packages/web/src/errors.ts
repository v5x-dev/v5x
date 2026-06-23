export type V5WebErrorCode =
  | "web-serial-unavailable"
  | "connect-failed"
  | "connect-error"
  | "disconnect-error"
  | "refresh-error";

export class V5WebError extends Error {
  readonly code: V5WebErrorCode;
  override readonly cause?: unknown;

  constructor(code: V5WebErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "V5WebError";
    this.code = code;
    this.cause = cause;
  }
}

export function normalizeV5WebError(
  code: V5WebErrorCode,
  error: unknown,
  fallbackMessage: string,
): V5WebError {
  if (error instanceof V5WebError) return error;
  if (error instanceof Error) {
    return new V5WebError(code, error.message, error);
  }
  if (typeof error === "string" && error.length > 0) {
    return new V5WebError(code, error, error);
  }
  return new V5WebError(code, fallbackMessage, error);
}
