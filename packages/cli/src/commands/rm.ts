import { createCommand } from "commander";
import { connectV5Device } from "../device";

const rmCommand = createCommand("rm")
  .description("erase a file from flash")
  .argument("<file>")
  .action(async (file) => {
    const device = await connectV5Device();

    const ok = await device.brain.removeFile(file);
    if (ok) console.log(`erased ${file}`);
    else console.log(`failed to erase ${file}`);

    await device.dispose();
  });

export default rmCommand;
