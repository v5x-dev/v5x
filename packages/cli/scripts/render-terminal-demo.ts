#!/usr/bin/env bun
/**
 * Render the documentation images for `v5x terminal`.
 *
 * The frames are produced by the CLI's own rendering code: this script hands
 * `runTerminalSession` and `reportProgress` a stand-in brain that replays
 * scripted program output, captures the bytes they write, and draws those
 * bytes as an SVG. Nothing in the image is typed by hand, so the pictures stay
 * honest when the CLI's output changes.
 *
 * Usage: bun run --cwd packages/cli demo:terminal [outputDirectory]
 */

import { EventEmitter } from "node:events";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import chalk from "chalk";
import { okAsync } from "neverthrow";
import { ok } from "neverthrow";
import type {
  V5SerialDevice,
  V5UserProgramTerminal,
  VexSerialError,
} from "@v5x/serial";
import {
  runTerminalSession,
  type TerminalStreams,
} from "../src/utils/terminal";
import { reportProgress } from "../src/utils/upload";
import { renderAnsiToSvg } from "./ansi-to-svg";

const IMAGE_COLUMNS = 78;

interface ProgramLine {
  /** Milliseconds to wait before this line is printed. */
  after: number;
  text: string;
}

/**
 * What a vexide program might print during a short autonomous routine. The
 * delays are real: the capture waits them out so the timestamps in the
 * `--timestamps` and `--json` images are the ones the renderer actually
 * produced, not values written by hand.
 */
const programOutput: readonly ProgramLine[] = [
  { after: 0, text: "vexide 0.7.1 | slot 1 | competition: disabled\n" },
  { after: 60, text: "[init] calibrating inertial sensor\n" },
  { after: 340, text: "[init] inertial ready after 2.14 s\n" },
  {
    after: 45,
    text: "[init] 6 motors, 2 rotation sensors, 1 optical online\n",
  },
  { after: 120, text: "[auton] path 'left-side-rush' loaded, 14 waypoints\n" },
  { after: 210, text: "[odom] x=  12.40  y=  -3.08  theta=  88.7\n" },
  { after: 95, text: "[odom] x=  24.91  y=  -3.11  theta=  89.1\n" },
  { after: 260, text: "[intake] ring detected (hue 213), stowing\n" },
  { after: 155, text: "[auton] finished in 14.82 s\n" },
  { after: 80, text: "[driver] control loop running at 100 Hz\n" },
];

interface TerminalEvents {
  text: string;
  error: VexSerialError;
  closed: undefined;
}

/** A terminal session stand-in the script drives line by line. */
class ScriptedTerminal {
  private readonly events = new EventEmitter();

  on<K extends keyof TerminalEvents>(
    event: K,
    listener: (value: TerminalEvents[K]) => void,
  ): void {
    this.events.on(event, listener as (...args: unknown[]) => void);
  }

  remove<K extends keyof TerminalEvents>(
    event: K,
    listener: (value: TerminalEvents[K]) => void,
  ): void {
    this.events.off(event, listener as (...args: unknown[]) => void);
  }

  write(data: Uint8Array | string): ReturnType<V5UserProgramTerminal["write"]> {
    const bytes =
      typeof data === "string" ? new TextEncoder().encode(data) : data;
    return okAsync(bytes.byteLength);
  }

  async close(): Promise<void> {}

  print(text: string): void {
    this.events.emit("text", text);
  }

  asTerminal(): V5UserProgramTerminal {
    return this as unknown as V5UserProgramTerminal;
  }
}

class ScriptedStdin extends EventEmitter {
  isTTY = true;
  isRaw = false;

  setRawMode(value: boolean): this {
    this.isRaw = value;
    return this;
  }

  resume(): this {
    return this;
  }

  pause(): this {
    return this;
  }

  quit(): void {
    this.emit("data", Buffer.from([0x03]));
  }
}

interface Capture {
  stdout: string;
  stderr: string;
  combined: string;
}

/**
 * Run one terminal session against the scripted brain and capture everything
 * it writes. Standard output and standard error are captured in the order the
 * command produced them, which is what the user sees on one screen.
 */
