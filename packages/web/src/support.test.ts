import { afterEach, describe, expect, test } from "bun:test";
import {
  getWebSerialUnavailableReason,
  isWebSerialSupported,
} from "./support.js";

class FakeSerial extends EventTarget implements Serial {
  onconnect: (event: Event) => void = () => {};
  ondisconnect: (event: Event) => void = () => {};

  async getPorts(): Promise<SerialPort[]> {
    return [];
  }

  async requestPort(): Promise<SerialPort> {
    throw new Error("not implemented");
  }
}

const originalNavigator = Object.getOwnPropertyDescriptor(
  globalThis,
  "navigator",
);
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

afterEach(() => {
  restoreGlobal("navigator", originalNavigator);
  restoreGlobal("window", originalWindow);
});

describe("Web Serial support", () => {
  test("reports non-browser runtime when navigator and window are undefined", () => {
    setGlobal("navigator", undefined);
    setGlobal("window", undefined);

    expect(isWebSerialSupported()).toBe(false);
    expect(getWebSerialUnavailableReason()).toBe("non-browser-runtime");
  });

  test("reports insecure context before missing serial implementation", () => {
    setGlobal("navigator", createNavigator("Chrome/120.0.0.0 Safari/537.36"));
    setGlobal("window", { isSecureContext: false });

    expect(isWebSerialSupported()).toBe(false);
    expect(getWebSerialUnavailableReason()).toBe("insecure-context");
  });

  test("reports unsupported browser for known browsers without navigator.serial", () => {
    setGlobal("navigator", createNavigator("Firefox/124.0"));
    setGlobal("window", { isSecureContext: true });

    expect(isWebSerialSupported()).toBe(false);
    expect(getWebSerialUnavailableReason()).toBe("unsupported-browser");
  });

  test("keeps the stable fallback for missing serial implementation", () => {
    setGlobal("navigator", createNavigator("Chrome/120.0.0.0 Safari/537.36"));
    setGlobal("window", { isSecureContext: true });

    expect(isWebSerialSupported()).toBe(false);
    expect(getWebSerialUnavailableReason()).toBe("web-serial-unavailable");
  });

  test("reports supported when a serial object exists", () => {
    const serial = new FakeSerial();
    setGlobal("navigator", { ...createNavigator("Firefox/124.0"), serial });
    setGlobal("window", { isSecureContext: false });

    expect(isWebSerialSupported()).toBe(true);
    expect(getWebSerialUnavailableReason()).toBeNull();
  });
});

function createNavigator(userAgent: string): Partial<Navigator> {
  return { userAgent };
}

function setGlobal(key: "navigator" | "window", value: unknown): void {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
    writable: true,
  });
}

function restoreGlobal(
  key: "navigator" | "window",
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor === undefined) {
    delete globalThis[key];
    return;
  }

  Object.defineProperty(globalThis, key, descriptor);
}
