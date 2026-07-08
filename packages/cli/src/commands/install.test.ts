import { expect, test } from "bun:test";
import { installPros } from "./install";
import { ProcessExitError } from "../utils/process";

test("installs PROS with pipx when available", async () => {
  const commands: string[][] = [];

  await installPros({
    cwd: "/workspace",
    which: (command) => (command === "pipx" ? `/bin/${command}` : null),
    run: async (command) => {
      commands.push(command);
    },
  });

  expect(commands).toEqual([["pipx", "install", "pros-cli"]]);
});

test("falls back to user-scoped pip install when pipx is unavailable", async () => {
  const commands: string[][] = [];

  await installPros({
    cwd: "/workspace",
    which: (command) => (command === "python3" ? `/bin/${command}` : null),
    run: async (command) => {
      commands.push(command);
    },
  });

  expect(commands).toEqual([
    ["/bin/python3", "-m", "pip", "install", "--user", "pros-cli"],
  ]);
});

test("explains externally-managed Python failures", async () => {
  await expect(
    installPros({
      cwd: "/workspace",
      which: (command) => (command === "python3" ? `/bin/${command}` : null),
      run: async () => {
        throw new ProcessExitError(
          "python3 -m pip install --user pros-cli exited with code 1",
          "error: externally-managed-environment",
        );
      },
    }),
  ).rejects.toThrow("Install pipx and run `v5x install pros` again");
});
