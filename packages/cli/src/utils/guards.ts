export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function hasErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

/**
 * sade/mri represents a value-less option as the boolean `true`. Reject that
 * parser sentinel before it reaches path, string, or configuration APIs.
 */
export function requireOptionValue(
  value: string | boolean | undefined,
  option: string,
): string | undefined {
  if (typeof value === "boolean") {
    throw new Error(`${option} requires a value`);
  }
  return value;
}
