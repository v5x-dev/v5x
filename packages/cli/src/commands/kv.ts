import type { Sade } from "sade";
import { Table } from "cmd-table";
import chalk from "chalk";
import { withV5Device } from "../device";

const WELL_KNOWN_KEYS = ["teamnumber", "robotname"] as const;

export default function registerKvCommand(program: Sade) {
  program
    .command("kv", "list well-known system variables on a brain")
    .action(async () => {
      await withV5Device(async (device) => {
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
      });
    });

  program
    .command("kv get <key>", "get the value of a system variable on a brain")
    .action(async (key) => {
      await withV5Device(async (device) => {
        const value = await device.brain.getValue(key);
        console.log(value);
      });
    });

  program
    .command("kv set <key> <value>", "set a system variable on a brain")
    .action(async (key, value) => {
      await withV5Device(async (device) => {
        const ok = await device.brain.setValue(key, value);
        if (!ok) throw new Error(`failed to set ${key} to ${value}`);
        console.log(`set ${key} to ${value}`);
      });
    });
}
