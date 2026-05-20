#!/usr/bin/env bun

import packageJson from "../package.json";
import { Args, Command } from "@effect/cli";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Console, Effect } from "effect";

import { serial } from "./adapter";
import { V5SerialDevice } from "@v5x/serial";

const brand = (str: string) => `\x1b[0;38;2;129;140;248;49m${str}\x1b[0m`;

const keyArg = Args.text({ name: "key" });

const kvGet = Command.make("get", { key: keyArg }, ({ key }) =>
  Effect.gen(function* () {
    const device = new V5SerialDevice(serial);
    device.autoReconnect = false;
    device.autoRefresh = false;

    yield* Effect.promise(async () => {
      await device.connect();
      return await device.brain.getValue(key);
    }).pipe(
      Effect.tap((value) => Console.log(value)),
      Effect.ensuring(Effect.promise(() => device.dispose())),
    );
  }),
);

const kv = Command.make("kv").pipe(Command.withSubcommands([kvGet]));

const main = Command.make("v5x").pipe(Command.withSubcommands([kv]));

const cli = Command.run(main, {
  name: "v5x",
  version: packageJson.version,
});

Effect.gen(function* () {
  return yield* cli(process.argv);
}).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain);
