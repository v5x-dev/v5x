import { V5SerialDevice } from "@v5x/serial";
import { serial } from "./adapter";

export async function connectV5Device(): Promise<V5SerialDevice> {
  const device = new V5SerialDevice(serial);
  device.autoRefresh = false;
  const connected = await device.connect();
  if (!connected) {
    throw new Error("v5 device not connected");
  }

  return device;
}
