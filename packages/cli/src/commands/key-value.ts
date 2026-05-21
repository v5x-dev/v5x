import { defineCommand, defineGroup } from "@bunli/core";
import { getV5Device } from "../plugins/device";

const kvGetCommand = defineCommand({
  name: "get",
  description: "get the value of a system variable on a brain",
  handler: async ({ positional, context }) => {
    if (!context) return;
    const [key] = positional;

    const device = getV5Device(context);
    if (!device) return;

    const value = await device.brain.getValue(key);
    console.log(value);
  },
});

const kvSetCommand = defineCommand({
  name: "set",
  description: "set a system variable on a brain",
  handler: async ({ positional, context, colors }) => {
    if (!context) return;
    const device = getV5Device(context);
    if (!device) return;

    const [key, value] = positional;

    const ok = await device.brain.setValue(key, value);
    if (!ok) {
      console.log(colors.red(`failed to set ${key} to ${value}`));
    } else {
      console.log(`set ${key} to ${value}`);
    }
  },
});

export default defineGroup({
  name: "kv",
  description: "access a brain's system key/value configuration",
  commands: [kvGetCommand, kvSetCommand],
});
