import {
  type IFileBasicInfo,
  type IFileHandle,
  FileVendor,
  type IProgramInfo,
  type IFileWriteRequest,
  FileDownloadTarget,
  RadioChannelType,
} from "./Vex.js";
import { type ProgramIniConfig } from "./VexIniConfig.js";
import type { V5SerialDeviceState } from "./VexDeviceState.js";
import { sleep, sleepUntilAsync } from "./VexFirmware.js";
import {
  VexNotConnectedError,
  VexProtocolError,
  VexSerialError,
} from "./VexError.js";
import { err, ok, Result, ResultAsync } from "neverthrow";
import {
  GetDirectoryEntryH2DPacket,
  GetDirectoryEntryReplyD2HPacket,
  GetDirectoryFileCountH2DPacket,
  GetDirectoryFileCountReplyD2HPacket,
  GetProgramSlotInfoH2DPacket,
  GetProgramSlotInfoReplyD2HPacket,
  ReadKeyValueH2DPacket,
  ReadKeyValueReplyD2HPacket,
  WriteKeyValueH2DPacket,
  WriteKeyValueReplyD2HPacket,
} from "./VexPacketModels.js";

export function getValue(
  state: V5SerialDeviceState,
  key: string,
): ResultAsync<string | undefined, VexSerialError> {
  return new ResultAsync(
    (async () => {
      const conn = state._instance.connection;
      if (conn == null || !conn.isConnected) {
        return err(new VexNotConnectedError());
      }
      const result = await conn.writeDataAsync(new ReadKeyValueH2DPacket(key));
      return result instanceof ReadKeyValueReplyD2HPacket
        ? ok(result.value)
        : err(new VexProtocolError("getValue was not acknowledged"));
    })(),
  );
}

export function setValue(
  state: V5SerialDeviceState,
  key: string,
  value: string,
): ResultAsync<void, VexSerialError> {
  return new ResultAsync(
    (async () => {
      const conn = state._instance.connection;
      if (conn == null || !conn.isConnected) {
        return err(new VexNotConnectedError());
      }
      const result = await conn.writeDataAsync(
        new WriteKeyValueH2DPacket(key, value),
      );
      return result instanceof WriteKeyValueReplyD2HPacket
        ? ok(undefined)
        : err(new VexProtocolError("setValue was not acknowledged"));
    })(),
  );
}

