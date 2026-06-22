import {
  FileDownloadTarget,
  FileVendor,
  type IFileWriteRequest,
  USER_FLASH_USR_CODE_START,
} from "./Vex";
import type { V5SerialDeviceState } from "./VexDeviceState";
import {
  FactoryEnableH2DPacket,
  FactoryEnableReplyD2HPacket,
  FactoryStatusH2DPacket,
  FactoryStatusReplyD2HPacket,
} from "./VexPacketModels";

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
 * read into memory.
 */
export async function downloadFileFromInternet(
  link: string,
  options: DownloadFileFromInternetOptions = {},
): Promise<ArrayBuffer> {
  const { maxBytes = Number.POSITIVE_INFINITY, timeout = 30000 } = options;
  if (maxBytes <= 0) {
    throw new RangeError("maxBytes must be positive");
  }
  if (timeout < 0) {
    throw new RangeError("timeout must be non-negative");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(link, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`failed to download ${link} (${response.status})`);
    }

    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null) {
      const declared = Number.parseInt(declaredLength, 10);
      if (!Number.isNaN(declared) && declared > 0 && declared > maxBytes) {
        throw new RangeError(
          `declared content length ${declared} exceeds limit ${maxBytes} for ${link}`,
        );
      }
    }

    if (response.body == null) {
      throw new Error(`no response body for ${link}`);
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
          throw new RangeError(
            `downloaded body exceeded limit ${maxBytes} for ${link}`,
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
    return result.buffer;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Poll an async predicate until it returns true or the timeout elapses.
 * Throws if the predicate throws; rejects with `RangeError` if the
 * arguments are invalid.
 */
export async function sleepUntilAsync(
  f: () => Promise<boolean>,
  timeout: number,
  interval = 20,
): Promise<boolean> {
  if (timeout < 0) {
    throw new RangeError("timeout must be non-negative");
  }
  if (interval <= 0) {
    throw new RangeError("interval must be positive");
  }
  const deadline = Date.now() + timeout;
  while (Date.now() <= deadline) {
    // Propagate predicate failures immediately; do not swallow them.
    if (await f()) return true;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(interval, remaining));
  }
  return false;
}

/**
 * Poll a synchronous predicate until it returns true or the timeout
 * elapses. The implementation uses a loop with `sleep` rather than
 * `setInterval` so the timer is cleared as soon as the predicate
 * resolves, and so predicate exceptions are surfaced without leaving a
 * pending interval behind.
 */
export async function sleepUntil(
  f: () => boolean,
  timeout: number,
  interval = 20,
): Promise<boolean> {
  if (timeout < 0) {
    throw new RangeError("timeout must be non-negative");
  }
  if (interval <= 0) {
    throw new RangeError("interval must be positive");
  }
  const deadline = Date.now() + timeout;
  while (Date.now() <= deadline) {
    if (f()) return true;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(interval, remaining));
  }
  return false;
}

export async function sleep(ms: number): Promise<unknown> {
  if (ms < 0) {
    throw new RangeError("ms must be non-negative");
  }
  return await new Promise((resolve) => setTimeout(resolve, ms));
}

interface FirmwareImage {
  name: string;
  buf: Uint8Array;
}

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
    throw new Error(
      `VEXos archive contains unexpected entries: ${unexpected.join(", ")}`,
    );
  }

  const ordered: FirmwareImage[] = [];
  let aggregate = 0;
  for (const name of expectedPaths) {
    const entry = entries[name];
    if (entry === undefined) {
      throw new Error(`VEXos archive is missing ${name}`);
    }
    if (entry.encrypted) {
      throw new Error(`VEXos entry ${name} is encrypted`);
    }
    if (entry.size <= 0) {
      throw new Error(`VEXos entry ${name} is empty`);
    }
    if (entry.size > MAX_FIRMWARE_IMAGE_BYTES) {
      throw new RangeError(
        `VEXos entry ${name} (${entry.size} bytes) exceeds per-entry limit ${MAX_FIRMWARE_IMAGE_BYTES}`,
      );
    }
    aggregate += entry.size;
    if (aggregate > MAX_AGGREGATE_IMAGE_BYTES) {
      throw new RangeError(
        `VEXos aggregate extracted size exceeds limit ${MAX_AGGREGATE_IMAGE_BYTES}`,
      );
    }
    const buf = new Uint8Array(await entry.arrayBuffer());
    if (buf.byteLength === 0) {
      throw new Error(`VEXos entry ${name} is empty`);
    }
    if (buf.byteLength !== entry.size) {
      throw new Error(
        `VEXos entry ${name} size does not match its metadata (${buf.byteLength} vs ${entry.size})`,
      );
    }
    ordered.push({ name, buf });
  }

  return ordered;
}

