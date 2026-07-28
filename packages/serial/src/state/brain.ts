import {
  FileDownloadTarget,
  FileVendor,
  type IFileBasicInfo,
  type IFileHandle,
  type IFileWriteRequest,
  type IProgramInfo,
  type SlotNumber,
} from "../vex.js";
import type { V5SerialDeviceState } from "../device-state.js";
import type { ProgramIniConfig } from "../ini-config.js";
import { VexFirmwareVersion } from "../firmware-version.js";
import { VexNotConnectedError, VexSerialError } from "../error.js";
import { err, ok, ResultAsync } from "neverthrow";
import * as firmware from "../firmware.js";
import * as transfers from "../transfers.js";
import { V5Battery } from "./battery.js";
import { V5BrainButton } from "./brain-button.js";
import { V5BrainSettings } from "./brain-settings.js";

export class V5Brain {
  private readonly state: V5SerialDeviceState;
  private readonly batteryFacade: V5Battery;
  private readonly buttonFacade: V5BrainButton;
  private readonly settingsFacade: V5BrainSettings;

  constructor(state: V5SerialDeviceState) {
    this.state = state;
    this.batteryFacade = new V5Battery(state);
    this.buttonFacade = new V5BrainButton(state);
    this.settingsFacade = new V5BrainSettings(state);
  }

  get isRunningProgram(): boolean {
    return this.activeProgram !== 0;
  }

  get activeProgram(): number {
    return this.state.brain.activeProgram;
  }

  /**
   * @deprecated Setting this property dispatches a fire-and-forget
   * request that cannot be awaited. Use {@link setActiveProgram}
   * instead, which returns a {@link ResultAsync} that resolves to an
   * error result when the device refuses or is disconnected.
   */
  set activeProgram(value) {
    void this.setActiveProgram(value as SlotNumber | 0).mapErr(() => {
      // Preserve the legacy fire-and-forget contract; callers who
      // need rejection handling should migrate to setActiveProgram().
    });
  }

  /**
   * Load a program slot on the brain, or stop the currently running
   * program when called with `0`. Resolves to an error result when the
   * device refuses, the request times out, or no connection is open.
   */
  setActiveProgram(value: SlotNumber | 0): ResultAsync<void, VexSerialError> {
    return new ResultAsync(
      (async () => {
        if (this.state.brain.activeProgram === value) return ok(undefined);

        const conn = this.state._instance.connection;
        if (conn == null) return err(new VexNotConnectedError());

        const result =
          value === 0
            ? await conn.stopProgram()
            : await conn.loadProgram(value);
        if (result.isErr()) return err(result.error);

        this.state.brain.activeProgram = value;
        return ok(undefined);
      })(),
    );
  }

  /**
   * Request that the brain start running the program in the given slot.
   * Resolves to an error result when the device refuses, the request
   * times out, or no connection is open.
   */
  runProgram(slot: SlotNumber | string): ResultAsync<void, VexSerialError> {
    return new ResultAsync(
      (async () => {
        const conn = this.state._instance.connection;
        if (conn == null) return err(new VexNotConnectedError());

        const reply = await conn.runProgram(slot);
        if (reply.isErr()) return err(reply.error);

        if (typeof slot === "number") this.state.brain.activeProgram = slot;
        return ok(undefined);
      })(),
    );
  }

  /**
   * Request that the brain stop the currently running program. Resolves
   * to an error result when the device refuses, the request times out,
   * or no connection is open.
   */
  stopProgram(): ResultAsync<void, VexSerialError> {
    return new ResultAsync(
      (async () => {
        const conn = this.state._instance.connection;
        if (conn == null) return err(new VexNotConnectedError());

        const reply = await conn.stopProgram();
        if (reply.isErr()) return err(reply.error);

        this.state.brain.activeProgram = 0;
        return ok(undefined);
      })(),
    );
  }

  get battery(): V5Battery {
    return this.batteryFacade;
  }

  get button(): V5BrainButton {
    return this.buttonFacade;
  }

  get cpu0Version(): VexFirmwareVersion {
    return this.state.brain.cpu0Version;
  }

  get cpu1Version(): VexFirmwareVersion {
    return this.state.brain.cpu1Version;
  }

  get isAvailable(): boolean {
    return this.state.brain.isAvailable;
  }

  get settings(): V5BrainSettings {
    return this.settingsFacade;
  }

  get systemVersion(): VexFirmwareVersion {
    return this.state.brain.systemVersion;
  }

  get uniqueId(): number {
    return this.state.brain.uniqueId;
  }

  getValue(key: string): ResultAsync<string | undefined, VexSerialError> {
    return transfers.getValue(this.state, key);
  }

  setValue(key: string, value: string): ResultAsync<void, VexSerialError> {
    return transfers.setValue(this.state, key, value);
  }

  listFiles(
    vendor = FileVendor.USER,
  ): ResultAsync<IFileHandle[], VexSerialError> {
    return transfers.listFiles(this.state, vendor);
  }

  listProgram(): ResultAsync<IProgramInfo[], VexSerialError> {
    return transfers.listProgram(this.state);
  }

  readFile(
    request: IFileBasicInfo | string,
    downloadTarget = FileDownloadTarget.FILE_TARGET_QSPI,
    progressCallback?: (current: number, total: number) => void,
  ): ResultAsync<Uint8Array, VexSerialError> {
    return transfers.readFile(
      this.state,
      request,
      downloadTarget,
      progressCallback,
    );
  }

  removeFile(
    request: IFileBasicInfo | string,
  ): ResultAsync<void, VexSerialError> {
    return transfers.removeFile(this.state, request);
  }

  removeAllFiles(): ResultAsync<void, VexSerialError> {
    return transfers.removeAllFiles(this.state);
  }

  uploadFirmware(
    publicUrl = "https://content.vexrobotics.com/vexos/public/V5/",
    usingVersion?: string,
    progressCallback?: (state: string, current: number, total: number) => void,
  ): ResultAsync<boolean, VexSerialError> {
    return firmware.uploadFirmware(
      this.state,
      publicUrl,
      usingVersion,
      progressCallback,
    );
  }

  uploadProgram(
    iniConfig: ProgramIniConfig,
    binFileBuf: Uint8Array,
    coldFileBuf: Uint8Array | undefined,
    progressCallback: (state: string, current: number, total: number) => void,
  ): ResultAsync<boolean, VexSerialError> {
    return transfers.uploadProgram(
      this.state,
      iniConfig,
      binFileBuf,
      coldFileBuf,
      progressCallback,
    );
  }

  writeFile(
    request: IFileWriteRequest,
    progressCallback?: (current: number, total: number) => void,
  ): ResultAsync<boolean, VexSerialError> {
    return transfers.writeFile(this.state, request, progressCallback);
  }

  /**
   *
   * @param progressCallback Informs the progress of the download.
   * @returns array of bytes where each pixel is represented by 3 consecutive bytes (rgb).
   * This array's length is 272 width * 480 height * 3 channels = 391680 bytes.
   */
  captureScreen(
    progressCallback?: (current: number, total: number) => void,
  ): ResultAsync<Uint8Array, VexSerialError> {
    return transfers.captureScreen(this.state, progressCallback);
  }
}