export function listFiles(
  state: V5SerialDeviceState,
  vendor = FileVendor.USER,
): ResultAsync<IFileHandle[], VexSerialError> {
  return new ResultAsync(
    (async () => {
      const conn = state._instance.connection;
      if (conn == null || !conn.isConnected) {
        return err(new VexNotConnectedError());
      }
      const result = await conn.writeDataAsync(
        new GetDirectoryFileCountH2DPacket(vendor),
      );
      if (!(result instanceof GetDirectoryFileCountReplyD2HPacket)) {
        return err(
          new VexProtocolError("directory file count was not acknowledged"),
        );
      }

      const files: IFileHandle[] = [];
      for (let i = 0; i < result.count; i++) {
        const result2 = await conn.writeDataAsync(
          new GetDirectoryEntryH2DPacket(i),
        );
        if (!(result2 instanceof GetDirectoryEntryReplyD2HPacket)) {
          return err(
            new VexProtocolError("directory entry was not acknowledged"),
          );
        }

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

      return ok(files);
    })(),
  );
}

export function listProgram(
  state: V5SerialDeviceState,
): ResultAsync<IProgramInfo[], VexSerialError> {
  return new ResultAsync(
    (async () => {
      const conn = state._instance.connection;
      if (conn == null || !conn.isConnected) {
        return err(new VexNotConnectedError());
      }

      const files = await listFiles(state, FileVendor.USER);
      if (files.isErr()) return err(files.error);

      const programList: IProgramInfo[] = [];
      const iniFiles = files.value.filter((file) =>
        file.filename.endsWith(".ini"),
      );

      for (let i = 0; i < iniFiles.length; i++) {
        const ini = iniFiles[i]!;
        if (ini.size === 0) continue;

        const programName = /(.+?)(\.[^.]*$|$)/.exec(ini.filename)?.[1] ?? "";
        const bin = files.value.find(
          (file) => file.filename === programName + ".bin",
        );
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

        const result2 = await conn.writeDataAsync(
          new GetProgramSlotInfoH2DPacket(FileVendor.USER, program.binfile),
        );
        if (result2 instanceof GetProgramSlotInfoReplyD2HPacket) {
          program.slot = result2.slot;
          program.requestedSlot = result2.requestedSlot;
        }
        programList.push(program);
      }
      return ok(programList);
    })(),
  );
}

export function readFile(
  state: V5SerialDeviceState,
  request: IFileBasicInfo | string,
  downloadTarget = FileDownloadTarget.FILE_TARGET_QSPI,
  progressCallback?: (current: number, total: number) => void,
): ResultAsync<Uint8Array, VexSerialError> {
  return new ResultAsync(
    (async () => {
      const conn = state._instance.connection;
      if (conn == null || !conn.isConnected) {
        return err(new VexNotConnectedError());
      }

      let handle: IFileBasicInfo;

      // If request is a string, then it is a filename
      if (typeof request === "string") {
        handle = { filename: request, vendor: FileVendor.USER };
      } else {
        handle = request;
      }

      return state.withRefreshPaused(() =>
        conn.downloadFileToHost(handle, downloadTarget, progressCallback),
      );
    })(),
  );
}

export function removeFile(
  state: V5SerialDeviceState,
  request: IFileBasicInfo | string,
): ResultAsync<void, VexSerialError> {
  return new ResultAsync(
    (async () => {
      const conn = state._instance.connection;
      if (conn == null || !conn.isConnected) {
        return err(new VexNotConnectedError());
      }

      return state.withRefreshPaused(() => conn.removeFile(request));
    })(),
  );
}

export function removeAllFiles(
  state: V5SerialDeviceState,
): ResultAsync<void, VexSerialError> {
  return new ResultAsync(
    (async () => {
      const conn = state._instance.connection;
      if (conn == null || !conn.isConnected) {
        return err(new VexNotConnectedError());
      }

      return state.withRefreshPaused(() => conn.removeAllFiles());
    })(),
  );
}

export function uploadProgram(
  state: V5SerialDeviceState,
  iniConfig: ProgramIniConfig,
  binFileBuf: Uint8Array,
  coldFileBuf: Uint8Array | undefined,
  progressCallback: (state: string, current: number, total: number) => void,
): ResultAsync<boolean, VexSerialError> {
  return new ResultAsync(
    runUploadProgram(
      state,
      iniConfig,
      binFileBuf,
      coldFileBuf,
      progressCallback,
    ),
  );
}

async function runUploadProgram(
  state: V5SerialDeviceState,
  iniConfig: ProgramIniConfig,
  binFileBuf: Uint8Array,
  coldFileBuf: Uint8Array | undefined,
  progressCallback: (state: string, current: number, total: number) => void,
): Promise<Result<boolean, VexSerialError>> {
  const device = state._instance;
  const conn = device.connection;
  if (conn == null || !conn.isConnected) {
    return err(new VexNotConnectedError());
  }

  let switchedToDownload = false;

  return state.withRefreshPaused(async () => {
    try {
      if (device.isV5Controller) {
        await sleep(250);

        // V5 Controller doesn't appear to be connected to a V5 Brain
        const refreshed = await device.refresh();
        if (refreshed.isErr() || !refreshed.value) {
          return err(new VexProtocolError("device is unavailable"));
        }

        progressCallback("CHANNEL", 0, 1);

        const p1 = await device.radio.changeChannel(RadioChannelType.DOWNLOAD);
        if (p1.isErr()) return err(p1.error);
        switchedToDownload = true;

        await sleep(250);
        const transferred = await sleepUntilAsync(
          async () => (await conn?.getSystemStatus(150))?.isOk() ?? false,
          10000,
          200,
        );
        if (transferred.isErr()) return err(transferred.error);
        if (!transferred.value) {
          return err(new VexProtocolError("channel switch timed out"));
        }

        progressCallback("CHANNEL", 1, 1);
      }

      const p2 = await conn.uploadProgramToDevice(
        iniConfig,
        binFileBuf,
        coldFileBuf,
        progressCallback,
      );
      if (p2.isErr()) return err(p2.error);
      if (!p2.value)
        return err(new VexProtocolError("program upload rejected"));

      if (device.isV5Controller) {
        // Disconnected
        if (!device.brain.isAvailable) {
          return err(new VexProtocolError("brain unavailable after upload"));
        }

        progressCallback("CHANNEL", 0, 1);

        const p3 = await device.radio.changeChannel(RadioChannelType.PIT);
        if (p3.isErr()) return err(p3.error);
        switchedToDownload = false;

        await sleep(250);
        const transferred = await sleepUntilAsync(
          async () => (await conn?.getSystemStatus(150))?.isOk() ?? false,
          10000,
          200,
        );
        if (transferred.isErr()) return err(transferred.error);
        if (!transferred.value) {
          return err(new VexProtocolError("channel switch timed out"));
        }

        progressCallback("CHANNEL", 1, 1);
      }

      return ok(true);
    } finally {
      if (switchedToDownload) {
        await device.radio.changeChannel(RadioChannelType.PIT);
      }
    }
  });
}

export function writeFile(
  state: V5SerialDeviceState,
  request: IFileWriteRequest,
  progressCallback?: (current: number, total: number) => void,
): ResultAsync<boolean, VexSerialError> {
  return new ResultAsync(
    (async () => {
      const conn = state._instance.connection;
      if (conn == null || !conn.isConnected) {
        return err(new VexNotConnectedError());
      }
      return state.withRefreshPaused(() =>
        conn.uploadFileToDevice(request, progressCallback),
      );
    })(),
  );
}

/**
 * @param progressCallback Informs the progress of the download.
 * @returns array of bytes where each pixel is represented by 3 consecutive bytes (rgb).
 * This array's length is 272 width * 480 height * 3 channels = 391680 bytes.
 */
export function captureScreen(
  state: V5SerialDeviceState,
  progressCallback?: (current: number, total: number) => void,
): ResultAsync<Uint8Array, VexSerialError> {
  // pros implementation: https://github.com/purduesigbots/pros-cli/blob/5ee18656faeb48f51d680bab4b53d5b59cc5a7d5/pros/serial/devices/vex/v5_device.py#L578

  return new ResultAsync(
    (async () => {
      const conn = state._instance.connection;
      if (conn == null || !conn.isConnected) {
        return err(new VexNotConnectedError());
      }

      return state.withRefreshPaused(() =>
        conn.captureScreen(progressCallback),
      );
    })(),
  );
}
