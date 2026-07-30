import { describe, expect, test } from "bun:test";
import { createFakeBackend, type FakeBackend } from "./backend.test-support.js";
import { NodeSerial } from "./serial.js";
import type { NodeSerialPort } from "./port.js";

async function openedPort(
  path: string,
): Promise<{ backend: FakeBackend; port: NodeSerialPort }> {
  const backend = createFakeBackend(async () => [{ path }]);
  const serial = new NodeSerial({ backend });
  return { backend, port: (await serial.getPorts())[0] as NodeSerialPort };
}

describe("NodeSerialPort", () => {
  test("models closed, open, errored, and reopened stream states", async () => {
    const { backend, port } = await openedPort("/dev/cu.test");

    expect(port.readable).toBeNull();
    expect(port.writable).toBeNull();
    await port.open({ baudRate: 115200 });
    expect(port.readable).not.toBeNull();
    expect(port.writable).not.toBeNull();

    const nativePort = backend.opened.at(-1)!;
    expect(nativePort.options).toEqual({
      path: "/dev/cu.test",
      baudRate: 115200,
    });

    const reader = port.readable!.getReader();
    nativePort.emit("data", new Uint8Array([1, 2, 3]));
    expect((await reader.read()).value).toEqual(new Uint8Array([1, 2, 3]));
    reader.releaseLock();

    const writer = port.writable!.getWriter();
    await writer.write(new Uint8Array([4, 5]));
    writer.releaseLock();
    expect(nativePort.writes).toEqual([new Uint8Array([4, 5])]);

    await port.close();
    expect(port.readable).toBeNull();
    expect(port.writable).toBeNull();
    await port.open({ baudRate: 115200 });
    expect(port.readable).not.toBeNull();
    await port.close();
  });

  test("rejects a second open on an already open port", async () => {
    const { port } = await openedPort("/dev/cu.reopen");
    await port.open({ baudRate: 115200 });

    await expect(port.open({ baudRate: 115200 })).rejects.toThrow(
      "Port already open",
    );
    await port.close();
  });

  test("rejects concurrent opens before the backend finishes opening", async () => {
    const { backend, port } = await openedPort("/dev/cu.concurrent-open");

    const opening = port.open({ baudRate: 115200 });
    await expect(port.open({ baudRate: 115200 })).rejects.toThrow(
      "Port is opening",
    );
    await opening;

    expect(backend.opened).toHaveLength(1);
    await port.close();
  });

  test("joins concurrent closes and blocks reopening until native close finishes", async () => {
    const { backend, port } = await openedPort("/dev/cu.concurrent-close");
    await port.open({ baudRate: 115200 });
    const nativePort = backend.opened.at(-1)!;
    let finishClose: (() => void) | undefined;
    nativePort.closeGate = new Promise<void>((resolve) => {
      finishClose = resolve;
    });
    const closeError = new Error("native close failed");
    nativePort.closeError = closeError;

    const firstClose = port.close();
    const secondClose = port.close();
    await expect(port.open({ baudRate: 115200 })).rejects.toThrow(
      "Port is closing",
    );

    const captureRejection = async (
      operation: Promise<void>,
    ): Promise<unknown> => {
      try {
        await operation;
        return undefined;
      } catch (error) {
        return error;
      }
    };
    const firstCloseError = captureRejection(firstClose);
    const secondCloseError = captureRejection(secondClose);
    finishClose?.();
    expect(await firstCloseError).toBe(closeError);
    expect(await secondCloseError).toBe(closeError);

    await port.open({ baudRate: 115200 });
    expect(backend.opened).toHaveLength(2);
    await port.close();
  });

  test("native close rejection still clears adapter state", async () => {
    const { backend, port } = await openedPort("/dev/cu.error");
    await port.open({ baudRate: 115200 });
    backend.opened.at(-1)!.closeError = new Error("native close failed");

    await expect(port.close()).rejects.toThrow("native close failed");
    expect(port.readable).toBeNull();
    expect(port.writable).toBeNull();
    await port.open({ baudRate: 115200 });
    await port.close();
  });

  test("invokes the current disconnect property handler and registered listeners once", async () => {
    const { port } = await openedPort("/dev/cu.handlers");
    let replacedHandlerCalls = 0;
    let currentHandlerCalls = 0;
    let listenerCalls = 0;
    port.ondisconnect = () => {
      replacedHandlerCalls++;
    };
    port.ondisconnect = () => {
      currentHandlerCalls++;
    };
    port.addEventListener("disconnect", () => {
      listenerCalls++;
    });

    port.notifyDeviceRemoved();

    expect(replacedHandlerCalls).toBe(0);
    expect(currentHandlerCalls).toBe(1);
    expect(listenerCalls).toBe(1);

    port.ondisconnect = null;
    port.notifyDeviceRemoved();
    expect(currentHandlerCalls).toBe(1);
    expect(listenerCalls).toBe(2);
  });

  test("closing a still-connected port reports no disconnect", async () => {
    const { port } = await openedPort("/dev/cu.close-quiet");
    let disconnects = 0;
    port.addEventListener("disconnect", () => {
      disconnects++;
    });

    await port.open({ baudRate: 115200 });
    await port.close();
    await port.open({ baudRate: 115200 });
    await port.forget();

    expect(disconnects).toBe(0);
    expect(port.readable).toBeNull();
  });

  test("isolates throwing property handlers from listeners and cleanup", async () => {
    const { port } = await openedPort("/dev/cu.throwing-handler");
    let listenerCalls = 0;
    port.ondisconnect = () => {
      throw new Error("consumer handler failed");
    };
    port.addEventListener("disconnect", () => {
      listenerCalls++;
    });

    await port.open({ baudRate: 115200 });
    expect(() => port.notifyDeviceRemoved()).not.toThrow();
    await expect(port.close()).resolves.toBeUndefined();

    expect(listenerCalls).toBe(1);
    expect(port.readable).toBeNull();
    expect(port.writable).toBeNull();
  });

  test("forget closes the port", async () => {
    const { port } = await openedPort("/dev/cu.forget");
    await port.open({ baudRate: 115200 });

    await port.forget();

    expect(port.readable).toBeNull();
    expect(port.writable).toBeNull();
  });

  test("native data and error events are ignored after cancellation", async () => {
    const { backend, port } = await openedPort("/dev/cu.cancel");
    await port.open({ baudRate: 115200 });
    const nativePort = backend.opened.at(-1)!;

    expect(nativePort.listenerCount("data")).toBe(1);
    expect(nativePort.listenerCount("error")).toBe(1);
    await port.readable!.cancel();

    expect(port.readable).toBeNull();
    expect(port.writable).toBeNull();
    expect(nativePort.listenerCount("data")).toBe(0);
    expect(nativePort.listenerCount("error")).toBe(0);

    nativePort.emit("data", new Uint8Array([9]));
    nativePort.emit("error", new Error("late native error"));

    await port.open({ baudRate: 115200 });
    await port.close();
  });

  test("errors the readable stream and closes when the native port errors", async () => {
    const { backend, port } = await openedPort("/dev/cu.native-error");
    await port.open({ baudRate: 115200 });
    const nativePort = backend.opened.at(-1)!;
    const reader = port.readable!.getReader();

    nativePort.emit("error", new Error("native read failed"));

    await expect(reader.read()).rejects.toThrow("native read failed");
    await Bun.sleep(0);
    expect(port.readable).toBeNull();
    expect(port.writable).toBeNull();
  });

  test("detaches native listeners before awaiting close", async () => {
    const { backend, port } = await openedPort("/dev/cu.race");
    await port.open({ baudRate: 115200 });
    const nativePort = backend.opened.at(-1)!;
    let finishClose: (() => void) | undefined;
    nativePort.closeGate = new Promise<void>((resolve) => {
      finishClose = resolve;
    });

    const closing = port.close();
    expect(nativePort.listenerCount("data")).toBe(0);
    expect(nativePort.listenerCount("error")).toBe(0);
    expect(() => nativePort.emit("data", new Uint8Array([9]))).not.toThrow();
    expect(() =>
      nativePort.emit("error", new Error("late error")),
    ).not.toThrow();

    finishClose?.();
    await closing;
  });

  test("pauses native reads while the readable stream is backpressured", async () => {
    const { backend, port } = await openedPort("/dev/cu.backpressure");
    await port.open({ baudRate: 115200 });
    const nativePort = backend.opened.at(-1)!;
    const reader = port.readable!.getReader();

    nativePort.emit("data", new Uint8Array([1]));
    expect(nativePort.pauses).toBe(1);
    expect((await reader.read()).value).toEqual(new Uint8Array([1]));
    await Bun.sleep(0);
    expect(nativePort.resumes).toBe(1);

    reader.releaseLock();
    await port.close();
  });

  test("fails closed on overflow when native reads cannot be paused", async () => {
    const { backend, port } = await openedPort("/dev/cu.bounded");
    await port.open({ baudRate: 115200 });
    const nativePort = backend.opened.at(-1)!;
    nativePort.pause = undefined;
    nativePort.resume = undefined;
    const reader = port.readable!.getReader();

    nativePort.emit("data", new Uint8Array([1]));
    nativePort.emit("data", new Uint8Array([2]));

    await expect(reader.read()).rejects.toThrow("readable-stream capacity");
    await Bun.sleep(0);
    expect(port.readable).toBeNull();
    expect(port.writable).toBeNull();
    expect(nativePort.listenerCount("data")).toBe(0);
  });

  test("does not pause forever when a backend omits resume", async () => {
    const { backend, port } = await openedPort("/dev/cu.incomplete-pause");
    await port.open({ baudRate: 115200 });
    const nativePort = backend.opened.at(-1)!;
    nativePort.resume = undefined;
    const reader = port.readable!.getReader();

    nativePort.emit("data", new Uint8Array([1]));
    expect(nativePort.pauses).toBe(0);
    nativePort.emit("data", new Uint8Array([2]));

    await expect(reader.read()).rejects.toThrow("readable-stream capacity");
    await Bun.sleep(0);
    expect(port.readable).toBeNull();
  });
});
