import { okAsync } from "neverthrow";
import { DeviceSnapshotRefresher } from "../src/device-snapshot-refresher.js";
import { V5SerialDeviceState } from "../src/device-state.js";

const state = new V5SerialDeviceState({} as never);
const refresher = new DeviceSnapshotRefresher(
  state,
  () => false,
  () => false,
);
const connection = {
  isConnected: true,
  getSystemStatus: () =>
    okAsync({
      cpu0Version: state.brain.cpu0Version,
      cpu1Version: state.brain.cpu1Version,
      systemVersion: state.brain.systemVersion,
      uniqueId: 42,
      sysflags: [0, 0, 0, 0, 0, 0, 0],
    } as never),
  getSystemFlags: () =>
    okAsync({
      flags: 0,
      currentProgram: 0,
      battery: 100,
      controllerBatteryPercent: undefined,
      partnerControllerBatteryPercent: undefined,
    } as never),
  getRadioStatus: () =>
    okAsync({ channel: 0, timeslot: 0, quality: 0, strength: 0 } as never),
  getDeviceStatus: () => okAsync({ devices: [] } as never),
};

await refresher.refresh(connection as never);
const iterations = 10_000;
const startedAt = performance.now();
for (let index = 0; index < iterations; index++) {
  await refresher.refresh(connection as never);
}
console.log(
  `device refresh: ${(iterations / ((performance.now() - startedAt) / 1_000)).toFixed(0)} refreshes/s, ${state.devices.length} smart-device slots`,
);
