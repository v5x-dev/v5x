import type { Sade } from "sade";
import { withV5Device } from "../device";

export default function registerRmCommand(program: Sade) {
  program
    .command("rm <file>", "erase a file from flash")
    .action(async (file) => {
      await withV5Device(async (device) => {
        const result = await device.brain.removeFile(file);
        if (result.isErr()) throw new Error(`failed to erase ${file}`);
        console.log(`erased ${file}`);
      });
    });
}
