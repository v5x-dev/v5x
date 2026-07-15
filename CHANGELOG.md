# Changelog

This repository versions `@v5x/cli`, `@v5x/serial`, and `@v5x/web`
independently. Each release moves entries from the applicable Unreleased
section to a dated package-version heading.

## Unreleased

### @v5x/cli

- Add verbose stack traces, colored error output, and documented exit codes.
- Publish the verified tarball and require its serial dependency to be released.

### @v5x/serial

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

### @v5x/web

- Isolate snapshot subscriber exceptions from connection lifecycle operations.
- Prevent delayed device-disconnect and refresh-failure cleanup from publishing
  stale lifecycle state over a newer disconnect or connection attempt.
- Publish the verified tarball and require its serial dependency to be released.

## Releases

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
