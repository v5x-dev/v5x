import {
  FileDownloadTarget,
  FileVendor,
  type IFileWriteRequest,
  USER_FLASH_USR_CODE_START,
} from "./Vex.js";
import type { V5SerialDeviceState } from "./VexDeviceState.js";
import {
  FactoryEnableH2DPacket,
  FactoryEnableReplyD2HPacket,
  FactoryStatusH2DPacket,
  FactoryStatusReplyD2HPacket,
} from "./VexPacketModels.js";

const MAX_VEXOS_ARCHIVE_SIZE = 64 * 1024 * 1024;
const MAX_FIRMWARE_IMAGE_SIZE = 32 * 1024 * 1024;
const MAX_FIRMWARE_TOTAL_SIZE = 48 * 1024 * 1024;

export async function downloadFileFromInternet(
  link: string,
  timeout = 30000,
): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(link, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`failed to download ${link} (${response.status})`);
    }
    const declaredSize = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(declaredSize) &&
      declaredSize > MAX_VEXOS_ARCHIVE_SIZE
    ) {
      throw new Error(`download exceeds ${MAX_VEXOS_ARCHIVE_SIZE} bytes`);
    }
    const data = await response.arrayBuffer();
    if (data.byteLength > MAX_VEXOS_ARCHIVE_SIZE) {
      throw new Error(`download exceeds ${MAX_VEXOS_ARCHIVE_SIZE} bytes`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function sleepUntilAsync(
  f: () => Promise<boolean>,
  timeout: number,
  interval = 20,
): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() <= deadline) {
    if (await f()) return true;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(interval, remaining));
  }
  return false;
}

export async function sleepUntil(
  f: () => boolean,
  timeout: number,
  interval = 20,
): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const timeWas = new Date().getTime();
    const wait = setInterval(function () {
      if (f()) {
        clearInterval(wait);
        resolve(true);
      } else if (new Date().getTime() - timeWas > timeout) {
        // Timeout
        clearInterval(wait);
        resolve(false);
      }
    }, interval);
  });
}

export async function sleep(ms: number): Promise<unknown> {
  return await new Promise((resolve) => setTimeout(resolve, ms));
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
    const catalog = await downloadFileFromInternet(publicUrl + "catalog.txt");
    usingVersion = new TextDecoder().decode(catalog).trim();
    pcb("FETCH CATALOG", 1, 1);
  }

  if (!/^[A-Za-z0-9._-]+$/.test(usingVersion)) {
    throw new Error(`invalid VEXos version: ${usingVersion}`);
  }

  pcb("FETCH VEXOS", 0, 1);
  const vexos = await downloadFileFromInternet(
    publicUrl + usingVersion + ".vexos",
  );
  if (vexos.byteLength === 0) throw new Error("VEXos archive is empty");
  pcb("FETCH VEXOS", 1, 1);
  pcb("UNZIP VEXOS", 0, 1);

  const { unzip } = await import("unzipit");
  const { entries } = await unzip(vexos);
  const bootEntry = entries[usingVersion + "/BOOT.bin"];
  const assertEntry = entries[usingVersion + "/assets.bin"];
  if (bootEntry === undefined || assertEntry === undefined) {
    throw new Error("VEXos archive is missing firmware images");
  }
  if (bootEntry.encrypted || assertEntry.encrypted) {
    throw new Error("VEXos archive contains encrypted firmware images");
  }
  if (
    bootEntry.size > MAX_FIRMWARE_IMAGE_SIZE ||
    assertEntry.size > MAX_FIRMWARE_IMAGE_SIZE ||
    bootEntry.size + assertEntry.size > MAX_FIRMWARE_TOTAL_SIZE
  ) {
    throw new Error("VEXos firmware images exceed the supported size limit");
  }
  const bootBin = await bootEntry.arrayBuffer();
  const assertBin = await assertEntry.arrayBuffer();
  if (bootBin.byteLength === 0 || assertBin.byteLength === 0) {
    throw new Error("VEXos archive contains an empty firmware image");
  }
  if (
    bootBin.byteLength !== bootEntry.size ||
    assertBin.byteLength !== assertEntry.size
  ) {
    throw new Error("VEXos firmware image size does not match its metadata");
  }
  pcb("UNZIP VEXOS", 1, 1);

  return await state.withFileTransfer(async () => {
    pcb("FACTORY ENB BOOT", 0, 0);

    const result = await conn.writeDataAsync(new FactoryEnableH2DPacket());
    if (!(result instanceof FactoryEnableReplyD2HPacket)) return false;

    const bootWriteRequest: IFileWriteRequest = {
      filename: "null.bin",
      vendor: FileVendor.USER,
      loadAddress: USER_FLASH_USR_CODE_START,
      buf: new Uint8Array(bootBin),
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
      buf: new Uint8Array(assertBin),
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
