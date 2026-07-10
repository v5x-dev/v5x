import type { Sade } from "sade";
import { deflateSync } from "node:zlib";
import { type PortSelectionOptions, withSelectedV5Device } from "../device";
import { requireOptionValue } from "../utils/guards";
import { printJson, unwrapSerial } from "../utils/output";

const WIDTH = 480;
const HEIGHT = 272;
const ROW_BYTES = WIDTH * 3;
const KITTY_CHUNK_BYTES = 4096;
type ScreenshotFormat = "png" | "ppm";

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

export function parseScreenshotFormat(
  format: string | boolean | undefined,
): ScreenshotFormat {
  requireOptionValue(format, "--format");
  if (format === undefined || format === "png" || format === "ppm") {
    return format ?? "png";
  }
  throw new Error("--format must be png or ppm");
}

export function toScreenshotJson(
  output: string,
  format: ScreenshotFormat,
  bytes: number,
) {
  return {
    output,
    format,
    width: WIDTH,
    height: HEIGHT,
    bytes,
  };
}

export function assertScreenshotOptions(options: {
  output?: string;
  json?: boolean;
}): void {
  if (options.json === true && options.output === undefined)
    throw new Error("--json requires --output");
}

export function shouldPrintKittyRgb(
  environment: NodeJS.ProcessEnv = process.env,
  isTTY = process.stdout.isTTY,
): boolean {
  if (isTTY !== true) return false;

  const term = environment.TERM?.toLowerCase();
  const termProgram = environment.TERM_PROGRAM?.toLowerCase();
  return (
    environment.KITTY_WINDOW_ID !== undefined ||
    environment.WEZTERM_PANE !== undefined ||
    term === "xterm-kitty" ||
    term?.includes("ghostty") === true ||
    termProgram === "kitty" ||
    termProgram === "ghostty" ||
    termProgram === "wezterm"
  );
}

export function formatKittyRgb(bytes: Uint8Array): string[] {
  assertScreenshotSize(bytes);
  const base64 = Buffer.from(bytes).toString("base64");
  const chunks: string[] = [];
  for (let offset = 0; offset < base64.length; offset += KITTY_CHUNK_BYTES) {
    const payload = base64.slice(offset, offset + KITTY_CHUNK_BYTES);
    const more = offset + KITTY_CHUNK_BYTES < base64.length;
    const control =
      offset === 0
        ? `a=T,f=24,s=${WIDTH},v=${HEIGHT},c=40,m=${more ? 1 : 0}`
        : `m=${more ? 1 : 0}`;
    chunks.push(`\x1b_G${control};${payload}\x1b\\${more ? "" : "\n"}`);
  }
  return chunks;
}

function printKittyRgb(bytes: Uint8Array): void {
  for (const chunk of formatKittyRgb(bytes)) process.stdout.write(chunk);
}

export default function registerScreenshotCommand(program: Sade) {
  program
    .command("screenshot", "take a screen capture of the brain", {
      alias: "sc",
    })
    .option("-o, --output", "write the screenshot to a file")
    .option("--format", "file format for --output: png or ppm", "png")
    .option("--port", "serial port path or id, defaults to V5X_PORT")
    .option("--json", "print machine-readable JSON")
    .action(
      async (
        options: {
          output?: string | boolean;
          format?: string | boolean;
          json?: boolean;
        } & PortSelectionOptions,
      ) => {
        const output = requireOptionValue(options.output, "--output");
        const format = parseScreenshotFormat(options.format);
        assertScreenshotOptions({ output, json: options.json });
        await withSelectedV5Device(options, async (device) => {
          const frame = unwrapSerial(
            await device.brain.captureScreen(),
            "failed to capture screenshot",
          );
          if (output === undefined) {
            if (shouldPrintKittyRgb()) printKittyRgb(frame);
            else {
              console.error("use --output to write the screenshot to a file");
              process.exitCode = 1;
            }
            return;
          }

          const data =
            format === "png"
              ? encodeScreenshotPng(frame)
              : encodeScreenshotPpm(frame);
          await Bun.write(output, data);
          if (options.json === true)
            printJson(toScreenshotJson(output, format, data.length));
          else console.log(`wrote ${output}`);
        });
      },
    );
}
