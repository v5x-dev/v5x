import { defineCommand, option } from "@bunli/core";
import { getV5Device } from "../plugins/device";
import z from "zod";
import { PNG } from "pngjs";
import { renderImage } from "@bunli/runtime/image";

async function convertRGBToPNG(imageBuf: Uint8Array<ArrayBufferLike>) {
  const WIDTH = 480;
  const HEIGHT = 272;

  const png = new PNG({
    width: WIDTH,
    height: HEIGHT,
  });

  // imageBuf is RGBRGBRGB...
  for (let i = 0, j = 0; i < imageBuf.length; i += 3, j += 4) {
    png.data[j] = imageBuf[i]; // R
    png.data[j + 1] = imageBuf[i + 1]; // G
    png.data[j + 2] = imageBuf[i + 2]; // B
    png.data[j + 3] = 255; // A
  }

  const pngBuffer = PNG.sync.write(png);

  // Uint8Array if needed
  const pngBytes = new Uint8Array(pngBuffer);

  return pngBytes;
}

const captureCommand = defineCommand({
  name: "capture",
  description: "take a screen capture of the brain",
  alias: "c",
  options: {
    path: option(z.string().optional(), {
      description: "path to save the screen capture",
      short: "p",
    }),
  },
  handler: async ({ flags, colors, context }) => {
    if (!context) {
      console.log(colors.red("context not found"));
      return;
    }

    const device = getV5Device(context);
    if (!device) return;

    const imageBuf = await device.brain.captureScreen();

    if (!imageBuf) {
      console.log(colors.red("failed to capture screen"));
      return;
    }

    const pngBuf = await convertRGBToPNG(imageBuf);

    await renderImage(
      {
        kind: "bytes",
        bytes: pngBuf,
        mimeType: "image/png",
      },
      {
        width: 50,
      },
    );

    if (flags.path) await Bun.write(flags.path, pngBuf);
  },
});

export default captureCommand;
