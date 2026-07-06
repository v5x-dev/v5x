import type { Sade } from "sade";
import { deflateSync } from "node:zlib";
import { withV5Device } from "../device";

const WIDTH = 480;
const HEIGHT = 272;
const BYTES_PER_PIXEL = 3;

type ScreenshotFormat = "png" | "ppm";

function assertScreenshotSize(bytes: Uint8Array): void {
  if (bytes.length !== WIDTH * HEIGHT * BYTES_PER_PIXEL) {
    throw new Error(`bad screenshot size: ${bytes.length}`);
  }
}

function writeUint32(buffer: Buffer, offset: number, value: number): void {
  buffer.writeUInt32BE(value >>> 0, offset);
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
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  writeUint32(chunk, 0, data.length);
  typeBytes.copy(chunk, 4);
  Buffer.from(data).copy(chunk, 8);
  writeUint32(
    chunk,
    8 + data.length,
    crc32(Buffer.concat([typeBytes, Buffer.from(data)])),
  );
  return chunk;
}

export function encodeScreenshotPng(bytes: Uint8Array): Buffer {
  assertScreenshotSize(bytes);

  const scanlineLength = 1 + WIDTH * BYTES_PER_PIXEL;
  const raw = Buffer.alloc(scanlineLength * HEIGHT);

  for (let y = 0; y < HEIGHT; y++) {
    const sourceStart = y * WIDTH * BYTES_PER_PIXEL;
    const rowStart = y * scanlineLength;
    raw[rowStart] = 0;
    raw.set(
      bytes.subarray(sourceStart, sourceStart + WIDTH * BYTES_PER_PIXEL),
      rowStart + 1,
    );
  }

  const ihdr = Buffer.alloc(13);
  writeUint32(ihdr, 0, WIDTH);
  writeUint32(ihdr, 4, HEIGHT);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

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
    Buffer.from(bytes),
  ]);
}

function parseScreenshotFormat(format: string | undefined): ScreenshotFormat {
  if (format === undefined || format === "png" || format === "ppm") {
    return format ?? "png";
  }

  throw new Error("--format must be png or ppm");
}

function printKittyRGB(bytes: Uint8Array) {
  assertScreenshotSize(bytes);
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
    .option("-o, --output", "write the screenshot to a file")
    .option("--format", "file format for --output: png or ppm", "png")
    .action(async (options: { output?: string; format?: string }) => {
      await withV5Device(async (device) => {
        const result = await device.brain.captureScreen();
        if (result.isErr()) throw new Error("failed to capture screenshot");
        if (options.output !== undefined) {
          const format = parseScreenshotFormat(options.format);
          const data =
            format === "png"
              ? encodeScreenshotPng(result.value)
              : encodeScreenshotPpm(result.value);
          await Bun.write(options.output, data);
          console.log(`wrote ${options.output}`);
          return;
        }

        printKittyRGB(result.value);
      });
    });
}
