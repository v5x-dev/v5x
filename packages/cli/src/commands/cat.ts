import type { Sade } from "sade";
import { withV5Device } from "../device";
import { parseBrainFilePath } from "../utils/brainPath";
import { unwrapSerial } from "../utils/output";

export default function registerCatCommand(program: Sade) {
  program
    .command("cat <file>", "read a file from flash")
    .action(async (file) => {
      const handle = parseBrainFilePath(file);
      await withV5Device(async (device) => {
        const bytes = unwrapSerial(
          await device.brain.readFile(handle),
          `failed to read ${file}`,
        );
        console.log(new TextDecoder().decode(bytes));
      });
    });
}
