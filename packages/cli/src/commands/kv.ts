import type { Sade } from "sade";
import { connectV5Device } from "../device";

export default function registerKvCommand(program: Sade) {
  program
    .command("kv", "access a brain's system key/value configuration")
    .action(() => {});

  program
    .command("kv get <key>", "get the value of a system variable on a brain")
    .action(async (key) => {
      const device = await connectV5Device();

      const value = await device.brain.getValue(key);
      console.log(value);

      await device.dispose();
    });

  program
    .command("kv set <key> <value>", "set a system variable on a brain")
    .action(async (key, value) => {
      const device = await connectV5Device();

      const ok = await device.brain.setValue(key, value);
      if (ok) console.log(`set ${key} to ${value}`);
      else console.error(`failed to set ${key} to ${value}`);

      await device.dispose();
    });
}
