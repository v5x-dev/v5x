import type { SerialPort } from "./types.js";

/**
 * The Serial-level event dispatched when a device physically arrives or goes
 * away, carrying the port it happened to.
 *
 * Web Serial calls this `SerialConnectionEvent`; see
 * https://wicg.github.io/serial/#serialconnectionevent-interface. `port` is
 * optional here because discovery can observe a path disappear before any
 * caller enumerated it into a port object.
 */
export class SerialConnectionEvent extends Event {
  readonly port: SerialPort | undefined;

  constructor(type: string, port: SerialPort | undefined) {
    super(type);
    this.port = port;
  }
}
