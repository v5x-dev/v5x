import type { Sade } from "sade";
import { connectV5Device } from "../device";

export default function registerCatCommand(program: Sade) {
  program
    .command("cat <file>", "read a file from flash")
    .action(async (file) => {
      const device = await connectV5Device();

      const decoder = new TextDecoder();
      const content = await device.brain.readFile(file);
      console.log(decoder.decode(content));

      await device.dispose();
    });
}
