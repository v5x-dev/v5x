export async function runProcess(
  command: string[],
  cwd: string,
  options: { stdout?: "inherit" | "ignore" } = {},
): Promise<void> {
  const [program, ...args] = command;
  if (program === undefined) throw new Error("cannot run an empty command");
  const executable = Bun.which(program);
  if (executable === null) {
    throw new Error(`${program} is not installed or is not available on PATH`);
  }

  const process = Bun.spawn({
    cmd: [executable, ...args],
    cwd,
    stdin: "inherit",
    stdout: options.stdout ?? "inherit",
    stderr: "inherit",
  });
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    throw new Error(`${command.join(" ")} exited with code ${exitCode}`);
  }
}
