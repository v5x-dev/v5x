import type { Sade } from "sade";
import { withCommonOptions } from "../utils/common-options";
import { type PortSelectionOptions, withSelectedV5Device } from "../device";
import { runTerminalSession } from "../utils/terminal";

export interface TerminalCommandOptions extends PortSelectionOptions {
  timestamps?: boolean;
  input?: boolean;
  json?: boolean;
  color?: boolean;
}

export default function registerTerminalCommand(program: Sade) {
  withCommonOptions(
    program.command("terminal", "stream the running program's output", {
      alias: "term",
    }),
    {
      port: true,
      jsonDescription: "print one JSON record per chunk of output",
    },
  )
    .option("-t, --timestamps", "prefix each line with its arrival time")
    .option("--no-input", "do not forward standard input to the program")
    .option("--no-color", "disable colored output")
    .action(async (options: TerminalCommandOptions) => {
      await withSelectedV5Device(options, (device) =>
        runTerminalSession(device, {
          timestamps: options.timestamps,
          input: options.input,
          json: options.json,
          color: options.color,
        }),
      );
    });
}
