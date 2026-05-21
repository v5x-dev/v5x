import { createPlugin } from "@bunli/core/plugin";
import type { BunliPlugin, CommandContext } from "@bunli/core/plugin";
import { V5SerialDevice } from "@v5x/serial";
import { serial } from "../adapter";

export interface V5DeviceStore {
  device: V5SerialDevice | null;
}

const store: V5DeviceStore = {
  device: null,
};

async function connectDevice(): Promise<V5SerialDevice | null> {
  const device = new V5SerialDevice(serial);
  device.autoRefresh = false;

  const connected = await device.connect();
  if (!connected) {
    await device.dispose();
    return null;
  }

  return device;
}

export async function disposeV5Device(): Promise<void> {
  const device = store.device;

  if (!device) {
    return;
  }

  store.device = null;
  await device.dispose();
}

export function getV5Device(
  context: CommandContext<Record<string, unknown>>,
): V5SerialDevice | null {
  const device = context.getStoreValue("device");

  if (device == null) {
    return null;
  }

  if (!(device instanceof V5SerialDevice)) {
    throw new Error("v5 device not found in context");
  }

  return device;
}

export const v5DevicePlugin = createPlugin({
  name: "v5-device",
  version: "1.0.0",

  store,

  async setup() {
    try {
      store.device = await connectDevice();
    } catch (e) {
      console.error((e as any).message);
      return;
    }
  },

  beforeCommand(context: CommandContext<V5DeviceStore>) {
    if (!store.device) {
      throw new Error("v5 device is not connected");
    }

    context.setStoreValue("device", store.device);
  },
} satisfies BunliPlugin<V5DeviceStore>);
