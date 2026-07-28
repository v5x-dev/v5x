import { type ISmartDeviceInfo, SmartDeviceType } from "../vex.js";
import type { V5SerialDeviceState } from "../device-state.js";

export class V5SmartDevice {
  private readonly state: V5SerialDeviceState;
  private readonly deviceIndex: number;

  constructor(state: V5SerialDeviceState, index: number) {
    this.state = state;
    this.deviceIndex = index;
  }

  protected getDeviceInfo(): ISmartDeviceInfo | undefined {
    return this.state.devices[this.deviceIndex];
  }

  get isAvailable(): boolean {
    return this.getDeviceInfo() !== undefined;
  }

  get port(): number {
    return this.deviceIndex;
  }

  get type(): SmartDeviceType {
    return this.getDeviceInfo()?.type ?? SmartDeviceType.EMPTY;
  }

  get version(): number {
    return this.getDeviceInfo()?.version ?? 0;
  }
}
