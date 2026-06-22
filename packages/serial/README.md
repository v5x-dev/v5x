# @v5x/serial

TypeScript implementation of the VEX V5 serial protocol.

See the [serial library documentation](https://docs.v5x.dev/serial/overview) for browser setup, guides, and high-level API reference.

This package provides helpers for connecting to V5 devices over the Web Serial
API, reading device state, transferring files, and working with protocol
packets.

## Install

```sh
bun add @v5x/serial
```

## Usage

```ts
import { V5SerialConnection } from "@v5x/serial";

const connection = new V5SerialConnection(navigator.serial);

const connected = await connection.open();

if (connected) {
  const status = await connection.getSystemStatus();
  console.log(status);
}
```

Web Serial is browser-only and requires a secure context, such as HTTPS or
`localhost`. The user must grant access to a serial device before the connection
can open.

The package ships ESM, CommonJS, and TypeScript declarations. Packet and version
utilities work in Bun or Node.js, but direct browser device connections require
the Web Serial API. The `@v5x/cli` package is separate and currently supports
Linux only.

## Common Exports

- `V5SerialConnection` for opening and managing a serial connection.
- `V5SerialDevice` for higher-level device operations.
- `PacketEncoder`, `DeviceBoundPacket`, and `HostBoundPacket` for low-level
  protocol work.
- `ProgramIniConfig` for creating VEX program metadata.
- Protocol enums and types from `Vex.ts`.

## Async state changes

State-changing operations are awaitable so failures are observable:

```ts
await device.setMatchMode("disabled");
await device.brain.setActiveProgram(1);
await device.brain.setActiveProgram(0);
```

The former `device.matchMode = value` and
`device.brain.activeProgram = value` setters were fire-and-forget and have been
removed. Migrate to the corresponding async methods and check their boolean
result.

## Transfers and timeouts

Bulk uploads and downloads on one `V5SerialConnection` are queued and run one at
a time. Await each high-level transfer; do not interleave manual low-level file
packets. A `V5SerialDevice` pauses its background refresh while a high-level
transfer is active by default.

Protocol requests default to a 1,000 ms response timeout. Individual transfer
phases use longer timeouts where erase, write, or exit operations need them.
`reconnect(0)` waits indefinitely, while a positive reconnect timeout is a
total deadline in milliseconds. A timeout is reported through the method's
documented `false`, `null`, `undefined`, or acknowledgement result; it does not
cancel work already running on the device.

User QSPI files are limited to `USER_FLASH_MAX_FILE_SIZE` (2 MiB). Firmware
updates download an archive containing non-empty `BOOT.bin` and `assets.bin`
images whose sizes must match the archive metadata. Firmware writes can render a
device unusable if power or communication is interrupted; keep them out of
normal application flows and validate the target VEXos version first.

## Build

```sh
bun run build
```

The build emits JavaScript bundles and TypeScript declarations under `dist/`.
