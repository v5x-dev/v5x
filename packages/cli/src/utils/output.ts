import { Table } from "cmd-table";
import type { Result } from "neverthrow";

export const utcTimestamp = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function renderTable(columns: string[], rows: string[][]): string {
  const table = new Table({ compact: true });
  for (const column of columns) table.addColumn(column);
  for (const row of rows) table.addRow(row);
  return table.render();
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

export function unwrap<T, E>(result: Result<T, E>, message: string): T {
  if (result.isErr()) throw new Error(message);
  return result.value;
}
