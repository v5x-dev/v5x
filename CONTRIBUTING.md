# Contributing

v5x uses Bun for dependency management, builds, and tests. Install the Bun
version declared in `package.json`, then run:

```sh
bun install --frozen-lockfile
bun run format:check
bun run lint
bun run typecheck
bun run test
bun run build
```

Do not require connected VEX hardware in unit tests. Model serial ports, packet
responses, timers, downloads, and process execution with deterministic fakes.
Hardware validation is useful as a separate manual check, but it must not make
the default test suite unavailable to contributors or CI.

Changes that affect a published package must add an entry to the Unreleased
section of `CHANGELOG.md` under `@v5x/cli`, `@v5x/serial`, or both. Package
versions are independent; move only the relevant entries to a dated version
heading when publishing.

Before a release, pack both packages and run the same artifact checks as CI.
The checks install the tarballs outside the workspace and verify ESM, CommonJS,
declarations, the CLI executable, source maps, and package contents.
