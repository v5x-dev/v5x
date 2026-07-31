# Changelog

This repository versions `@v5x/cli`, `@v5x/events`, `@v5x/node`, `@v5x/serial`,
and `@v5x/web` independently. Each release moves entries from the applicable
Unreleased section to a dated package-version heading.

## Unreleased

### @v5x/node

- New package. A Web Serial compatible serial transport for Node.js and Bun,
  extracted from the CLI's private adapter: `NodeSerial`, `NodeSerialPort`, a
  `serial` instance that stands in for `navigator.serial`, stable port objects
  across enumerations, readable-stream backpressure, and port info carrying the
  device path and USB serial number a browser hides.
- Put every platform detail behind a `SerialBackend` interface, so a new
  runtime or operating system is a backend rather than a new transport. The
  default `createBunSerialportBackend()` drives the optional `bun-serialport`
  peer dependency and enumerates Linux ports from sysfs so USB ids are known.
- Add Windows support. `createWindowsSerialBackend()` drives COM ports through
  the Win32 communications API with Bun's FFI, so Windows needs no native
  module, and enumerates ports from the registry because Windows reports USB
  ids through the device enumeration tree rather than through the port itself.
  `createDefaultSerialBackend()` picks it on `win32` and `bun-serialport`
  elsewhere, so `serial` and `createNodeSerial()` work on all three platforms
  without configuration. `parseComPortNames`, `parseUsbPortAttributes`,
  `createWindowsPortLister`, `openWindowsSerialPort`, `toWindowsDevicePath`,
  and `WindowsSerialPort` are exported for backends that want the pieces.

### @v5x/cli

- Use `@v5x/node` for serial access instead of a private adapter. Nothing about
  command behavior changes.
- Ship for Windows alongside Linux and macOS, now that the serial backend
  covers it: `os` includes `win32`, a `v5x-windows-x64.exe` release asset is
  published, `install.ps1` installs it, and `v5x doctor` reports `win32` as a
  supported platform. `bun-serialport` becomes an optional dependency because
  it has no Windows build and the Windows backend does not use it.

- Add `v5x terminal`, which streams the running program's standard output and
  forwards host input to it, with `--timestamps`, `--no-input`, `--no-color`,
  and newline-delimited `--json` records.
- Add `--terminal` to `upload` and `run`, which keeps the connection open and
  starts streaming as the program starts so its first output is not missed.
- Add an opt-in, read-only-by-default hardware smoke harness for brain and
  controller validation, with non-secret context reports, screenshot artifacts,
  stable failure exits, and a separately gated temporary file round trip.

### @v5x/events

### @v5x/serial

- Add user-program terminal support: `UserFifoH2DPacket` and
  `UserFifoReplyD2HPacket` (command 86, extended 39), `readUserFifo` and
  `writeUserFifo` on connections, and a `V5UserProgramTerminal` polling session
  reachable through `V5SerialDevice.openTerminal()`.
- Reject embedded NULs in outbound protocol text and unsafe, overlong, or
  colliding dynamic INI keys before serial I/O.
- Preserve supplied-connection open failures, distinguish busy and missing
  ports while cleaning up candidates, and reject non-finite reconnect timeouts
  without lifecycle changes.

### @v5x/web

- Add `client.console`, a separately subscribable store holding the running
  program's output with a bounded buffer, plus `useV5Console` for React,
  `createV5Console` for Solid, and console members on the Svelte state.

## Releases

### @v5x/events 0.2.0 - 2026-07-21

- Replace page-oriented collection methods with `events.search()`,
  `teams.search()`, `programs.all()`, and `seasons.all()`, which retrieve every
  API page and return validated arrays.
- Add exact event and team lookup helpers, stable program and round constants,
  and plain-object URL and match utilities.
- Remove `list()`, `listPages()`, `matchesPages()`, `page`, and `perPage`.

### @v5x/events 0.1.7 - 2026-07-21

- Filter event listings by requested event types while safely skipping events
  whose API event type is null.

### @v5x/cli 0.0.25 - 2026-07-21

- Add verbose stack traces, colored error output, and documented exit codes.
- Publish the verified tarball and require its serial dependency to be released.

### @v5x/events 0.1.6 - 2026-07-21

- Add lazy `listPages()` async iterators for top-level event, team, program,
  and season collections.
- Expose the Retry-After delay as `retryAfterMs` on API errors for
  rate-limited (429) and unavailable (503) responses.
- Add an opt-in `retry` client option that retries rate-limited requests after
  the advertised delay while honoring abort signals.

### @v5x/serial 0.5.8 - 2026-07-21

- Bound device-reported file sizes before allocation and make the download
  limit configurable on serial connections and devices.
- Stream firmware downloads into a single bounded buffer instead of retaining
  every response chunk before concatenation.
- Split packet reading, pending-request dispatch, receive buffering, and file
  transfer queuing out of the serial connection module.
- Serialize typed requests that share reply command IDs so out-of-order device
  replies cannot be delivered to the wrong caller.
- Distinguish closed serial connections from device NACK responses.
- Report partner-controller charging state as unavailable instead of mirroring
  the primary controller's charging bit.
- Keep throwing device event listeners from interrupting automatic refresh or
  reconnect lifecycle work.
- Deprecate the mutable `VexSerialConnection` `writer`, `reader`, and `port`
  setters and its `callbacksQueue` snapshot ahead of their next-major removal;
  manage connection lifecycle and pending-request state through the public
  connection methods instead.
- Centralize file-transfer exit cleanup and stale-lifecycle guards, signal
  reader shutdown with a dedicated error class instead of matching error
  text, and avoid transient reply-queue and smart-device-list allocations.

### @v5x/web 0.1.4 - 2026-07-21

- Isolate snapshot subscriber exceptions from connection lifecycle operations.
- Prevent delayed device-disconnect and refresh-failure cleanup from publishing
  stale lifecycle state over a newer disconnect or connection attempt.
- Publish the verified tarball and require its serial dependency to be released.
- Consolidate the device-teardown sequence shared by disconnect, refresh
  failure, and device-disconnect handling into a single helper.

### @v5x/cli 0.0.23 - 2026-07-08

- Add `--port <path-or-id>` or `V5X_PORT` selection for V5 hardware commands.
- Publish the CLI for Linux and macOS with Bun 1.3.14 or newer. Windows
  remains unsupported until the CLI has a compatible serial backend.
- Verify packed source maps, executable permissions, and package contents.

### @v5x/serial 0.5.6 - 2026-07-08

- Add top-level declaration metadata for older TypeScript tooling.
- Replace the `matchMode` and `activeProgram` setters with awaitable
  `setMatchMode()` and `setActiveProgram()` methods.
- Verify ESM, CommonJS, declarations, and embedded source content from packed
  artifacts.
- Port every public async API to return `neverthrow` `ResultAsync` values
  typed as `ResultAsync<T, VexSerialError>` instead of throwing or resolving
  to `null`/`false`/`undefined`. Added a `VexSerialError` hierarchy
  (`VexNotConnectedError`, `VexProtocolError`, `VexTransferError`,
  `VexDownloadError`, `VexFirmwareError`, `VexIoError`,
  `VexInvalidArgumentError`) with a stable `kind` discriminator so callers can
  branch on failure categories without parsing messages.
- Add `neverthrow` as a runtime dependency.

### @v5x/web 0.1.2 - 2026-07-08

- Add the public `@v5x/web/testing` entry point for browser integration tests.
