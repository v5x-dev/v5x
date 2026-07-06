import type { IProgramInfo, SlotNumber } from "@v5x/serial";
import type { Sade } from "sade";
import { withV5Device } from "../device";
import { printJson, renderTable, unwrap, utcTimestamp } from "../utils/output";
import { formatFileSize } from "./dir";

export function parseSlotArgument(slot: string): SlotNumber {
  if (!/^[1-8]$/.test(slot))
    throw new Error("slot must be a number from 1 to 8");
  return Number(slot) as SlotNumber;
}

function formatSlot(slot: number): string {
  return slot >= 1 && slot <= 8 ? slot.toString() : "unknown";
}

export function formatProgramRows(programs: IProgramInfo[]): string[][] {
  return programs.map((info) => [
    formatSlot(info.slot),
    formatSlot(info.requestedSlot),
    info.name,
    formatFileSize(info.size),
    utcTimestamp.format(info.time),
    info.binfile,
  ]);
}

export function toProgramJson(programs: IProgramInfo[]) {
  return programs.map(({ slot, requestedSlot, name, size, time, binfile }) => ({
    slot,
    requestedSlot,
    name,
    size,
    time: time.toISOString(),
    binfile,
  }));
}

export default function registerProgramsCommand(program: Sade) {
  program
    .command("programs", "list programs on the V5 brain")
    .option("--json", "print machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      await withV5Device(async (device) => {
        const programs = unwrap(
          await device.brain.listProgram(),
          "failed to list programs",
        );
        if (options.json === true) printJson(toProgramJson(programs));
        else
          console.log(
            renderTable(
              ["slot", "requested", "name", "size", "timestamp", "file"],
              formatProgramRows(programs),
            ),
          );
      });
    });

  program
    .command("start <slot>", "start a program slot on the V5 brain")
    .action(async (slot: string) => {
      const slotNumber = parseSlotArgument(slot);
      await withV5Device(async (device) => {
        unwrap(
          await device.brain.runProgram(slotNumber),
          `failed to start slot ${slot}`,
        );
        console.log(`started slot ${slot}`);
      });
    });

  program
    .command("stop", "stop the running program on the V5 brain")
    .action(async () => {
      await withV5Device(async (device) => {
        unwrap(await device.brain.stopProgram(), "failed to stop program");
        console.log("stopped program");
      });
    });
}
