import { V5SerialDevice } from "@v5x/serial";
import { serial } from "./adapter";

export async function connectV5Device(
  device = new V5SerialDevice(serial),
): Promise<V5SerialDevice> {
  device.autoRefresh = false;
  try {
    const connected = await device.connect();
    if (!connected) {
      throw new Error("v5 device not connected");
    }
    return device;
  } catch (error) {
    await device.dispose();
    throw error;
  }
}
