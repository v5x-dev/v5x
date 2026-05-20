import { Command } from "commander";
import { V5SerialDevice } from "@v5x/serial";
import { serial } from "../adapter";
import pc from "picocolors";

export const kv = new Command("kv").description(
  "interact with the v5 brain key-value store",
);

kv.command("get")
  .description("read a value from the KV store")
  .argument("<key>", "kv key")
  .action(async (key) => {
    const device = new V5SerialDevice(serial);
    device.autoReconnect = false;
    device.autoRefresh = false;

    try {
      await device.connect();
      const value = await device.brain.getValue(key);

      console.log(value);
    } catch (e: any) {
      if (e.message === "No valid port selected.")
        console.log(pc.redBright("no valid device found"));
    } finally {
      await device.dispose();
    }
  });

kv.command("set")
  .description("write a value to the KV store")
  .argument("<key>", "kv key")
  .argument("<value>", "value")
  .action(async (key, value) => {
    const device = new V5SerialDevice(serial);
    device.autoReconnect = false;
    device.autoRefresh = false;

    try {
      await device.connect();
      const ok = await device.brain.setValue(key, value);

      if (ok) console.log(`set ${key} to ${value}`);
      else console.log(`failed to set ${key} to ${value}`);
    } catch (e: any) {
      console.log(e.message);
      if (e.message === "No valid port selected.")
        console.log(pc.redBright("no valid device found"));
    } finally {
      await device.dispose();
    }
  });
