import type { IProgramInfo, SlotNumber } from "@v5x/serial";
import type { Sade } from "sade";
import { Table } from "cmd-table";
import { withV5Device } from "../device";
import { formatFileSize } from "./dir";

export function parseSlotArgument(slot: string): SlotNumber {
  switch (slot) {
    case "1":
      return 1;
    case "2":
      return 2;
    case "3":
      return 3;
    case "4":
      return 4;
    case "5":
      return 5;
    case "6":
      return 6;
    case "7":
      return 7;
    case "8":
      return 8;
    default:
      throw new Error("slot must be a number from 1 to 8");
  }
}

export function formatProgramTimestamp(time: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(time);
}

function formatSlot(slot: number): string {
  return slot >= 1 && slot <= 8 ? slot.toString() : "unknown";
}

export function formatProgramRows(programs: IProgramInfo[]): string[][] {
  return programs.map((programInfo) => [
    formatSlot(programInfo.slot),
    formatSlot(programInfo.requestedSlot),
    programInfo.name,
    formatFileSize(programInfo.size),
    formatProgramTimestamp(programInfo.time),
    programInfo.binfile,
  ]);
}

export default function registerProgramsCommand(program: Sade) {
  program
    .command("programs", "list programs on the V5 brain")
    .action(async () => {
      await withV5Device(async (device) => {
        const result = await device.brain.listProgram();
        if (result.isErr()) throw new Error("failed to list programs");

        const table = new Table({ compact: true });
        table.addColumn("slot");
        table.addColumn("requested");
        table.addColumn("name");
        table.addColumn("size");
        table.addColumn("timestamp");
        table.addColumn("file");
        formatProgramRows(result.value).forEach((row) => table.addRow(row));
        console.log(table.render());
      });
    });

  program
    .command("start <slot>", "start a program slot on the V5 brain")
    .action(async (slot: string) => {
      const slotNumber = parseSlotArgument(slot);
      await withV5Device(async (device) => {
        const result = await device.brain.runProgram(slotNumber);
        if (result.isErr()) throw new Error(`failed to start slot ${slot}`);
        console.log(`started slot ${slot}`);
      });
    });

  program
    .command("stop", "stop the running program on the V5 brain")
    .action(async () => {
      await withV5Device(async (device) => {
        const result = await device.brain.stopProgram();
        if (result.isErr()) throw new Error("failed to stop program");
        console.log("stopped program");
      });
    });
}
