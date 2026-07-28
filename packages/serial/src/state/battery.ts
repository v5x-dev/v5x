import type { V5SerialDeviceState } from "../device-state.js";

export class V5Battery {
  private readonly state: V5SerialDeviceState;

  constructor(state: V5SerialDeviceState) {
    this.state = state;
  }

  get batteryPercent(): number {
    return this.state.brain.battery.batteryPercent;
  }

  get isCharging(): boolean {
    return this.state.brain.battery.isCharging;
  }
}
