import { createCommand } from "commander";
import { connectV5Device } from "../device";

const kvCommand = createCommand("kv").description(
  "access a brain's system key/value configuration",
);

kvCommand
  .command("get")
  .argument("<key>")
  .description("get the value of a system variable on a brain")
  .action(async (key) => {
    const device = await connectV5Device();

    const value = await device.brain.getValue(key);
    console.log(value);

    await device.dispose();
  });

kvCommand
  .command("set")
  .argument("<key>")
  .argument("<value>")
  .description("set a system variable on a brain")
  .action(async (key, value) => {
    const device = await connectV5Device();

    const ok = await device.brain.setValue(key, value);
    if (ok) console.log(`set ${key} to ${value}`);
    else console.error(`failed to set ${key} to ${value}`);

    await device.dispose();
  });

export default kvCommand;
