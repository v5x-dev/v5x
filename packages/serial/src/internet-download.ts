import {
  VexDownloadError,
  VexInvalidArgumentError,
  VexSerialError,
} from "./error.js";
import { err, errAsync, ok, Result, ResultAsync } from "neverthrow";
import { DownloadBuffer } from "./download-buffer.js";

export interface DownloadFileFromInternetOptions {
  /** Maximum total bytes to read, or positive infinity for no size limit. */
  maxBytes?: number;
  /**
   * Maximum milliseconds to wait for response headers or the next body chunk.
   * The timer resets whenever download progress is made. Zero requests an
   * immediate deadline.
   */
  timeout?: number;
}

class DownloadTimeoutError extends Error {
  constructor(
    readonly timeout: number,
    readonly phase: "response" | "body",
  ) {
    super(`download timed out after ${timeout}ms`);
    this.name = "DownloadTimeoutError";
  }
}

/**
 * Download a remote resource while enforcing a maximum body size. The
 * declared `Content-Length` header is validated up front, and the body
 * is streamed so an oversized payload is rejected before it is fully
 * read into memory. Failures are returned as a {@link VexDownloadError}
 * (or {@link VexInvalidArgumentError} for bad options) instead of
 * thrown.
 */
export function downloadFileFromInternet(
  link: string,
  options: DownloadFileFromInternetOptions = {},
): ResultAsync<ArrayBuffer, VexSerialError> {
  const { maxBytes = Number.POSITIVE_INFINITY, timeout = 30000 } = options;
  if (
    Number.isNaN(maxBytes) ||
    maxBytes <= 0 ||
    maxBytes === Number.NEGATIVE_INFINITY
  ) {
    return errAsync(new VexInvalidArgumentError("maxBytes must be positive"));
  }
  if (!Number.isFinite(timeout) || timeout < 0) {
    return errAsync(
      new VexInvalidArgumentError("timeout must be non-negative"),
    );
  }
  return new ResultAsync(runDownload(link, maxBytes, timeout));
}

async function runDownload(
  link: string,
  maxBytes: number,
  timeout: number,
): Promise<Result<ArrayBuffer, VexSerialError>> {
  const controller = new AbortController();
  try {
    let response: Response;
    try {
      response = await withDownloadTimeout(
        fetch(link, { signal: controller.signal }),
        timeout,
        controller,
        "response",
      );
    } catch (e) {
      if (e instanceof DownloadTimeoutError) {
        return err(
          new VexDownloadError(
            `download timed out after ${e.timeout}ms waiting for a response from ${link}`,
          ),
        );
      }
      return err(
        new VexDownloadError(
          `failed to download ${link} (${e instanceof Error ? e.message : String(e)})`,
        ),
      );
    }
    if (!response.ok) {
      return err(
        new VexDownloadError(`failed to download ${link} (${response.status})`),
      );
    }

    const declaredLength = response.headers.get("content-length");
    const declared =
      declaredLength !== null && /^\d+$/.test(declaredLength.trim())
        ? Number(declaredLength)
        : undefined;
    if (declared !== undefined && Number.isSafeInteger(declared)) {
      if (declared > maxBytes) {
        return err(
          new VexDownloadError(
            `declared content length ${declared} exceeds limit ${maxBytes} for ${link}`,
          ),
        );
      }
    }

    if (response.body == null) {
      return err(new VexDownloadError(`no response body for ${link}`));
    }

    const reader = response.body.getReader();
    const initialCapacity =
      declared !== undefined &&
      Number.isSafeInteger(declared) &&
      Number.isFinite(maxBytes)
        ? declared
        : 0;
    const buffer = new DownloadBuffer(initialCapacity, maxBytes);
    try {
      for (;;) {
        let chunk: Awaited<ReturnType<typeof reader.read>>;
        try {
          chunk = await withDownloadTimeout(
            reader.read(),
            timeout,
            controller,
            "body",
          );
        } catch (e) {
          if (e instanceof DownloadTimeoutError) {
            void reader.cancel(e).catch(() => {
              // Aborting the fetch may already have errored the body.
            });
            return err(
              new VexDownloadError(
                `download timed out after ${e.timeout}ms waiting for data from ${link}`,
              ),
            );
          }
          return err(
            new VexDownloadError(
              `failed to download ${link} (${e instanceof Error ? e.message : String(e)})`,
            ),
          );
        }
        const { value, done } = chunk;
        if (done) break;
        if (value === undefined) continue;
        if (!buffer.append(value)) {
          try {
            await reader.cancel();
          } catch {
            // The reader may already be in a terminal state.
          }
          return err(
            new VexDownloadError(
              `downloaded body exceeds limit ${maxBytes} for ${link}`,
            ),
          );
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // The reader may already be released by cancel().
      }
    }

    return ok(buffer.finish());
  } finally {
    controller.abort();
  }
}

function withDownloadTimeout<T>(
  operation: Promise<T>,
  timeout: number,
  controller: AbortController,
  phase: "response" | "body",
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new DownloadTimeoutError(timeout, phase);
      controller.abort(error);
      reject(error);
    }, timeout);
    void operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
