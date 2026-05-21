#!/usr/bin/env bun
import { createCLI } from "@bunli/core";
import pkg from "../package.json" with { type: "json" };
import { disposeV5Device, v5DevicePlugin } from "./plugins/device";

import captureCommand from "./commands/capture";
import kvCommand from "./commands/key-value";
import buildCommand from "./commands/build";
import sweepCommand from "./commands/sweep";
import catCommand from "./commands/cat";
import dirCommand from "./commands/dir";
import uploadCommand from "./commands/upload";

const cli = await createCLI({
  name: "v5x",
  version: pkg.version,
  description: pkg.description,
  plugins: [v5DevicePlugin] as const,
});

cli.command(buildCommand);
cli.command(uploadCommand);
cli.command(sweepCommand);
cli.command(catCommand);
cli.command(dirCommand);
cli.command(captureCommand);
cli.command(kvCommand);

try {
  await cli.run();
} finally {
  await disposeV5Device();
}
