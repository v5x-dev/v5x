import { expect, test } from "bun:test";
import { V5SerialDevice } from "@v5x/serial";
import { connectV5Device } from "./device";

test("disposes a device when connecting fails", async () => {
  let disposed = false;
  const device = {
    autoRefresh: true,
    connect: async () => false,
    dispose: async () => {
      disposed = true;
    },
  } as unknown as V5SerialDevice;

  await expect(connectV5Device(device)).rejects.toThrow(
    "v5 device not connected",
  );
  expect(disposed).toBe(true);
});

test("disposes a device when connecting throws", async () => {
  let disposed = false;
  const device = {
    autoRefresh: true,
    connect: async () => {
      throw new Error("serial failure");
    },
    dispose: async () => {
      disposed = true;
    },
  } as unknown as V5SerialDevice;

  await expect(connectV5Device(device)).rejects.toThrow("serial failure");
  expect(disposed).toBe(true);
});
