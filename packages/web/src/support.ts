export type WebSerialUnavailableReason =
  | "non-browser-runtime"
  | "insecure-context"
  | "unsupported-browser"
  | "web-serial-unavailable";

export function getDefaultSerial(): Serial | undefined {
  return typeof navigator === "undefined" ? undefined : navigator.serial;
}

export function isWebSerialSupported(serial?: Serial): boolean {
  return (serial ?? getDefaultSerial()) !== undefined;
}

export function getWebSerialUnavailableReason(
  serial?: Serial,
): WebSerialUnavailableReason | null {
  if (isWebSerialSupported(serial)) return null;
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return "non-browser-runtime";
  }
  if (window.isSecureContext === false) return "insecure-context";
  if (isKnownUnsupportedBrowser(navigator)) return "unsupported-browser";
  return "web-serial-unavailable";
}

function isKnownUnsupportedBrowser(navigator: Navigator): boolean {
  const userAgent = navigator.userAgent.toLowerCase();
  const firefox = userAgent.includes("firefox") || userAgent.includes("fxios");
  const safari =
    userAgent.includes("safari") &&
    !userAgent.includes("chrome") &&
    !userAgent.includes("chromium") &&
    !userAgent.includes("crios") &&
    !userAgent.includes("edg") &&
    !userAgent.includes("opr") &&
    !userAgent.includes("android");

  return firefox || safari;
}
