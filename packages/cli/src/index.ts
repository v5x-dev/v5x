#!/usr/bin/env bun

import packageJson from "../package.json";
import { CliConfig, Command } from "@effect/cli";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { kv } from "./commands/kv";

const brand = (str: string) => `\x1b[0;38;2;129;140;248;49m${str}\x1b[0m`;

const main = Command.make("v5x").pipe(Command.withSubcommands([kv]));

const cli = Command.run(main, {
  name: "v5x",
  version: packageJson.version,
});

Effect.gen(function* () {
  return yield* cli(process.argv);
}).pipe(
  Effect.provide(
    Layer.mergeAll(BunContext.layer, CliConfig.layer({ showBuiltIns: false })),
  ),
  BunRuntime.runMain,
);
