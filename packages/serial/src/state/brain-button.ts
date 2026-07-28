import type { V5SerialDeviceState } from "../device-state.js";

export class V5BrainButton {
  private readonly state: V5SerialDeviceState;

  constructor(state: V5SerialDeviceState) {
    this.state = state;
  }

  get isPressed(): boolean {
    return this.state.brain.button.isPressed;
  }

  get isDoublePressed(): boolean {
    return this.state.brain.button.isDoublePressed;
  }
}
