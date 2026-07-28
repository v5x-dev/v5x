/** Internal signal that the serial reader closed normally. */
export class ReaderClosedError extends Error {
  constructor() {
    super("Serial reader closed");
    this.name = "ReaderClosedError";
  }
}
