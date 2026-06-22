import {
  type IFileBasicInfo,
  type IFileHandle,
  FileVendor,
  type IProgramInfo,
  type IFileWriteRequest,
  FileDownloadTarget,
  RadioChannelType,
  AckType,
} from "./Vex";
import { type ProgramIniConfig } from "./VexIniConfig";
import type { V5SerialDeviceState } from "./VexDeviceState";
import { sleep, sleepUntilAsync } from "./VexFirmware";
import type { HostBoundPacket } from "./VexPacketBase";
import {
  GetDirectoryEntryH2DPacket,
  GetDirectoryEntryReplyD2HPacket,
  GetDirectoryFileCountH2DPacket,
  GetDirectoryFileCountReplyD2HPacket,
  GetProgramSlotInfoH2DPacket,
  GetProgramSlotInfoReplyD2HPacket,
  ReadKeyValueH2DPacket,
  ReadKeyValueReplyD2HPacket,
  ScreenCaptureH2DPacket,
  ScreenCaptureReplyD2HPacket,
  WriteKeyValueH2DPacket,
  WriteKeyValueReplyD2HPacket,
} from "./VexPacketModels";

export async function getValue(
  state: V5SerialDeviceState,
  key: string,
): Promise<string | undefined> {
  const result = await state._instance.connection?.writeDataAsync(
    new ReadKeyValueH2DPacket(key),
  );
  return result instanceof ReadKeyValueReplyD2HPacket
    ? result.value
    : undefined;
}

export async function setValue(
  state: V5SerialDeviceState,
  key: string,
  value: string,
): Promise<boolean> {
  const result = await state._instance.connection?.writeDataAsync(
    new WriteKeyValueH2DPacket(key, value),
  );
  return result instanceof WriteKeyValueReplyD2HPacket;
}

export async function listFiles(
  state: V5SerialDeviceState,
  vendor = FileVendor.USER,
): Promise<IFileHandle[] | undefined> {
  const conn = state._instance.connection;
  if (conn == null || !conn.isConnected) return;

  const result = await conn.writeDataAsync(
    new GetDirectoryFileCountH2DPacket(vendor),
  );
  if (!(result instanceof GetDirectoryFileCountReplyD2HPacket)) return;

  const files: IFileHandle[] = [];
  for (let i = 0; i < result.count; i++) {
    const result2 = await conn.writeDataAsync(
      new GetDirectoryEntryH2DPacket(i),
    );
    if (!(result2 instanceof GetDirectoryEntryReplyD2HPacket)) return;

    // .file is undefined if the file is not found
    // .file is a file entry but not a file handle
    if (result2.file != null) {
      files.push({
        filename: result2.file.filename,
        vendor,
        loadAddress: result2.file.loadAddress,

        size: result2.file.size,
        crc32: result2.file.crc32,

        type: result2.file.type,
        timestamp: result2.file.timestamp,
        version: result2.file.version,
      });
    }
  }

  return files;
}

export async function listProgram(
  state: V5SerialDeviceState,
): Promise<IProgramInfo[] | undefined> {
  const conn = state._instance.connection;
  if (conn == null || !conn.isConnected) return;

  const files = await listFiles(state, FileVendor.USER);
  if (files === undefined) return;

  const programList: IProgramInfo[] = [];
  const iniFiles = files.filter(
    (file) => file?.filename?.endsWith(".ini") ?? false,
  );

  for (let i = 0; i < iniFiles.length; i++) {
    const ini = iniFiles[i]!;
    if (ini.size === 0) continue;

    const programName = /(.+?)(\.[^.]*$|$)/.exec(ini.filename)?.[1] ?? "";
    const bin = files.filter(
      (e) => e != null && e.filename === programName + ".bin",
    )[0];
    if (bin == null || bin.timestamp === 0 || bin.size === 0) continue;

    const n = new Date();
    n.setTime(1000 * bin.timestamp);
    const program: IProgramInfo = {
      name: programName,
      binfile: bin.filename,
      size: ini.size + bin.size,
      slot: -1,
      time: n,
      requestedSlot: -1,
    };

    const result2 = await conn?.writeDataAsync(
      new GetProgramSlotInfoH2DPacket(FileVendor.USER, program.binfile),
    );
    if (result2 instanceof GetProgramSlotInfoReplyD2HPacket) {
      program.slot = result2.slot;
      program.requestedSlot = result2.requestedSlot;
    }
    programList.push(program);
  }
  return programList;
}

export async function readFile(
  state: V5SerialDeviceState,
  request: IFileBasicInfo | string,
  downloadTarget = FileDownloadTarget.FILE_TARGET_QSPI,
  progressCallback?: (current: number, total: number) => void,
): Promise<Uint8Array | undefined> {
  const conn = state._instance.connection;
  if (conn == null || !conn.isConnected) return;

  let handle: IFileBasicInfo;

  // If request is a string, then it is a filename
  if (typeof request === "string") {
    handle = { filename: request, vendor: FileVendor.USER };
  } else {
    handle = request;
  }

  return await state.withFileTransfer(async () => {
    return await conn.downloadFileToHost(
      handle,
      downloadTarget,
      progressCallback,
    );
  });
}

