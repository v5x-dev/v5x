# @v5x/serial

TypeScript implementation of the VEX V5 serial protocol.

See the [serial library documentation](https://docs.v5x.dev/serial/overview) for browser setup, guides, and high-level API reference.

It covers connecting to V5 devices over the Web Serial API, reading device
state, transferring files, and working with protocol packets.

## Install

```sh
bun add @v5x/serial
```

## Usage

Every public async API returns a `neverthrow` `ResultAsync` whose error channel
is a `VexSerialError`. Inspect the result with `.isOk()` / `.isErr()` or
`.match()` instead of using `try`/`catch`:

```ts
import { V5SerialConnection } from "@v5x/serial";

const connection = new V5SerialConnection(navigator.serial);

const opened = await connection.open();
if (opened.isErr()) {
  console.error(opened.error); // VexSerialError with a stable .kind
  return;
}
if (opened.value !== "opened") {
  console.error(`Unable to open a compatible port: ${opened.value}`);
  return;
}

const status = await connection.getSystemStatus();
if (status.isOk()) {
  console.log(status.value);
} else {
  console.error(status.error.kind, status.error.message);
}
```

Web Serial is browser-only and requires a secure context, such as HTTPS or
`localhost`. The user must grant access to a serial device before the connection
can open.

The package ships ESM, CommonJS, and TypeScript declarations. Packet and version
utilities work in Bun or Node.js, but direct browser device connections require
the Web Serial API. The `@v5x/cli` package is separate and currently supports
Linux and macOS. Windows requires a different CLI serial backend.

## Common Exports

- `V5SerialConnection` for opening and managing a serial connection.
- `V5SerialDevice` for higher-level device operations.
- `VexSerialError` and its subclasses (`VexNotConnectedError`,
  `VexProtocolError`, `VexTransferError`, `VexDownloadError`,
  `VexFirmwareError`, `VexIoError`, `VexInvalidArgumentError`) for typed failure
  handling. Each carries a stable `kind` discriminator.
- `PacketEncoder`, `DeviceBoundPacket`, and `HostBoundPacket` for low-level
  protocol work.
- `ProgramIniConfig` for creating VEX program metadata.
- Protocol enums and types from `Vex.ts`.

## Result-returning async APIs

All public async methods return `ResultAsync<T, VexSerialError>`, so failures
are explicit in the type system rather than thrown. State-changing operations
are awaitable and report errors through the result channel:

```ts
const r = await device.setMatchMode("disabled");
if (r.isErr()) console.error(r.error);

await device.brain.setActiveProgram(1).mapErr((e) => console.error(e));
await device.brain.setActiveProgram(0);
```

The fire-and-forget `device.matchMode = value` setter is deprecated, and the
former `device.brain.activeProgram = value` setter has been removed. Migrate to
the corresponding `setMatchMode()` / `setActiveProgram()` methods and handle
the returned `Result`.

Legacy methods that resolved to `false`, `null`, or `undefined` on failure now
return a typed `Err` instead. `open()` reports non-error connection outcomes on
the `Ok` channel as `"opened"`, `"busy"`, or `"no-port"`; only `"opened"`
indicates an established connection.

## Transfers and timeouts

Bulk uploads and downloads on one `V5SerialConnection` are queued and run one at
a time. Await each high-level transfer; do not interleave manual low-level file
packets. A `V5SerialDevice` pauses its background refresh while a high-level
transfer is active by default.

Protocol requests default to a 1,000 ms response timeout. Individual transfer
phases use longer timeouts where erase, write, or exit operations need them.
`reconnect(0)` waits indefinitely, while a positive reconnect timeout is a total
deadline in milliseconds. A timeout or NACK surfaces as a `VexProtocolError`
(or a related `VexSerialError` subclass) through the `Result` error channel; it
does not cancel work already running on the device.

User QSPI files are limited to `USER_FLASH_MAX_FILE_SIZE` (2 MiB). Firmware
updates download an archive containing non-empty `BOOT.bin` and `assets.bin`
images whose sizes must match the archive metadata. Firmware writes can render a
device unusable if power or communication is interrupted; keep them out of
normal application flows and validate the target VEXos version first.

Files downloaded from a connected device are limited to 64 MiB by default so
malformed device metadata cannot trigger an unbounded allocation. Applications
that need a smaller bound can configure it on either API layer:

```ts
const connection = new V5SerialConnection(navigator.serial, {
  maxFileDownloadBytes: 8 * 1024 * 1024,
});
const device = new V5SerialDevice(navigator.serial, {
  maxFileDownloadBytes: 8 * 1024 * 1024,
});
```

## Build

```sh
bun run build
```

The build emits JavaScript bundles and TypeScript declarations under `dist/`.

### Packet registry and browser bundle measurement

The complete entry point registers every reply class explicitly. Packet
decoding no longer discovers classes by enumerating the packet-model module at
runtime. Consumers that only need framing, CRC, packet base classes, and a
custom reply registry can import `@v5x/serial/packet-core`; that entry point
does not retain file-transfer, firmware, screenshot, or dashboard models.
Register only the reply classes the application accepts with
`PacketEncoder.getInstance().registerPacketTypes(...)`.

Run `bun run measure:bundles` in this package to report reproducible minified
byte sizes for the complete browser entry and the packet-core entry.

### File-transfer window semantics

The `windowSize` returned by `InitFileTransferReplyD2HPacket` is the maximum
data size for one `ReadFile` or `WriteFile` block. It is not a count of blocks
that may be outstanding. This follows from the wire model: read and write
replies carry only the shared CDC2 command and function IDs; write replies have
no address, sequence number, or request identifier with which to correlate an
individual outstanding block. A read address can validate a reply after it is
routed, but cannot make write failures unambiguous.

Transfers therefore intentionally remain stop-and-wait. The advertised value
is clamped to the library's 4096-byte block limit and used only as the chunk
size. There is no safe before/after pipelining benchmark to run because the
protocol does not expose the correlation needed to enable pipelining without
risking data corruption. Hardware throughput remains dependent on one USB
round trip per block.
