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

## Common Exports

- `V5SerialConnection` for opening and managing a serial connection.
- `V5SerialDevice` for higher-level device operations.
- `PacketEncoder`, `DeviceBoundPacket`, and `HostBoundPacket` for low-level
  protocol work.
- `ProgramIniConfig` for creating VEX program metadata.
- Protocol enums and types from `Vex.ts`.

## Build

```sh
bun run build
```

The build emits JavaScript bundles and TypeScript declarations under `dist/`.
