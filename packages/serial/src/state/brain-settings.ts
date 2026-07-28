import type { V5SerialDeviceState } from "../device-state.js";

export class V5BrainSettings {
  private readonly state: V5SerialDeviceState;

  constructor(state: V5SerialDeviceState) {
    this.state = state;
  }

  get isScreenReversed(): boolean {
    return this.state.brain.settings.isScreenReversed;
  }

  get isWhiteTheme(): boolean {
    return this.state.brain.settings.isWhiteTheme;
  }

  get usingLanguage(): number {
    return this.state.brain.settings.usingLanguage;
  }
}
