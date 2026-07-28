import type { Sade } from "sade";

interface CommonOptions {
  port?: boolean;
  jsonDescription?: string;
}

export function withCommonOptions(
  command: Sade,
  options: CommonOptions = {},
): Sade {
  command.option(
    "--json",
    options.jsonDescription ?? "print machine-readable JSON",
  );
  if (options.port === true) {
    command.option("--port", "serial port path or id, defaults to V5X_PORT");
  }
  return command;
}
