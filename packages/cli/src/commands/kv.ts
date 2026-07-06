import type { Sade } from "sade";
import chalk from "chalk";
import { withV5Device } from "../device";
import { printJson, renderTable, unwrapSerial } from "../utils/output";

const WELL_KNOWN_KEYS = ["teamnumber", "robotname"] as const;

type KvRow = { key: string; value: string | undefined };

export function toKvJson(values: KvRow[]) {
  return values.map(({ key, value }) => ({ key, value: value ?? null }));
}

export default function registerKvCommand(program: Sade) {
  program
    .command("kv", "list well-known system variables on a brain")
    .option("--json", "print machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      await withV5Device(async (device) => {
        const rows: KvRow[] = [];
        for (const key of WELL_KNOWN_KEYS) {
          const result = await device.brain.getValue(key);
          rows.push({ key, value: result.isOk() ? result.value : undefined });
        }

        if (options.json === true) printJson(toKvJson(rows));
        else
          console.log(
            renderTable(
              ["key", "value"],
              rows.map(({ key, value }) => [
                key,
                value ? value : chalk.dim("(unset)"),
              ]),
            ),
          );
      });
    });

  program
    .command("kv get <key>", "get the value of a system variable on a brain")
    .option("--json", "print machine-readable JSON")
    .action(async (key: string, options: { json?: boolean }) => {
      await withV5Device(async (device) => {
        const result = await device.brain.getValue(key);
        const value = result.isOk() ? result.value : undefined;
        if (options.json === true) printJson({ key, value: value ?? null });
        else console.log(value);
      });
    });

  program
    .command("kv set <key> <value>", "set a system variable on a brain")
    .action(async (key, value) => {
      await withV5Device(async (device) => {
        unwrapSerial(
          await device.brain.setValue(key, value),
          `failed to set ${key} to ${value}`,
        );
        console.log(`set ${key} to ${value}`);
      });
    });
}
