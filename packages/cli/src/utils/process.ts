export class ProcessExitError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
  ) {
    super(message);
  }
}

export async function runProcess(
  command: string[],
  cwd: string,
  options: {
    stdout?: "inherit" | "ignore";
    stderr?: "inherit" | "pipe";
  } = {},
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
    stderr: options.stderr ?? "inherit",
  });
  const [exitCode, stderr] = await Promise.all([
    process.exited,
    options.stderr === "pipe"
      ? (process.stderr?.text() ?? Promise.resolve(""))
      : Promise.resolve(""),
  ]);
  if (exitCode !== 0) {
    const message = `${command.join(" ")} exited with code ${exitCode}`;
    throw new ProcessExitError(
      stderr.length > 0 ? `${message}\n${stderr}` : message,
      stderr,
    );
  }
}
