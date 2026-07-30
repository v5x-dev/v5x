import { VexInvalidArgumentError } from "./error.js";

// JavaScript runtimes store timer delays as signed 32-bit integers. Reject
// larger values instead of letting the runtime shorten them to an immediate
// timeout.
const MAX_TIMER_DELAY_MS = 0x7fffffff;

export function requestTimeoutError(
  timeout: number,
): VexInvalidArgumentError | undefined {
  if (
    !Number.isFinite(timeout) ||
    timeout < 0 ||
    timeout > MAX_TIMER_DELAY_MS
  ) {
    return new VexInvalidArgumentError(
      `timeout must be a finite number between 0 and ${MAX_TIMER_DELAY_MS} milliseconds`,
    );
  }
  return undefined;
}
