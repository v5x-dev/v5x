import { defineCommand, option } from "@bunli/core";
import z from "zod";
import { join } from "path";
import { rm } from "fs/promises";
import { detectProgramType } from "../utils/detect";

const sweepCommand = defineCommand({
  name: "sweep",
  description: "clean up program build outputs",
  alias: "s",
  options: {
    path: option(z.string().default(process.cwd()), {
      description: "path to save the screen capture",
      short: "p",
    }),
  },
  handler: async ({ flags, colors }) => {
    const { path } = flags;

    const type = await detectProgramType(path);
    switch (type) {
      case "vexcode-cpp":
      case "pros":
        if (type === "pros") {
          console.log(colors.yellow("cleaning pros program"));
        } else if (type === "vexcode-cpp") {
          console.log(colors.brightRed("cleaning vexcode c++ program"));
        }

        const makeProc = Bun.spawn({
          cmd: ["make", "clean"],
          cwd: path,
          stdout: "ignore",
          stderr: "ignore",
          stdin: "inherit",
        });

        await makeProc.exited;
        break;
      case "vexide":
        console.log(colors.brightYellow("cleaning vexide program"));

        await rm(join(path, "target"), { recursive: true, force: true });

        break;
      case "vexcode-py":
        console.log(
          colors.brightRed("vexcode python programs do not need cleaning"),
        );
        break;
      case "unknown":
        console.log(colors.red("program type could not be detected"));
        break;
    }
  },
});

export default sweepCommand;
