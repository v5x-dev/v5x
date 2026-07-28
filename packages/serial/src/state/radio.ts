import { RadioChannelType } from "../vex.js";
import type { V5SerialDeviceState } from "../device-state.js";
import { VexNotConnectedError, VexSerialError } from "../error.js";
import { err, ResultAsync } from "neverthrow";
import {
  FileControlH2DPacket,
  FileControlReplyD2HPacket,
} from "../packet-models.js";

export class V5Radio {
  private readonly state: V5SerialDeviceState;

  constructor(state: V5SerialDeviceState) {
    this.state = state;
  }

  get channel(): number {
    return this.state.radio.channel;
  }

  get isAvailable(): boolean {
    return this.state.radio.isAvailable;
  }

  get isConnected(): boolean {
    return this.state.radio.isConnected;
  }

  get isVexNet(): boolean {
    return this.state.radio.isVexNet;
  }

  get isRadioData(): boolean {
    return this.state.radio.isRadioData;
  }

  get latency(): number {
    return this.state.radio.latency;
  }

  changeChannel(channel: RadioChannelType): ResultAsync<void, VexSerialError> {
    return new ResultAsync(
      (async () => {
        const conn = this.state._instance.connection;
        if (conn == null || !conn.isConnected) {
          return err(new VexNotConnectedError());
        }

        return conn
          .request(
            new FileControlH2DPacket(1, channel),
            FileControlReplyD2HPacket,
          )
          .map(() => undefined);
      })(),
    );
  }
}
