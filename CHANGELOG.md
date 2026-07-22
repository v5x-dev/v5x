# Changelog

This repository versions `@v5x/cli`, `@v5x/events`, `@v5x/serial`, and
`@v5x/web` independently. Each release moves entries from the applicable
Unreleased section to a dated package-version heading.

## Unreleased

### @v5x/cli

### @v5x/events

- Replace page-oriented collection methods with `events.search()`,
  `teams.search()`, `programs.all()`, and `seasons.all()`, which retrieve every
  API page and return validated arrays.
- Add exact event and team lookup helpers, stable program and round constants,
  and plain-object URL and match utilities.
- Remove `list()`, `listPages()`, `matchesPages()`, `page`, and `perPage` ahead
  of the breaking `0.2.0` release.

### @v5x/serial

### @v5x/web

## Releases

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
