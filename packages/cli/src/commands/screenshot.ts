import type { Sade } from "sade";
import { connectV5Device } from "../device";

function printKittyRGB(bytes: Uint8Array) {
  const WIDTH = 480;
  const HEIGHT = 272;

  if (bytes.length !== WIDTH * HEIGHT * 3) {
    throw new Error(`bad screenshot size: ${bytes.length}`);
  }

  const base64 = Buffer.from(bytes).toString("base64");

  process.stdout.write(
    `\x1b_G` +
      `a=T,` +
      `f=24,` +
      `s=${WIDTH},` +
      `v=${HEIGHT},` +
      `c=40;` +
      base64 +
      `\x1b\\\n`,
  );
}

export default function registerScreenshotCommand(program: Sade) {
  program
    .command("screenshot", "take a screen capture of the brain", {
      alias: "sc",
    })
    .action(async () => {
      const device = await connectV5Device();

      const data = await device.brain.captureScreen();
      if (data) printKittyRGB(data);

      await device.dispose();
    });
}
