export function getDefaultSerial(): Serial | undefined {
  if (typeof navigator === "undefined") return undefined;
  return navigator.serial;
}

export function isWebSerialSupported(serial?: Serial): boolean {
  return (serial ?? getDefaultSerial()) !== undefined;
}

export function getWebSerialUnavailableReason(serial?: Serial): string | null {
  return isWebSerialSupported(serial) ? null : "web-serial-unavailable";
}
