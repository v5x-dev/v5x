import { createCommand } from "commander";
import { connectV5Device } from "../device";

const catCommand = createCommand("cat")
  .description("read a file from flash")
  .argument("<file>")
  .action(async (file) => {
    const device = await connectV5Device();

    const decoder = new TextDecoder();
    const content = await device.brain.readFile(file);
    console.log(decoder.decode(content));

    await device.dispose();
  });

export default catCommand;
