import type { Sade } from "sade";
import { printJson } from "../utils/output";
import { ProcessExitError, runProcess } from "../utils/process";
import type { ProjectToolchain } from "../utils/scaffold";
import { toWorkflowInstallJson } from "../utils/workflow-json";

interface InstallProsOptions {
  cwd?: string;
  json?: boolean;
  run?: typeof runProcess;
  which?: (command: string) => string | null;
}

function isExternallyManagedPythonError(error: unknown): boolean {
  return (
    error instanceof ProcessExitError &&
    error.stderr.includes("externally-managed-environment")
  );
}

export async function installPros(options: InstallProsOptions = {}) {
  const cwd = options.cwd ?? process.cwd();
  const run = options.run ?? runProcess;
  const which = options.which ?? Bun.which;
  const stdout = options.json === true ? "ignore" : "inherit";

  if (which("pipx") !== null) {
    await run(["pipx", "install", "pros-cli"], cwd, { stdout });
    return;
  }

  const python = which("python3") ?? which("python");
  if (python === null) throw new Error("Python is required to install PROS");

  try {
    await run([python, "-m", "pip", "install", "--user", "pros-cli"], cwd, {
      stdout,
      stderr: "pipe",
    });
  } catch (error) {
    if (isExternallyManagedPythonError(error)) {
      throw new Error(
        "Python refused to install pros-cli because this is an externally-managed environment. Install pipx and run `v5x install pros` again, or install pros-cli in a virtual environment.",
      );
    }
    throw error;
  }
}

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

      await installPros({ json: options.json });
      if (options.json === true) {
        printJson(toWorkflowInstallJson(selectedToolchain));
      }
    });
}
