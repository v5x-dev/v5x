import type { Sade } from "sade";
import { runProcess } from "../utils/process";

export default function registerInstallCommand(program: Sade) {
  program
    .command("install <toolchain>", "install a V5 development toolchain")
    .action(async (toolchain: string) => {
      if (toolchain !== "pros" && toolchain !== "vexide") {
        throw new Error("toolchain must be either pros or vexide");
      }
      if (toolchain === "vexide") {
        await runProcess(["cargo", "install", "cargo-v5"], process.cwd());
        return;
      }

      const python = Bun.which("python3") ?? Bun.which("python");
      if (python === null)
        throw new Error("Python is required to install PROS");
      await runProcess(
        [python, "-m", "pip", "install", "--user", "pros-cli"],
        process.cwd(),
      );
    });
}
