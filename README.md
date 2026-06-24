# v5x

This project is a collection of tools to make it very easy to develop on the V5 system, and make it easier to build on top of.

Read the full documentation at [docs.v5x.dev](https://docs.v5x.dev).

## Packages

### [@v5x/cli](https://github.com/v5x-dev/v5x/tree/main/packages/cli)

The CLI package is the main command-line interface for interacting with the v5x system. It is heavily inspired by [cargo-v5](https://github.com/vexide/cargo-v5) in the vexide ecosystem, but it works for every type of v5 program.

### [@v5x/serial](https://github.com/v5x-dev/v5x/tree/main/packages/serial)

This package is the low-level foundation that powers the CLI.

It implements the V5 serial communication protocol in TypeScript.

Instead of shelling out to external binaries, this package talks directly to the V5 brain over USB/serial.

This is a fork of [v5-serial-protocol](https://github.com/LemLib/v5-serial-protocol) with extra features and fixes, major props to [jerrylum](https://github.com/Jerrylum) and the [LemLib](https://github.com/LemLib) team for making this whole project possible.

### [@v5x/web](https://github.com/v5x-dev/v5x/tree/main/packages/web)

This package is a browser workflow layer for VEX V5 Web Serial applications.

It wraps `@v5x/serial` with a small subscription-based client that tracks connection status, Web Serial support, and normalized errors, and ships framework bindings for React, Svelte, and Solid via subpath exports.

## Documentation development

```sh
bun run docs:check
bun run docs:export
```

Run `bun run docs:dev` when you want to start the local Mintlify preview.
