import { V5SerialDevice } from "@v5x/serial";
import { serial } from "./adapter";

export async function connectV5Device(
  device = new V5SerialDevice(serial),
): Promise<V5SerialDevice> {
  device.autoRefresh = false;
  try {
    const result = await device.connect();
    if (result.isErr()) {
      throw new Error(
        `v5 device not connected: ${result.error.message ?? result.error.kind}`,
      );
    }
    return device;
  } catch (error) {
    await device.dispose();
    throw error;
  }
}

export async function withV5Device<Result>(
  operation: (device: V5SerialDevice) => Promise<Result>,
  device = new V5SerialDevice(serial),
): Promise<Result> {
  const connectedDevice = await connectV5Device(device);
  try {
    return await operation(connectedDevice);
  } finally {
    await connectedDevice.dispose();
  }
}
