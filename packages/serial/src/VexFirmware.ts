import {
  FileDownloadTarget,
  FileVendor,
  type IFileWriteRequest,
  USER_FLASH_USR_CODE_START,
} from "./Vex.js";
import { type V5SerialConnection } from "./VexConnection.js";
import type { V5SerialDeviceState } from "./VexDeviceState.js";
import {
  VexDownloadError,
  VexFirmwareError,
  VexInvalidArgumentError,
  VexNotConnectedError,
  VexProtocolError,
  VexSerialError,
  VexTransferError,
  toVexSerialError,
} from "./VexError.js";
import { err, errAsync, ok, Result, ResultAsync } from "neverthrow";
import {
  FactoryEnableH2DPacket,
  FactoryEnableReplyD2HPacket,
  FactoryStatusH2DPacket,
  FactoryStatusReplyD2HPacket,
} from "./VexPacketModels.js";

/** Maximum number of bytes accepted when downloading the version catalog. */
const MAX_CATALOG_BYTES = 4 * 1024;
/** Maximum compressed size accepted when downloading a VEXos archive. */
const MAX_VEXOS_BYTES = 64 * 1024 * 1024;
/** Maximum size accepted for any single extracted firmware image. */
const MAX_FIRMWARE_IMAGE_BYTES = 32 * 1024 * 1024;
/** Maximum total size accepted across all extracted firmware images. */
const MAX_AGGREGATE_IMAGE_BYTES = 48 * 1024 * 1024;

