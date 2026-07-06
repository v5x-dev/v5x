import type { Sade } from "sade";
import { Table } from "cmd-table";
import chalk from "chalk";
import { withV5Device } from "../device";

const WELL_KNOWN_KEYS = ["teamnumber", "robotname"] as const;

export function toKvJson(
  values: Array<{ key: string; value: string | undefined }>,
) {
  return values.map(({ key, value }) => ({
    key,
    value: value ?? null,
  }));
}

export default function registerKvCommand(program: Sade) {
  program
    .command("kv", "list well-known system variables on a brain")
    .option("--json", "print machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      await withV5Device(async (device) => {
        const rows: Array<{ key: string; value: string | undefined }> = [];
        const table = new Table({ compact: true });
        table.addColumn("key");
        table.addColumn("value");

        for (const key of WELL_KNOWN_KEYS) {
          const result = await device.brain.getValue(key);
          const value = result.isOk() ? result.value : undefined;
          rows.push({ key, value });
          table.addRow([
            key,
            value === undefined || value === "" ? chalk.dim("(unset)") : value,
          ]);
        }

        if (options.json === true) {
          console.log(JSON.stringify(toKvJson(rows), null, 2));
          return;
        }

        console.log(table.render());
      });
    });

  program
    .command("kv get <key>", "get the value of a system variable on a brain")
    .option("--json", "print machine-readable JSON")
    .action(async (key: string, options: { json?: boolean }) => {
      await withV5Device(async (device) => {
        const result = await device.brain.getValue(key);
        const value = result.isOk() ? result.value : undefined;
        if (options.json === true) {
          console.log(JSON.stringify({ key, value: value ?? null }, null, 2));
          return;
        }

        console.log(value);
      });
    });

  program
    .command("kv set <key> <value>", "set a system variable on a brain")
    .action(async (key, value) => {
      await withV5Device(async (device) => {
        const result = await device.brain.setValue(key, value);
        if (result.isErr()) throw new Error(`failed to set ${key} to ${value}`);
        console.log(`set ${key} to ${value}`);
      });
    });
}
