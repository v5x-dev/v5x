import type { Sade } from "sade";
import { withCommonOptions } from "../utils/common-options";
import { type PortSelectionOptions, withSelectedV5Device } from "../device";
import { parseBrainFilePath } from "../utils/brainPath";
import { printOutput, unwrapSerial } from "../utils/output";

export default function registerRmCommand(program: Sade) {
  withCommonOptions(program.command("rm <file>", "erase a file from flash"), {
    port: true,
  }).action(
    async (file, options: { json?: boolean } & PortSelectionOptions) => {
      const handle = parseBrainFilePath(file);
      await withSelectedV5Device(options, async (device) => {
        unwrapSerial(
          await device.brain.removeFile(handle),
          `failed to erase ${file}`,
        );
        printOutput(
          options.json,
          { command: "rm", file, erased: true },
          () => `erased ${file}`,
        );
      });
    },
  );
}
