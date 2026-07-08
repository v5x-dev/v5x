# v5x

Tools for developing on the VEX V5 system, and for building your own tools on top of it.

Read the full documentation at [docs.v5x.dev](https://docs.v5x.dev).

## Packages

### [@v5x/cli](https://github.com/v5x-dev/v5x/tree/main/packages/cli)

The command-line interface. Heavily inspired by [cargo-v5](https://github.com/vexide/cargo-v5) in the vexide ecosystem, but it works for every type of v5 program.

### [@v5x/serial](https://github.com/v5x-dev/v5x/tree/main/packages/serial)

The low-level foundation that powers the CLI: the V5 serial protocol implemented in TypeScript. Instead of shelling out to external binaries, it talks directly to the V5 brain over USB/serial.

This is a fork of [v5-serial-protocol](https://github.com/LemLib/v5-serial-protocol) with extra features and fixes, major props to [jerrylum](https://github.com/Jerrylum) and the [LemLib](https://github.com/LemLib) team for making this whole project possible.

### [@v5x/web](https://github.com/v5x-dev/v5x/tree/main/packages/web)

A browser workflow layer for v5 Web Serial applications. It wraps `@v5x/serial` with a small subscription-based client that tracks connection status, Web Serial support, and normalized errors. Framework bindings for React, Svelte, and Solid ship as subpath exports.

## Documentation development

```sh
bun run docs:check
bun run docs:export
```

Run `bun run docs:dev` to start the local Mintlify preview.
