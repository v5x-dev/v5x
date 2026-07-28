import type { Sade } from "sade";
import { withCommonOptions } from "../utils/common-options";
import chalk from "chalk";
import { type PortSelectionOptions, withSelectedV5Device } from "../device";
import {
  formatSerialFailure,
  printOutput,
  renderTable,
  unwrapSerial,
} from "../utils/output";

const WELL_KNOWN_KEYS = ["teamnumber", "robotname"] as const;

type KvRow = { key: string; value: string | undefined; error?: string };

export function toKvJson(values: KvRow[]) {
  return values.map(({ key, value, error }) => ({
    key,
    value: value ?? null,
    ...(error === undefined ? {} : { error }),
  }));
}

export function formatKvRows(rows: KvRow[]): string[][] {
  return rows.map(({ key, value, error }) => [
    key,
    error ?? (value ? value : chalk.dim("(unset)")),
  ]);
}

export default function registerKvCommand(program: Sade) {
  withCommonOptions(
    program.command("kv", "list well-known system variables on a brain"),
    { port: true },
  ).action(async (options: { json?: boolean } & PortSelectionOptions) => {
    await withSelectedV5Device(options, async (device) => {
      const rows: KvRow[] = [];
      for (const key of WELL_KNOWN_KEYS) {
        const result = await device.brain.getValue(key);
        rows.push(
          result.isOk()
            ? { key, value: result.value }
            : {
                key,
                value: undefined,
                error: formatSerialFailure(
                  `failed to get ${key}`,
                  result.error,
                ),
              },
        );
      }

      printOutput(
        options.json,
        toKvJson(rows),
        renderTable(["key", "value"], formatKvRows(rows)),
      );
    });
  });

  withCommonOptions(
    program.command(
      "kv get <key>",
      "get the value of a system variable on a brain",
    ),
    { port: true },
  ).action(
    async (key: string, options: { json?: boolean } & PortSelectionOptions) => {
      await withSelectedV5Device(options, async (device) => {
        const value = unwrapSerial(
          await device.brain.getValue(key),
          `failed to get ${key}`,
        );
        printOutput(options.json, { key, value: value ?? null }, value);
      });
    },
  );

  withCommonOptions(
    program.command("kv set <key> <value>", "set a system variable on a brain"),
    { port: true },
  ).action(
    async (key, value, options: { json?: boolean } & PortSelectionOptions) => {
      await withSelectedV5Device(options, async (device) => {
        unwrapSerial(
          await device.brain.setValue(key, value),
          `failed to set ${key} to ${value}`,
        );
        printOutput(
          options.json,
          { command: "kv set", key, value, set: true },
          `set ${key} to ${value}`,
        );
      });
    },
  );
}
