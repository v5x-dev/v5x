import type { V5SerialDeviceState } from "../device-state.js";

export class V5Controller {
  private readonly state: V5SerialDeviceState;
  private readonly controllerIndex: number;

  constructor(state: V5SerialDeviceState, controllerIndex: number) {
    this.state = state;
    this.controllerIndex = controllerIndex;
  }

  get batteryPercent(): number {
    return this.state.controllers[this.controllerIndex]!.battery;
  }

  get isMasterController(): boolean {
    return this.controllerIndex === 0;
  }

  get isAvailable(): boolean {
    return this.state.controllers[this.controllerIndex]!.isAvailable;
  }

  /**
   * Whether the controller is charging. The V5 system-status response only
   * reports this state for the primary controller, so the partner controller
   * returns `undefined`.
   */
  get isCharging(): boolean | undefined {
    return this.state.controllers[this.controllerIndex]!.isCharging;
  }
}
