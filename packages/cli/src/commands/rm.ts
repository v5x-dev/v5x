import type { Sade } from "sade";
import { withV5Device } from "../device";

export default function registerRmCommand(program: Sade) {
  program
    .command("rm <file>", "erase a file from flash")
    .action(async (file) => {
      await withV5Device(async (device) => {
        const ok = await device.brain.removeFile(file);
        if (!ok) throw new Error(`failed to erase ${file}`);
        console.log(`erased ${file}`);
      });
    });
}
