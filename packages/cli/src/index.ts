#!/usr/bin/env bun

import { SystemVersionPacket, type Version } from "@v5x/cdc";
import {
  BunSerialPortAdapter,
  connectSerialDevice,
  findSerialDevices,
} from "@v5x/serial";
import packageJson from "../package.json";
import pc from "picocolors";

console.log(pc.redBright(`v5x ${packageJson.version}`));

const adapter = new BunSerialPortAdapter();

try {
  const devices = await findSerialDevices(adapter);
  const device = devices[0];

  if (!device) {
    console.error(pc.red("No VEX brain found over serial."));
    process.exit(1);
  }

  const connection = await connectSerialDevice(adapter, device);
  try {
    const reply = await connection.handshake(
      new SystemVersionPacket(),
      1000,
      2,
    );
    console.log(`brain systemVersion ${formatVersion(reply.version)}`);
  } finally {
    await connection.close();
  }
} catch (error) {
  console.error(pc.red(error instanceof Error ? error.message : String(error)));
  process.exit(1);
}

function formatVersion(version: Version): string {
  const suffix = version.beta === 0 ? "" : ` beta ${version.beta}`;
  return `${version.major}.${version.minor}.${version.build}${suffix}`;
}
