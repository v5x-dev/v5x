import type { IProgramInfo, SlotNumber } from "@v5x/serial";
import type { Sade } from "sade";
import { withCommonOptions } from "../utils/common-options";
import { type PortSelectionOptions, withSelectedV5Device } from "../device";
import {
  printOutput,
  renderTable,
  unwrapSerial,
  utcTimestamp,
} from "../utils/output";
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
  withCommonOptions(
    program.command("programs", "list programs on the V5 brain"),
    { port: true },
  ).action(async (options: { json?: boolean } & PortSelectionOptions) => {
    await withSelectedV5Device(options, async (device) => {
      const programs = unwrapSerial(
        await device.brain.listProgram(),
        "failed to list programs",
      );
      printOutput(
        options.json,
        toProgramJson(programs),
        renderTable(
          ["slot", "requested", "name", "size", "timestamp", "file"],
          formatProgramRows(programs),
        ),
      );
    });
  });

  withCommonOptions(
    program.command("start <slot>", "start a program slot on the V5 brain"),
    { port: true },
  ).action(
    async (
      slot: string,
      options: { json?: boolean } & PortSelectionOptions,
    ) => {
      const slotNumber = parseSlotArgument(slot);
      await withSelectedV5Device(options, async (device) => {
        unwrapSerial(
          await device.brain.runProgram(slotNumber),
          `failed to start slot ${slot}`,
        );
        printOutput(
          options.json,
          { command: "start", slot: slotNumber, started: true },
          `started slot ${slot}`,
        );
      });
    },
  );

  withCommonOptions(
    program.command("stop", "stop the running program on the V5 brain"),
    { port: true },
  ).action(async (options: { json?: boolean } & PortSelectionOptions) => {
    await withSelectedV5Device(options, async (device) => {
      unwrapSerial(await device.brain.stopProgram(), "failed to stop program");
      printOutput(
        options.json,
        { command: "stop", stopped: true },
        "stopped program",
      );
    });
  });
}
