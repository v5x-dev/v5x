#!/usr/bin/env bun

import packageJson from "../package.json";
import pc from "picocolors";
import { serial } from "./adapter";
import { V5SerialDevice } from "@v5x/serial";

const brand = (str: string) => `\x1b[0;38;2;129;140;248;49m${str}\x1b[0m`;

console.log(brand(`v5x ${packageJson.version}`));
console.log("modern cli for v5 development");

async function main() {
  const device = new V5SerialDevice(serial);

  try {
    await device.connect();

    if (device.isConnected) {
      console.log("os:", device.brain.systemVersion.toUserString());
      console.log("name:", await device.brain.getValue("robotname"));
      console.log("team:", await device.brain.getValue("teamnumber"));
      console.log("id:", device.brain.uniqueId.toString());
    }
  } catch {
    console.warn(pc.yellow("v5 device not found"));
  } finally {
    await device.disconnect();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
