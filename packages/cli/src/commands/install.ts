import { createCommand } from "commander";
import { runProcess } from "../utils/process";

const installCommand = createCommand("install")
  .description("install a V5 development toolchain")
  .argument("<toolchain>", "toolchain to install", (value: string) => {
    if (value !== "pros" && value !== "vexide") {
      throw new Error("toolchain must be either pros or vexide");
    }
    return value;
  })
  .action(async (toolchain: "pros" | "vexide") => {
    if (toolchain === "vexide") {
      await runProcess(["cargo", "install", "cargo-v5"], process.cwd());
      return;
    }

    const python = Bun.which("python3") ?? Bun.which("python");
    if (python === null) throw new Error("Python is required to install PROS");
    await runProcess(
      [python, "-m", "pip", "install", "--user", "pros-cli"],
      process.cwd(),
    );
  });

export default installCommand;
