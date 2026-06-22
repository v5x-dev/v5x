import type { Sade } from "sade";
import { connectV5Device } from "../device";

export default function registerRmCommand(program: Sade) {
  program
    .command("rm <file>", "erase a file from flash")
    .action(async (file) => {
      const device = await connectV5Device();
      try {
        const ok = await device.brain.removeFile(file);
        if (!ok) throw new Error(`failed to erase ${file}`);
        console.log(`erased ${file}`);
      } finally {
        await device.dispose();
      }
    });
}
