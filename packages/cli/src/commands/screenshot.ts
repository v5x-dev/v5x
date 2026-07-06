import type { Sade } from "sade";
import { deflateSync } from "node:zlib";
import { withV5Device } from "../device";
import { unwrap } from "../utils/output";

const WIDTH = 480;
const HEIGHT = 272;
const ROW_BYTES = WIDTH * 3;

function assertScreenshotSize(bytes: Uint8Array): void {
  if (bytes.length !== ROW_BYTES * HEIGHT) {
    throw new Error(`bad screenshot size: ${bytes.length}`);
  }
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, "ascii");
  chunk.set(data, 8);
  chunk.writeUInt32BE(
    crc32(chunk.subarray(4, 8 + data.length)),
    8 + data.length,
  );
  return chunk;
}

export function encodeScreenshotPng(bytes: Uint8Array): Buffer {
  assertScreenshotSize(bytes);

  // Each PNG scanline is prefixed with a zeroed filter byte.
  const raw = Buffer.alloc((1 + ROW_BYTES) * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    raw.set(
      bytes.subarray(y * ROW_BYTES, (y + 1) * ROW_BYTES),
      y * (1 + ROW_BYTES) + 1,
    );
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

export function encodeScreenshotPpm(bytes: Uint8Array): Buffer {
  assertScreenshotSize(bytes);
  return Buffer.concat([
    Buffer.from(`P6\n${WIDTH} ${HEIGHT}\n255\n`, "ascii"),
    bytes,
  ]);
}

function parseScreenshotFormat(format: string | undefined): "png" | "ppm" {
  if (format === undefined || format === "png" || format === "ppm") {
    return format ?? "png";
  }
  throw new Error("--format must be png or ppm");
}

function printKittyRgb(bytes: Uint8Array): void {
  assertScreenshotSize(bytes);
  const base64 = Buffer.from(bytes).toString("base64");
  process.stdout.write(
    `\x1b_Ga=T,f=24,s=${WIDTH},v=${HEIGHT},c=40;${base64}\x1b\\\n`,
  );
}

export default function registerScreenshotCommand(program: Sade) {
  program
    .command("screenshot", "take a screen capture of the brain", {
      alias: "sc",
    })
    .option("-o, --output", "write the screenshot to a file")
    .option("--format", "file format for --output: png or ppm", "png")
    .action(async (options: { output?: string; format?: string }) => {
      await withV5Device(async (device) => {
        const frame = unwrap(
          await device.brain.captureScreen(),
          "failed to capture screenshot",
        );
        if (options.output === undefined) {
          printKittyRgb(frame);
          return;
        }

        const format = parseScreenshotFormat(options.format);
        const data =
          format === "png"
            ? encodeScreenshotPng(frame)
            : encodeScreenshotPpm(frame);
        await Bun.write(options.output, data);
        console.log(`wrote ${options.output}`);
      });
    });
}
