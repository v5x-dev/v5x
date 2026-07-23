# Contributing

v5x uses Bun for dependency management, builds, tests, and docs validation.
Install the Bun version declared in `package.json`, then run:

```sh
bun install --frozen-lockfile
bun run check
```

The root `tsc` executable is TypeScript 7. The website's `astro check` keeps a
temporary TypeScript 6 API dependency because Astro does not yet support the
TypeScript 7 compiler API. This is the only permitted workspace-level
TypeScript dependency.

`bun run check` runs formatting, linting, typechecking, tests, package and app
builds, docs export, and docs validation. The expanded sequence is:

```sh
bun run format:check
bun run lint
bun run typecheck
bun run test
bun run build
bun run docs:check
```

Unit tests must not require connected VEX hardware. Model serial ports, packet
responses, timers, downloads, and process execution with deterministic fakes.
Hardware validation belongs in the separate opt-in harness; the default test
suite has to stay runnable for every contributor and CI. Maintainers can run
`v5x hardware-smoke` using the safety and cleanup instructions in
`apps/docs/cli/hardware-smoke.mdx` before releases or risky serial and CLI
changes.

Changes that affect a published package must add an entry to the Unreleased
section of `CHANGELOG.md` under `@v5x/cli`, `@v5x/serial`, `@v5x/web`, or the
relevant combination. Package versions are independent; move only the relevant
entries to a dated version heading when publishing.

Before a release, pack all publishable packages and run the same artifact
checks as CI. The checks install the tarballs outside the workspace and verify
ESM, CommonJS, declarations, the CLI executable, web package artifacts, source
maps, and package contents.

## Publishing packages

Publishable packages are released independently with package-version tags:

```sh
git tag @v5x/cli@0.0.22
git push origin @v5x/cli@0.0.22

git tag @v5x/serial@0.5.5
git push origin @v5x/serial@0.5.5

git tag @v5x/web@0.1.1
git push origin @v5x/web@0.1.1
```

Pushing one of those tags starts the release workflow for that package only.
The tag version must match the selected package's `package.json` version. The
workflow installs dependencies with Bun, packs the selected package, runs
`bun scripts/verify-package-tarballs.ts` against the generated tarball, and
publishes that same tarball with `npm publish --provenance --access public`.
CLI and web releases require the checked-out `@v5x/serial` version to already
be available from npm, and their packed manifests must depend on that exact
version.

Before pushing a tag, move the released package's notes out of the Unreleased
section and into a dated heading using this exact format:

```md
### @v5x/serial 0.5.5 - 2026-07-06
```

The release workflow fails if `CHANGELOG.md` does not contain a heading for the
tagged package and version with a valid calendar date in `YYYY-MM-DD` format.
The date does not have to match the day the workflow runs.

The workflow requests `id-token: write` for npm provenance and trusted
publishing. It tries trusted publishing first. If that attempt fails and an
`NPM_TOKEN` repository secret with publish access is configured, the publish
step retries with that token as `NODE_AUTH_TOKEN`. The token is available only
to that step.

To retry a release after npm has accepted the package, manually run the Release
workflow and provide the existing package tag (for example,
`@v5x/cli@0.0.25`). The workflow checks out and validates that tag, skips npm
when the exact version is already published, and resumes the CLI GitHub release
when applicable.
