type SerialEventHandler = ((event: Event) => void) | null;

/**
 * Wires the `onconnect`/`ondisconnect` handler properties Web Serial exposes to
 * the underlying events, so that assigning one actually subscribes.
 */
export class SerialEventTarget extends EventTarget {
  private connectHandler: SerialEventHandler = null;
  private disconnectHandler: SerialEventHandler = null;

  constructor() {
    super();
    this.addEventListener("connect", (event) =>
      this.invokeHandler(this.connectHandler, event),
    );
    this.addEventListener("disconnect", (event) =>
      this.invokeHandler(this.disconnectHandler, event),
    );
  }

  get onconnect(): SerialEventHandler {
    return this.connectHandler;
  }

  set onconnect(handler: SerialEventHandler) {
    this.connectHandler = handler;
  }

  get ondisconnect(): SerialEventHandler {
    return this.disconnectHandler;
  }

  set ondisconnect(handler: SerialEventHandler) {
    this.disconnectHandler = handler;
  }

  private invokeHandler(handler: SerialEventHandler, event: Event): void {
    try {
      handler?.call(this, event);
    } catch {
      // Consumer callbacks cannot interrupt other listeners or cleanup.
    }
  }
}
