import { afterEach, expect, test } from "bun:test";
import { SmartDeviceType } from "./Vex";
import { V5SerialConnection } from "./VexConnection";
import { V5SerialDevice } from "./VexDevice";
import { FileControlReplyD2HPacket } from "./VexPacketModels";
import { protocolReply } from "./protocol.test-support";

const serial = { getPorts: async () => [] } as unknown as Serial;
const devices: V5SerialDevice[] = [];

afterEach(async () => {
  await Promise.all(devices.splice(0).map((device) => device.dispose()));
});

test("public state views expose one coherent device snapshot", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  device.state.brain.activeProgram = 2;
  device.state.brain.battery = { batteryPercent: 75, isCharging: true };
  device.state.brain.button = { isPressed: true, isDoublePressed: false };
  device.state.controllers[0] = {
    battery: 80,
    isAvailable: true,
    isCharging: true,
  };
  device.state.devices[1] = {
    port: 1,
    type: SmartDeviceType.MOTOR,
    status: 0,
    betaversion: 0,
    version: 7,
    bootversion: 0,
  };
  device.state.radio = {
    channel: 3,
    isAvailable: true,
    isConnected: true,
    isVexNet: true,
    isRadioData: false,
    latency: 4,
    signalQuality: 90,
    signalStrength: -30,
  };
  device.connection = {
    isConnected: true,
    writeDataAsync: async () => protocolReply(FileControlReplyD2HPacket),
    close: async () => {},
  } as unknown as V5SerialConnection;

  expect(device.brain.isRunningProgram).toBe(true);
  expect(device.brain.battery.batteryPercent).toBe(75);
  expect(device.brain.battery.isCharging).toBe(true);
  expect(device.brain.button.isPressed).toBe(true);
  expect(device.brain.button.isDoublePressed).toBe(false);
  expect(device.controllers[0].batteryPercent).toBe(80);
  expect(device.controllers[0].isMasterController).toBe(true);
  expect(device.controllers[0].isAvailable).toBe(true);
  expect(device.controllers[0].isCharging).toBe(true);
  expect(device.devices[0]?.port).toBe(1);
  expect(device.devices[0]?.type).toBe(SmartDeviceType.MOTOR);
  expect(device.devices[0]?.version).toBe(7);
  expect(device.radio.channel).toBe(3);
  expect(device.radio.isAvailable).toBe(true);
  expect(device.radio.isConnected).toBe(true);
  expect(device.radio.isVexNet).toBe(true);
  expect(device.radio.isRadioData).toBe(false);
  expect(device.radio.latency).toBe(4);
  expect((await device.radio.changeChannel(1)).isOk()).toBe(true);
});

test("public state view facades are cached", () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  device.state.devices[1] = {
    port: 1,
    type: SmartDeviceType.MOTOR,
    status: 0,
    betaversion: 0,
    version: 7,
    bootversion: 0,
  };

  expect(device.brain).toBe(device.brain);
  expect(device.brain.battery).toBe(device.brain.battery);
  expect(device.brain.button).toBe(device.brain.button);
  expect(device.brain.settings).toBe(device.brain.settings);
  expect(device.controllers[0]).toBe(device.controllers[0]);
  expect(device.controllers[1]).toBe(device.controllers[1]);
  expect(device.radio).toBe(device.radio);
  expect(device.devices[0]).toBe(device.devices[0]);
});

test("state refresh pause helper exposes refresh semantics", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);

  expect(device.state.isRefreshPaused).toBe(false);
  await device.state.withRefreshPaused(async () => {
    expect(device.state.isRefreshPaused).toBe(true);
    expect(device.state.isFileTransferring).toBe(true);
  });
  expect(device.state.isRefreshPaused).toBe(false);
});
