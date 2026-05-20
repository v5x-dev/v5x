import { Command, Args } from "@effect/cli";
import { Effect, Console } from "effect";
import { V5SerialDevice } from "@v5x/serial";
import { serial } from "../adapter";

const keyArg = Args.text({ name: "key" }).pipe(
  Args.withDescription("The KV key to read or write."),
);

const valueArg = Args.text({ name: "value" }).pipe(
  Args.withDescription("The value to store for the key."),
);

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
).pipe(
  Command.withDescription("Read a value from the V5 brain key-value store."),
);

const kvSet = Command.make(
  "set",
  {
    key: keyArg,
    value: valueArg,
  },
  ({ key, value }) =>
    Effect.gen(function* () {
      const device = new V5SerialDevice(serial);
      device.autoReconnect = false;
      device.autoRefresh = false;

      yield* Effect.promise(async () => {
        await device.connect();
        const ok = await device.brain.setValue(key, value);
        if (ok) return `set ${key} to ${value} on v5 device`;
        else return `failed to set ${key} to ${value} on v5 device`;
      }).pipe(
        Effect.tap((value) => Console.log(value)),
        Effect.ensuring(Effect.promise(() => device.dispose())),
      );
    }),
);

export const kv = Command.make("kv").pipe(
  Command.withSubcommands([kvGet, kvSet]),
);
