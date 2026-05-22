# v5x

This project is a collection of tools to make it very easy to develop on the V5 system, and make it easier to build on top of.

## Packages

### [@v5x/cli](https://github.com/beanarchystudios/v5x/tree/main/packages/cli)

The CLI package is the main command-line interface for interacting with the v5x system. It is heavily inspired by [cargo-v5](https://github.com/vexide/cargo-v5) in the vexide ecosystem, but it works for every type of v5 program.

### [@v5x/serial](https://github.com/beanarchystudios/v5x/tree/main/packages/serial)

This package is the low-level foundation that powers the CLI.

It implements the V5 serial communication protocol in TypeScript.

Instead of shelling out to external binaries, this package talks directly to the V5 brain over USB/serial.