export interface DownloadFileFromInternetOptions {
  /** Maximum total bytes to read from the response body. */
  maxBytes?: number;
  /** Request timeout in milliseconds. */
  timeout?: number;
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
  if (maxBytes <= 0) {
    return errAsync(new VexInvalidArgumentError("maxBytes must be positive"));
  }
  if (timeout < 0) {
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
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    let response: Response;
    try {
      response = await fetch(link, { signal: controller.signal });
    } catch (e) {
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
    if (declaredLength !== null) {
      const declared = Number.parseInt(declaredLength, 10);
      if (!Number.isNaN(declared) && declared > 0 && declared > maxBytes) {
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
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value === undefined) continue;
        total += value.byteLength;
        if (total > maxBytes) {
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
        chunks.push(value);
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // The reader may already be released by cancel().
      }
    }

    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return ok(result.buffer);
  } finally {
    clearTimeout(timer);
  }
}

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
  if (timeout < 0) {
    return errAsync(
      new VexInvalidArgumentError("timeout must be non-negative"),
    );
  }
  if (interval <= 0) {
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
  if (timeout < 0) {
    return errAsync(
      new VexInvalidArgumentError("timeout must be non-negative"),
    );
  }
  if (interval <= 0) {
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
 * when `ms` is negative.
 */
export function sleep(ms: number): ResultAsync<void, VexSerialError> {
  if (ms < 0) {
    return errAsync(new VexInvalidArgumentError("ms must be non-negative"));
  }
  return ResultAsync.fromSafePromise<void>(sleepInner(ms));
}

async function sleepInner(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface FirmwareImage {
  name: string;
  buf: Uint8Array;
}

type FirmwareProgressCallback = (
  state: string,
  current: number,
  total: number,
) => void;

type FactoryImageLabel = "BOOT" | "ASSETS";

interface FactoryImageFlashOptions {
  image: FirmwareImage;
  label: FactoryImageLabel;
  downloadTarget: FileDownloadTarget;
}

async function flashFactoryImage(
  conn: V5SerialConnection,
  options: FactoryImageFlashOptions,
  pcb: FirmwareProgressCallback,
): Promise<Result<void, VexSerialError>> {
  const { image, label, downloadTarget } = options;
  pcb(`FACTORY ENB ${label}`, 0, 0);

  const enableReply = await conn.request(
    new FactoryEnableH2DPacket(),
    FactoryEnableReplyD2HPacket,
  );
  if (enableReply.isErr()) return err(enableReply.error);

  const writeRequest: IFileWriteRequest = {
    filename: "null.bin",
    vendor: FileVendor.USER,
    loadAddress: USER_FLASH_USR_CODE_START,
    buf: image.buf,
    downloadTarget,
    exttype: "bin",
    autoRun: true, // need to set EXIT_RUN
    linkedFile: undefined,
  };

  const upload = await conn.uploadFileToDevice(writeRequest, (c, t) => {
    pcb(`UPLOAD ${label}`, c, t);
  });
  if (upload.isErr()) return err(upload.error);
  if (!upload.value) {
    return err(new VexTransferError(`${label} upload was rejected by device`));
  }

  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const statusReply = await conn.request(
      new FactoryStatusH2DPacket(),
      FactoryStatusReplyD2HPacket,
      10000,
    );
    if (statusReply.isErr()) return err(statusReply.error);

    reportFactoryStatus(label, statusReply.value, pcb);

    if (statusReply.value.status === 0 && statusReply.value.percent === 100) {
      return ok(undefined);
    }
    await sleepInner(500);
  }

  return err(new VexProtocolError(`${label} factory status timed out`));
}

function reportFactoryStatus(
  label: FactoryImageLabel,
  reply: FactoryStatusReplyD2HPacket,
  pcb: FirmwareProgressCallback,
): void {
  switch (reply.status) {
    case 2:
      pcb(`ERASE ${label}`, reply.percent, 100);
      break;
    case 3:
      pcb(`WRITE ${label}`, reply.percent, 100);
      break;
    case 4:
      pcb(`VERIFY ${label}`, reply.percent, 100);
      break;
    case 8:
      pcb(`FINISHING ${label}`, reply.percent, 100);
      break;
  }
}

// Internal helper: stays throwing. The public `uploadFirmware` boundary
// converts thrown errors into the {@link VexSerialError} hierarchy.
async function extractFirmwareImages(
  usingVersion: string,
  vexos: ArrayBuffer,
): Promise<FirmwareImage[]> {
  const { unzip } = await import("unzipit");
  const { entries } = await unzip(vexos);

  const expectedPaths = new Set([
    `${usingVersion}/BOOT.bin`,
    `${usingVersion}/assets.bin`,
  ]);
  const unexpected: string[] = [];
  for (const name of Object.keys(entries)) {
    if (!expectedPaths.has(name)) unexpected.push(name);
  }
  if (unexpected.length > 0) {
    throw new VexFirmwareError(
      `VEXos archive contains unexpected entries: ${unexpected.join(", ")}`,
    );
  }

  const ordered: FirmwareImage[] = [];
  let aggregate = 0;
  for (const name of expectedPaths) {
    const entry = entries[name];
    if (entry === undefined) {
      throw new VexFirmwareError(`VEXos archive is missing ${name}`);
    }
    if (entry.encrypted) {
      throw new VexFirmwareError(`VEXos entry ${name} is encrypted`);
    }
    if (entry.size <= 0) {
      throw new VexFirmwareError(`VEXos entry ${name} is empty`);
    }
    if (entry.size > MAX_FIRMWARE_IMAGE_BYTES) {
      throw new VexFirmwareError(
        `VEXos entry ${name} (${entry.size} bytes) exceeds per-entry limit ${MAX_FIRMWARE_IMAGE_BYTES}`,
      );
    }
    aggregate += entry.size;
    if (aggregate > MAX_AGGREGATE_IMAGE_BYTES) {
      throw new VexFirmwareError(
        `VEXos aggregate extracted size exceeds limit ${MAX_AGGREGATE_IMAGE_BYTES}`,
      );
    }
    const buf = new Uint8Array(await entry.arrayBuffer());
    if (buf.byteLength === 0) {
      throw new VexFirmwareError(`VEXos entry ${name} is empty`);
    }
    if (buf.byteLength !== entry.size) {
      throw new VexFirmwareError(
        `VEXos entry ${name} size does not match its metadata (${buf.byteLength} vs ${entry.size})`,
      );
    }
    ordered.push({ name, buf });
  }

  return ordered;
}

/**
 * Upload a VEXos firmware archive to a connected brain. Network and
 * archive validation failures are returned as {@link VexSerialError}
 * values rather than thrown; a device that refuses a step or a missing
 * connection surfaces as {@link VexProtocolError} / {@link VexNotConnectedError}.
 */
export function uploadFirmware(
  state: V5SerialDeviceState,
  publicUrl = "https://content.vexrobotics.com/vexos/public/V5/",
  usingVersion?: string,
  progressCallback?: FirmwareProgressCallback,
): ResultAsync<boolean, VexSerialError> {
  return new ResultAsync(
    runUploadFirmware(state, publicUrl, usingVersion, progressCallback),
  );
}

async function runUploadFirmware(
  state: V5SerialDeviceState,
  publicUrl: string,
  usingVersion: string | undefined,
  progressCallback?: FirmwareProgressCallback,
): Promise<Result<boolean, VexSerialError>> {
  const device = state._instance;
  const conn = device.connection;
  if (conn == null || !conn.isConnected) {
    return err(new VexNotConnectedError());
  }

  const pcb = progressCallback ?? (() => {});
  let version = usingVersion;

  if (version === undefined) {
    pcb("FETCH CATALOG", 0, 1);
    const catalog = await downloadFileFromInternet(publicUrl + "catalog.txt", {
      maxBytes: MAX_CATALOG_BYTES,
    });
    if (catalog.isErr()) return err(catalog.error);
    version = new TextDecoder().decode(catalog.value).trim();
    pcb("FETCH CATALOG", 1, 1);
  }

  if (!/^[A-Za-z0-9._-]+$/.test(version)) {
    return err(new VexFirmwareError(`invalid VEXos version: ${version}`));
  }

  pcb("FETCH VEXOS", 0, 1);
  const vexosResult = await downloadFileFromInternet(
    publicUrl + version + ".vexos",
    { maxBytes: MAX_VEXOS_BYTES },
  );
  if (vexosResult.isErr()) return err(vexosResult.error);
  const vexos = vexosResult.value;
  if (vexos.byteLength === 0) {
    return err(new VexFirmwareError("VEXos archive is empty"));
  }
  pcb("FETCH VEXOS", 1, 1);
  pcb("UNZIP VEXOS", 0, 1);

  let images: FirmwareImage[];
  try {
    images = await extractFirmwareImages(version, vexos);
  } catch (e) {
    if (e instanceof VexSerialError) return err(e);
    return err(toVexSerialError(e, "firmware"));
  }
  pcb("UNZIP VEXOS", 1, 1);

  return state.withRefreshPaused(async () => {
    const boot = images.find((image) => image.name.endsWith("BOOT.bin"));
    if (boot === undefined) {
      return err(new VexFirmwareError("VEXos archive is missing BOOT.bin"));
    }
    const assertImage = images.find((image) =>
      image.name.endsWith("assets.bin"),
    );
    if (assertImage === undefined) {
      return err(new VexFirmwareError("VEXos archive is missing assets.bin"));
    }

    const bootFlash = await flashFactoryImage(
      conn,
      {
        image: boot,
        label: "BOOT",
        downloadTarget: FileDownloadTarget.FILE_TARGET_B1,
      },
      pcb,
    );
    if (bootFlash.isErr()) return err(bootFlash.error);

    const assetsFlash = await flashFactoryImage(
      conn,
      {
        image: assertImage,
        label: "ASSETS",
        downloadTarget: FileDownloadTarget.FILE_TARGET_A1,
      },
      pcb,
    );
    if (assetsFlash.isErr()) return err(assetsFlash.error);

    return ok(true);
  });
}
