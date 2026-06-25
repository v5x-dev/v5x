/**
 * Typed error hierarchy for the serial protocol package.
 *
 * Every public async API that can fail returns a {@link Result} (or
 * {@link ResultAsync}) whose error channel is a {@link VexSerialError}.
 * Each error carries a stable {@link VexSerialError.kind} discriminator
 * so callers can branch on the failure category without parsing messages.
 */
export type VexSerialErrorKind =
  | "not-connected"
  | "invalid-argument"
  | "protocol"
  | "transfer"
  | "download"
  | "firmware"
  | "io";

/** Base class for every failure surfaced by the serial package. */
export class VexSerialError extends Error {
  readonly kind: VexSerialErrorKind;

  constructor(kind: VexSerialErrorKind, message: string) {
    super(message);
    this.name = "VexSerialError";
    this.kind = kind;
  }
}

/** No connection is currently open to a device. */
export class VexNotConnectedError extends VexSerialError {
  constructor(message = "no connection to a V5 device") {
    super("not-connected", message);
    this.name = "VexNotConnectedError";
  }
}

/** A caller supplied an invalid argument value. */
export class VexInvalidArgumentError extends VexSerialError {
  constructor(message: string) {
    super("invalid-argument", message);
    this.name = "VexInvalidArgumentError";
  }
}

/** The device refused, timed out, or replied unexpectedly to a command. */
export class VexProtocolError extends VexSerialError {
  constructor(message: string) {
    super("protocol", message);
    this.name = "VexProtocolError";
  }
}

/** A file-transfer handshake, read, write, or exit failed. */
export class VexTransferError extends VexSerialError {
  constructor(message: string) {
    super("transfer", message);
    this.name = "VexTransferError";
  }
}

/** A remote resource download (catalog/VEXos) failed. */
export class VexDownloadError extends VexSerialError {
  constructor(message: string) {
    super("download", message);
    this.name = "VexDownloadError";
  }
}

/** A firmware archive was malformed, oversized, or incomplete. */
export class VexFirmwareError extends VexSerialError {
  constructor(message: string) {
    super("firmware", message);
    this.name = "VexFirmwareError";
  }
}

/** An underlying transport (serial port, stream) error. */
export class VexIoError extends VexSerialError {
  constructor(message: string) {
    super("io", message);
    this.name = "VexIoError";
  }
}

/**
 * Coerce an arbitrary thrown value into a {@link VexSerialError} so it
 * can be returned through the {@link Result} error channel.
 */
export function toVexSerialError(
  error: unknown,
  fallback: VexSerialErrorKind = "io",
): VexSerialError {
  if (error instanceof VexSerialError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new VexSerialError(fallback, message);
}