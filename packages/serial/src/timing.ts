import {
  VexInvalidArgumentError,
  VexSerialError,
  toVexSerialError,
} from "./error.js";
import { err, errAsync, ok, Result, ResultAsync } from "neverthrow";

/**
 * Poll an async predicate until it returns true or the timeout elapses.
 * Argument errors are returned as {@link VexInvalidArgumentError}; a
 * throwing predicate surfaces its error through the {@link Result}
 * error channel.
 */
export function sleepUntilAsync(
  f: () => Promise<boolean>,
  timeout: number,
  interval = 20,
): ResultAsync<boolean, VexSerialError> {
  if (!Number.isFinite(timeout) || timeout < 0) {
    return errAsync(
      new VexInvalidArgumentError("timeout must be non-negative"),
    );
  }
  if (!Number.isFinite(interval) || interval <= 0) {
    return errAsync(new VexInvalidArgumentError("interval must be positive"));
  }
  return new ResultAsync(runSleepUntilAsync(f, timeout, interval));
}

async function runSleepUntilAsync(
  f: () => Promise<boolean>,
  timeout: number,
  interval: number,
): Promise<Result<boolean, VexSerialError>> {
  const deadline = Date.now() + timeout;
  while (Date.now() <= deadline) {
    try {
      if (await f()) return ok(true);
    } catch (e) {
      return err(toVexSerialError(e, "io"));
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleepInner(Math.min(interval, remaining));
  }
  return ok(false);
}

/**
 * Poll a synchronous predicate until it returns true or the timeout
 * elapses. The implementation uses a loop with `sleep` rather than
 * `setInterval` so the timer is cleared as soon as the predicate
 * resolves, and so predicate exceptions are surfaced without leaving a
 * pending interval behind.
 */
export function sleepUntil(
  f: () => boolean,
  timeout: number,
  interval = 20,
): ResultAsync<boolean, VexSerialError> {
  if (!Number.isFinite(timeout) || timeout < 0) {
    return errAsync(
      new VexInvalidArgumentError("timeout must be non-negative"),
    );
  }
  if (!Number.isFinite(interval) || interval <= 0) {
    return errAsync(new VexInvalidArgumentError("interval must be positive"));
  }
  return new ResultAsync(runSleepUntil(f, timeout, interval));
}

async function runSleepUntil(
  f: () => boolean,
  timeout: number,
  interval: number,
): Promise<Result<boolean, VexSerialError>> {
  const deadline = Date.now() + timeout;
  while (Date.now() <= deadline) {
    try {
      if (f()) return ok(true);
    } catch (e) {
      return err(toVexSerialError(e, "io"));
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleepInner(Math.min(interval, remaining));
  }
  return ok(false);
}

/**
 * Resolve after `ms` milliseconds. Returns a {@link VexInvalidArgumentError}
 * when `ms` is negative or non-finite.
 */
export function sleep(ms: number): ResultAsync<void, VexSerialError> {
  if (!Number.isFinite(ms) || ms < 0) {
    return errAsync(new VexInvalidArgumentError("ms must be non-negative"));
  }
  return ResultAsync.fromSafePromise<void>(sleepInner(ms));
}

async function sleepInner(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