async function captureSession(
  options: Parameters<typeof runTerminalSession>[1],
  lines: readonly ProgramLine[] = programOutput,
): Promise<Capture> {
  const terminal = new ScriptedTerminal();
  const stdin = new ScriptedStdin();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const combined: string[] = [];

  const streams: TerminalStreams = {
    stdout: {
      write: (chunk) => {
        stdout.push(chunk);
        combined.push(chunk);
      },
    },
    stderr: {
      write: (chunk) => {
        stderr.push(chunk);
        combined.push(chunk);
      },
    },
    stdin: stdin as unknown as NodeJS.ReadStream,
    isStdoutTty: true,
  };

  const device = {
    openTerminal: () => ok(terminal.asTerminal()),
  } as unknown as V5SerialDevice;

  const session = runTerminalSession(device, { ...options, streams });
  // Let the session attach before the program starts printing.
  await Bun.sleep(0);
  for (const line of lines) {
    if (line.after > 0) await Bun.sleep(line.after);
    terminal.print(line.text);
  }
  stdin.quit();
  await session;

  return {
    stdout: stdout.join(""),
    stderr: stderr.join(""),
    combined: combined.join(""),
  };
}

/** Capture a real `reportProgress` run for the upload phase of `run --terminal`. */
function captureUploadProgress(): string {
  const writes: string[] = [];
  const originalWrite = process.stderr.write.bind(process.stderr);
  const originalIsTty = process.stderr.isTTY;
  (process.stderr as { isTTY: boolean }).isTTY = true;
  process.stderr.write = ((chunk: string) => {
    writes.push(chunk.toString());
    return true;
  }) as typeof process.stderr.write;

  try {
    const progress = reportProgress();
    for (const [state, total] of [
      ["INI", 220],
      ["BIN", 486_912],
    ] as const) {
      for (const fraction of [0.25, 0.5, 0.75, 1]) {
        progress(state, Math.round(total * fraction), total);
      }
    }
    progress.finish();
  } finally {
    process.stderr.write = originalWrite;
    (process.stderr as { isTTY: boolean }).isTTY = originalIsTty;
  }

  return writes.join("");
}

function prompt(command: string): string {
  return `${chalk.green("➜")} ${chalk.cyan("robot")} ${command}\n`;
}

/**
 * Draw one captured frame and convert it to a PNG. The SVG is an intermediate
 * only: documentation and pull requests reference the PNG, so it is written to
 * a scratch directory rather than committed alongside it.
 */
async function writeImage(
  directory: string,
  name: string,
  title: string,
  body: string,
): Promise<void> {
  const svg = renderAnsiToSvg(body, { title, minColumns: IMAGE_COLUMNS });
  const svgPath = join(
    await mkdtemp(join(tmpdir(), "v5x-demo-")),
    `${name}.svg`,
  );
  await Bun.write(svgPath, svg);

  const png = Bun.spawnSync([
    "rsvg-convert",
    "--zoom=2",
    "--output",
    join(directory, `${name}.png`),
    svgPath,
  ]);
  if (png.exitCode !== 0) {
    throw new Error(
      `rsvg-convert failed for ${name}: ${png.stderr.toString().trim()}`,
    );
  }
  console.log(`wrote ${name}.png`);
}

const outputDirectory =
  process.argv[2] ??
  join(import.meta.dir, "../../../apps/docs/assets/terminal");
await mkdir(outputDirectory, { recursive: true });

// The CLI colors its output when standard output is a terminal. Force the same
// level here so the images show what a real terminal shows.
chalk.level = 3;

const plain = await captureSession({ color: true });
await writeImage(
  outputDirectory,
  "terminal",
  "v5x terminal",
  prompt("v5x terminal") + plain.combined,
);

const timestamped = await captureSession({ timestamps: true, color: true });
await writeImage(
  outputDirectory,
  "terminal-timestamps",
  "v5x terminal --timestamps",
  prompt("v5x terminal --timestamps") + timestamped.combined,
);

const jsonRecords = await captureSession(
  { json: true },
  programOutput.slice(0, 4),
);
await writeImage(
  outputDirectory,
  "terminal-json",
  "v5x terminal --json",
  prompt("v5x terminal --json") + jsonRecords.combined,
);

const runSession = await captureSession(
  { color: true },
  programOutput.slice(0, 6),
);
await writeImage(
  outputDirectory,
  "run-terminal",
  "v5x run --terminal",
  prompt("v5x run --terminal") +
    captureUploadProgress() +
    `${chalk.reset("uploaded and started robot in slot 1")}\n` +
    runSession.combined,
);
