import type { Sade } from "sade";
import { connectV5Device } from "../device";

export default function registerRmCommand(program: Sade) {
  program
    .command("rm <file>", "erase a file from flash")
    .action(async (file) => {
      const device = await connectV5Device();

      const ok = await device.brain.removeFile(file);
      if (ok) console.log(`erased ${file}`);
      else console.log(`failed to erase ${file}`);

      await device.dispose();
    });
}
