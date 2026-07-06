# Changelog

This repository versions `@v5x/cli`, `@v5x/serial`, and `@v5x/web`
independently. Each release moves entries from the applicable Unreleased
section to a dated package-version heading.

## Unreleased

### @v5x/cli

- Publish the CLI for Linux and macOS with Bun 1.3.14 or newer. Windows
  remains unsupported until the CLI has a compatible serial backend.
- Verify packed source maps, executable permissions, and package contents.

### @v5x/serial

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

### @v5x/web