export async function uploadFirmware(
  state: V5SerialDeviceState,
  publicUrl = "https://content.vexrobotics.com/vexos/public/V5/",
  usingVersion?: string,
  progressCallback?: (state: string, current: number, total: number) => void,
): Promise<boolean | undefined> {
  const device = state._instance;
  const conn = device.connection;
  if (conn == null || !conn.isConnected) return;

  const pcb = progressCallback ?? (() => {});

  if (usingVersion === undefined) {
    pcb("FETCH CATALOG", 0, 1);
    const catalog = await downloadFileFromInternet(publicUrl + "catalog.txt", {
      maxBytes: MAX_CATALOG_BYTES,
    });
    usingVersion = new TextDecoder().decode(catalog).trim();
    pcb("FETCH CATALOG", 1, 1);
  }

  if (!/^[A-Za-z0-9._-]+$/.test(usingVersion)) {
    throw new Error(`invalid VEXos version: ${usingVersion}`);
  }

  pcb("FETCH VEXOS", 0, 1);
  const vexos = await downloadFileFromInternet(
    publicUrl + usingVersion + ".vexos",
    { maxBytes: MAX_VEXOS_BYTES },
  );
  if (vexos.byteLength === 0) throw new Error("VEXos archive is empty");
  pcb("FETCH VEXOS", 1, 1);
  pcb("UNZIP VEXOS", 0, 1);

  const images = await extractFirmwareImages(usingVersion, vexos);
  pcb("UNZIP VEXOS", 1, 1);

  return await state.withFileTransfer(async () => {
    pcb("FACTORY ENB BOOT", 0, 0);

    const result = await conn.writeDataAsync(new FactoryEnableH2DPacket());
    if (!(result instanceof FactoryEnableReplyD2HPacket)) return false;

    const boot = images.find((image) => image.name.endsWith("BOOT.bin"));
    if (boot === undefined) {
      throw new Error("VEXos archive is missing BOOT.bin");
    }
    const assertImage = images.find((image) =>
      image.name.endsWith("assets.bin"),
    );
    if (assertImage === undefined) {
      throw new Error("VEXos archive is missing assets.bin");
    }

    const bootWriteRequest: IFileWriteRequest = {
      filename: "null.bin",
      vendor: FileVendor.USER,
      loadAddress: USER_FLASH_USR_CODE_START,
      buf: boot.buf,
      downloadTarget: FileDownloadTarget.FILE_TARGET_B1,
      exttype: "bin",
      autoRun: true, // need to set EXIT_RUN
      linkedFile: undefined,
    };

    const result2 = await conn.uploadFileToDevice(bootWriteRequest, (c, t) => {
      pcb("UPLOAD BOOT", c, t);
    });
    if (!result2) return false;

    const bootDeadline = Date.now() + 120000;
    let bootComplete = false;
    while (Date.now() < bootDeadline) {
      const result3 = await conn.writeDataAsync(
        new FactoryStatusH2DPacket(),
        10000,
      );
      if (result3 instanceof FactoryStatusReplyD2HPacket) {
        switch (result3.status) {
          case 2:
            pcb("ERASE BOOT", result3.percent, 100);
            break;
          case 3:
            pcb("WRITE BOOT", result3.percent, 100);
            break;
          case 4:
            pcb("VERIFY BOOT", result3.percent, 100);
            break;
          case 8:
            pcb("FINISHING BOOT", result3.percent, 100);
            break;
        }
        if (result3.status === 0 && result3.percent === 100) {
          bootComplete = true;
          break;
        }
      } else {
        return false;
      }
      await sleep(500);
    }
    if (!bootComplete) return false;

    pcb("FACTORY ENB ASSERT", 0, 0);

    const result5 = await conn.writeDataAsync(new FactoryEnableH2DPacket());
    if (!(result5 instanceof FactoryEnableReplyD2HPacket)) return false;

    const assertWriteRequest: IFileWriteRequest = {
      filename: "null.bin",
      vendor: FileVendor.USER,
      loadAddress: USER_FLASH_USR_CODE_START,
      buf: assertImage.buf,
      downloadTarget: FileDownloadTarget.FILE_TARGET_A1,
      exttype: "bin",
      autoRun: true, // need to set EXIT_RUN
      linkedFile: undefined,
    };

    const result6 = await conn.uploadFileToDevice(
      assertWriteRequest,
      (c, t) => {
        pcb("UPLOAD ASSERT", c, t);
      },
    );
    if (!result6) return false;

    const assertDeadline = Date.now() + 120000;
    let assertComplete = false;
    while (Date.now() < assertDeadline) {
      const result7 = await conn.writeDataAsync(
        new FactoryStatusH2DPacket(),
        10000,
      );
      if (result7 instanceof FactoryStatusReplyD2HPacket) {
        switch (result7.status) {
          case 2:
            pcb("ERASE ASSERT", result7.percent, 100);
            break;
          case 3:
            pcb("WRITE ASSERT", result7.percent, 100);
            break;
          case 4:
            pcb("VERIFY ASSERT", result7.percent, 100);
            break;
          case 8:
            pcb("FINISHING ASSERT", result7.percent, 100);
            break;
        }

        if (result7.status === 0 && result7.percent === 100) {
          assertComplete = true;
          break;
        }
      } else {
        return false;
      }
      await sleep(500);
    }
    if (!assertComplete) return false;
    return true;
  });
}
