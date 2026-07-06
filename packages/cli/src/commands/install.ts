import type { Sade } from "sade";
import { printJson } from "../utils/output";
import { runProcess } from "../utils/process";
import type { ProjectToolchain } from "../utils/scaffold";
import { toWorkflowInstallJson } from "../utils/workflow-json";

export default function registerInstallCommand(program: Sade) {
  program
    .command("install <toolchain>", "install a V5 development toolchain")
    .option("--json", "print machine-readable JSON")
    .action(async (toolchain: string, options: { json?: boolean }) => {
      if (toolchain !== "pros" && toolchain !== "vexide") {
        throw new Error("toolchain must be either pros or vexide");
      }
      const selectedToolchain: ProjectToolchain = toolchain;
      if (toolchain === "vexide") {
        await runProcess(["cargo", "install", "cargo-v5"], process.cwd(), {
          stdout: options.json === true ? "ignore" : "inherit",
        });
        if (options.json === true) {
          printJson(toWorkflowInstallJson(selectedToolchain));
        }
        return;
      }

      const python = Bun.which("python3") ?? Bun.which("python");
      if (python === null)
        throw new Error("Python is required to install PROS");
      await runProcess(
        [python, "-m", "pip", "install", "--user", "pros-cli"],
        process.cwd(),
        { stdout: options.json === true ? "ignore" : "inherit" },
      );
      if (options.json === true) {
        printJson(toWorkflowInstallJson(selectedToolchain));
      }
    });
}
