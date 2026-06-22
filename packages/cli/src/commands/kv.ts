import type { Sade } from "sade";
import { Table } from "cmd-table";
import chalk from "chalk";
import { connectV5Device } from "../device";

const WELL_KNOWN_KEYS = ["teamnumber", "robotname"] as const;

export default function registerKvCommand(program: Sade) {
  program
    .command("kv", "list well-known system variables on a brain")
    .action(async () => {
      const device = await connectV5Device();

      const table = new Table({ compact: true });
      table.addColumn("key");
      table.addColumn("value");

      for (const key of WELL_KNOWN_KEYS) {
        const value = await device.brain.getValue(key);
        table.addRow([
          key,
          value === undefined || value === "" ? chalk.dim("(unset)") : value,
        ]);
      }

      console.log(table.render());

      await device.dispose();
    });

  program
    .command("kv get <key>", "get the value of a system variable on a brain")
    .action(async (key) => {
      const device = await connectV5Device();
      try {
        const value = await device.brain.getValue(key);
        console.log(value);
      } finally {
        await device.dispose();
      }
    });

  program
    .command("kv set <key> <value>", "set a system variable on a brain")
    .action(async (key, value) => {
      const device = await connectV5Device();
      try {
        const ok = await device.brain.setValue(key, value);
        if (ok) console.log(`set ${key} to ${value}`);
        else console.error(`failed to set ${key} to ${value}`);
      } finally {
        await device.dispose();
      }
    });
}
