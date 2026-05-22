import { defineCommand, option } from "@bunli/core";
import z from "zod";

export enum ProgramIcon {
  "vex-coding-studio" = 0,
  "cool-x" = 1,
  "question-mark" = 2,
  "pizza" = 3,
  "clawbot" = 10,
  "robot" = 11,
  "power-button" = 12,
  "planets" = 13,
  "alien" = 27,
  "alien-in-ufo" = 29,
  "cup-in-field" = 50,
  "cup-and-ball" = 51,
  "matlab" = 901,
  "pros" = 902,
  "robot-mesh" = 903,
  "robot-mesh-cpp" = 911,
  "robot-mesh-blockly" = 912,
  "robot-mesh-flowol" = 913,
  "robot-mesh-js" = 914,
  "robot-mesh-py" = 915,
  "code-file" = 920,
  "vexcode-brackets" = 921,
  "vexcode-blocks" = 922,
  "vexcode-python" = 925,
  "vexcode-cpp" = 926,
}

const uploadCommand = defineCommand({
  name: "upload",
  description: "upload a program or file to a brain",
  alias: "u",
  options: {
    after: option(z.enum(["none", "run", "screen"]).default("none"), {
      description: "action to perform on the brain after upload",
      short: "af",
    }),
    slot: option(z.coerce.number().min(1).max(8).default(1), {
      description: "program slot",
      short: "s",
    }),
    name: option(z.string().optional(), {
      description: "the name of the program",
    }),
    description: option(z.string().default("v5x.dev"), {
      description: "the description of the program",
      short: "d",
    }),
    icon: option(z.enum(Object.keys(ProgramIcon)).default("cool-x"), {
      description: "the program's file icon",
      short: "i",
    }),
    uncompressed: option(z.boolean().default(false), {
      description: "skip gzip compression before uploading",
      short: "u",
    }),
    file: option(z.string().optional(), {
      description: "a build artifact to upload",
    }),
    strategy: option(z.enum(["monolith", "dual", "diff"]).optional(), {
      description: "method to use when uploading binaries",
    }),
  },
  handler: async ({ flags }) => {
    console.log(flags);
  },
});

export default uploadCommand;
