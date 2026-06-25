import type { Sade } from "sade";
import { withV5Device } from "../device";

export default function registerCatCommand(program: Sade) {
  program
    .command("cat <file>", "read a file from flash")
    .action(async (file) => {
      await withV5Device(async (device) => {
        const decoder = new TextDecoder();
        const result = await device.brain.readFile(file);
        if (result.isErr()) throw new Error(`failed to read ${file}`);
        console.log(decoder.decode(result.value));
      });
    });
}