export async function removeFile(
  state: V5SerialDeviceState,
  request: IFileBasicInfo | string,
): Promise<boolean | undefined> {
  const conn = state._instance.connection;
  if (conn == null || !conn.isConnected) return;

  return await state.withFileTransfer(async () => {
    return await conn.removeFile(request);
  });
}

export async function removeAllFiles(
  state: V5SerialDeviceState,
): Promise<boolean | undefined> {
  const conn = state._instance.connection;
  if (conn == null || !conn.isConnected) return undefined;

  return await state.withFileTransfer(async () => {
    return await conn.removeAllFiles();
  });
}

export async function uploadProgram(
  state: V5SerialDeviceState,
  iniConfig: ProgramIniConfig,
  binFileBuf: Uint8Array,
  coldFileBuf: Uint8Array | undefined,
  progressCallback: (state: string, current: number, total: number) => void,
): Promise<boolean | undefined> {
  const device = state._instance;
  const conn = device.connection;
  if (conn == null || !conn.isConnected) return;

  let switchedToDownload = false;

  return await state.withFileTransfer(async () => {
    try {
      if (device.isV5Controller) {
        await sleep(250);

        // V5 Controller doesn\'t appear to be connected to a V5 Brain
        if (!(await device.refresh())) return;

        progressCallback("CHANNEL", 0, 1);

        const p1 = await device.radio.changeChannel(RadioChannelType.DOWNLOAD);
        if (!p1) return false;
        switchedToDownload = true;

        await sleep(250);
        const transferred = await sleepUntilAsync(
          async () => (await conn?.getSystemStatus(150)) != null,
          10000,
          200,
        );
        if (!transferred) return false;

        progressCallback("CHANNEL", 1, 1);
      }

      const p2 = await conn.uploadProgramToDevice(
        iniConfig,
        binFileBuf,
        coldFileBuf,
        progressCallback,
      );
      if (!(p2 ?? false)) return false;

      if (device.isV5Controller) {
        // Disconnected
        if (!device.brain.isAvailable) return false;

        progressCallback("CHANNEL", 0, 1);

        const p3 = await device.radio.changeChannel(RadioChannelType.PIT);
        if (!p3) return false;
        switchedToDownload = false;

        await sleep(250);
        const transferred = await sleepUntilAsync(
          async () => (await conn?.getSystemStatus(150)) != null,
          10000,
          200,
        );
        if (!transferred) return false;

        progressCallback("CHANNEL", 1, 1);
      }

      return true;
    } finally {
      if (switchedToDownload) {
        await device.radio.changeChannel(RadioChannelType.PIT);
      }
    }
  });
}

export async function writeFile(
  state: V5SerialDeviceState,
  request: IFileWriteRequest,
  progressCallback?: (current: number, total: number) => void,
): Promise<boolean | undefined> {
  const conn = state._instance.connection;
  if (conn == null || !conn.isConnected) return undefined;
  return await state.withFileTransfer(async () => {
    return await conn.uploadFileToDevice(request, progressCallback);
  });
}

/**
 *
 * @param progressCallback Informs the progress of the download.
 * @returns array of bytes where each pixel is represented by 3 consecutive bytes (rgb).
 * This array's length is 272 width * 480 height * 3 channels = 391680 bytes.
 */
export async function captureScreen(
  state: V5SerialDeviceState,
  progressCallback?: (current: number, total: number) => void,
): Promise<Uint8Array | undefined> {
  // pros implementation: https://github.com/purduesigbots/pros-cli/blob/5ee18656faeb48f51d680bab4b53d5b59cc5a7d5/pros/serial/devices/vex/v5_device.py#L578

  const conn = state._instance.connection;
  if (conn == null || !conn.isConnected) return undefined;

  return await state.withFileTransfer(async () => {
    const response = await new Promise<HostBoundPacket | ArrayBuffer | AckType>(
      (resolve) => {
        conn.writeData(new ScreenCaptureH2DPacket(0), resolve);
      },
    );
    if (!(response instanceof ScreenCaptureReplyD2HPacket)) {
      throw new Error("screen capture request was rejected");
    }

    const height = 272;
    const width = 480;
    const channels = 3;
    const messageWidth = 512; // brain goofiness
    const messageChannels = 4; // brain goofiness

    let buf = await conn.downloadFileToHostUnlocked(
      {
        filename: "screen",
        vendor: FileVendor.SYS,
        loadAddress: 0,
        size: messageWidth * height * messageChannels, // RGBA ig
      },
      FileDownloadTarget.FILE_TARGET_CBUF,
      progressCallback,
    );

    buf = buf
      // remove the extra columns
      .filter(
        (_byte, i) =>
          i % (messageWidth * messageChannels) < width * messageChannels,
      )
      // remove the fake alpha channel
      .filter((_byte, i) => (i + 1) % messageChannels !== 0);

    // reverse the pixel (bgr -> rgb)
    for (let i = 0; i < buf.length; i += channels) {
      const px = buf.slice(i, i + channels).reverse();
      for (let j = 0; j < px.length; j++) {
        buf[i + j] = px[j]!;
      }
    }

    return buf;
  });
}
