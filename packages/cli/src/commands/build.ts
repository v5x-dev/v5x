import { defineCommand, option } from "@bunli/core";
import z from "zod";
import { detectProgramType } from "../utils/detect";

async function buildProsProgram(path: string) {
  const makeProc = Bun.spawn({
    cmd: ["make"],
    cwd: path,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });

  await makeProc.exited;
  return makeProc.exitCode;
}

const buildCommand = defineCommand({
  name: "build",
  description: "build a program for the v5 brain",
  alias: "b",
  options: {
    path: option(z.string().default(process.cwd()), {
      short: "p",
      description: "path to the program",
    }),
  },
  handler: async ({ flags, colors }) => {
    const { path } = flags;

    const type = await detectProgramType(path);
    switch (type) {
      case "pros":
        console.log(colors.yellow("building pros program"));
        await buildProsProgram(path);
        break;
      case "unknown":
        console.log(colors.red("program type could not be detected"));
        break;
    }
  },
});

export default buildCommand;
