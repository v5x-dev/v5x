import { Command } from "commander";
import { exists } from "fs/promises";
import { detectProgramType, ProgramType } from "../utils/detect";
import { join } from "path";
import { ProgramIniConfig, V5SerialDevice } from "@v5x/serial";
import { serial } from "../adapter";
import pc from "picocolors";

async function uploadProsProgram(path: string, options: any) {
  const hotFile = Bun.file(join(path, "bin", "hot.package.bin"));
  const coldFile = Bun.file(join(path, "bin", "cold.package.bin"));

  if (!(await hotFile.exists()) || !(await coldFile.exists())) {
    console.error("no bin files found, run build first");
    process.exit(1);
  }

  const device = new V5SerialDevice(serial);
  device.autoRefresh = false;
  const connected = await device.connect();
  if (!connected) {
    console.error("no v5 devices found");
    await device.dispose();
    process.exit(1);
  }

  const ini = new ProgramIniConfig();

  let lastPct = "";
  let lastState = "";

  const uploaded = await device.brain.uploadProgram(
    ini,
    Bun.gzipSync(await hotFile.bytes()),
    Bun.gzipSync(await coldFile.bytes()),
    (state, current, total) => {
      const pct = ((current / total) * 100).toFixed(1) + "%";

      // new file/phase -> move to next line
      if (state !== lastState) {
        if (lastState !== "") {
          process.stdout.write("\n");
        }

        lastState = state;
        lastPct = "";
      }

      const text =
        state === "BIN"
          ? pc.red(`${state} ${pct}`)
          : state === "COLD"
            ? pc.blue(`${state} ${pct}`)
            : pc.dim(`${state} ${pct}`);

      // redraw same line for progress updates
      if (pct !== lastPct) {
        process.stdout.write(`\r${text}   `);
        lastPct = pct;
      }
    },
  );

  process.stdout.write("\n");

  await device.dispose();

  if (!uploaded) {
    console.error("upload failed");
    process.exit(1);
  }
}

export const upload = new Command("upload")
  .alias("u")
  .description("build a program for the vex v5 brain")
  .argument("[path]", "path to the program", process.cwd())
  .option("-t, --type <type>", "type of the program")
  .action(async (path, options) => {
    if (!(await exists(path))) {
      console.error(`path does not exist: ${path}`);
      return;
    }

    const type: ProgramType = options.type ?? (await detectProgramType(path));

    switch (type) {
      case "pros":
        return uploadProsProgram(path, options);

      case "unknown":
        console.error("could not detect program type");
        break;

      default:
        console.error(`unknown program type: ${type}`);
        break;
    }
  });
