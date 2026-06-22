# @v5x/cli

A Bun-powered command-line interface for building and managing VEX V5 programs.

See the [complete CLI documentation](https://docs.v5x.dev/cli/overview) for workflows and command reference.

## Install

```sh
bun add --global @v5x/cli
```

The CLI supports PROS, vexide, and VEXcode C++ projects. The corresponding
compiler toolchain must be installed before building a project.

```sh
v5x install pros
v5x install vexide
```

## Programs

```sh
# Build the project in the current directory.
v5x build

# Build and upload to slot 2.
v5x upload --slot 2

# Upload an existing artifact without building.
v5x upload --slot 2 --no-build --file ./bin/monolith.bin

# Build, upload, and immediately start the program.
v5x run --slot 2

# Create a project directly from the built-in templates.
v5x new robot --type pros
v5x new robot --type vexide
```

`build`, `clean`, `upload`, and `run` accept an optional project directory.
Use `v5x <command> --help` for all options.

## Brain utilities

```sh
v5x devices
v5x dir
v5x cat slot_1.ini
v5x rm slot_1.bin
v5x screenshot
v5x kv get key
v5x kv set key value
```

## Development

```sh
bun install
bun run typecheck
bun run test
bun run build
```
