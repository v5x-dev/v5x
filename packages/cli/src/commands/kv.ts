import type { Sade } from "sade";
import chalk from "chalk";
import { type PortSelectionOptions, withSelectedV5Device } from "../device";
import {
  formatSerialFailure,
  printJson,
  renderTable,
  unwrapSerial,
} from "../utils/output";

const WELL_KNOWN_KEYS = ["teamnumber", "robotname"] as const;

type KvRow = { key: string; value: string | undefined; error?: string };

export function toKvJson(values: KvRow[]) {
  return values.map(({ key, value, error }) => ({
    key,
    value: value ?? null,
    error: error ?? null,
  }));
}

export default function registerKvCommand(program: Sade) {
  program
    .command("kv", "list well-known system variables on a brain")
    .option("--json", "print machine-readable JSON")
    .option("--port", "serial port path or id, defaults to V5X_PORT")
    .action(async (options: { json?: boolean } & PortSelectionOptions) => {
      await withSelectedV5Device(options, async (device) => {
        const rows: KvRow[] = [];
        for (const key of WELL_KNOWN_KEYS) {
          const result = await device.brain.getValue(key);
          if (result.isOk()) {
            rows.push({ key, value: result.value });
          } else {
            const message = formatSerialFailure(
              `failed to read ${key}`,
              result.error,
            );
            console.error(`warning: ${message}`);
            rows.push({ key, value: undefined, error: message });
          }
        }

        if (options.json === true) printJson(toKvJson(rows));
        else
          console.log(
            renderTable(
              ["key", "value"],
              rows.map(({ key, value, error }) => [
                key,
                error !== undefined
                  ? chalk.red(error)
                  : value
                    ? value
                    : chalk.dim("(unset)"),
              ]),
            ),
          );
      });
    });

  program
    .command("kv get <key>", "get the value of a system variable on a brain")
    .option("--json", "print machine-readable JSON")
    .option("--port", "serial port path or id, defaults to V5X_PORT")
    .action(
      async (
        key: string,
        options: { json?: boolean } & PortSelectionOptions,
      ) => {
        await withSelectedV5Device(options, async (device) => {
          const value = unwrapSerial(
            await device.brain.getValue(key),
            `failed to get ${key}`,
          );
          if (options.json === true) printJson({ key, value });
          else console.log(value);
        });
      },
    );

  program
    .command("kv set <key> <value>", "set a system variable on a brain")
    .option("--port", "serial port path or id, defaults to V5X_PORT")
    .action(
      async (key: string, value: string, options: PortSelectionOptions) => {
        await withSelectedV5Device(options, async (device) => {
          unwrapSerial(
            await device.brain.setValue(key, value),
            `failed to set ${key} to ${value}`,
          );
          console.log(`set ${key} to ${value}`);
        });
      },
    );
}
