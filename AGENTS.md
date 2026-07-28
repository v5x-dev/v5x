# v5x repository guide

## Package layering

Keep dependencies flowing in this direction:

```text
@v5x/serial ──> @v5x/node ──> @v5x/cli
      ├───────> @v5x/web
      └───────> @v5x/cli

@v5x/events (standalone)
@v5x/internal ──> @v5x/cli, @v5x/node, @v5x/events (build time only)
```

- `packages/serial` implements the transport-independent V5 protocol.
- `packages/node` supplies Node.js and Bun serial transports on top of
  `@v5x/serial`.
- `packages/web` supplies browser workflows and framework adapters on top of
  `@v5x/serial`.
- `packages/cli` is the executable application layer and may use `serial` and
  `node`.
- `packages/events` is a standalone VEX Events API client.
- `packages/internal` contains build-time-only workspace code shared across
  packages.

Do not introduce dependencies in the reverse direction.

## Published surface

Cleanup work is internal by default. Preserve every published export name and
package import path unless a change is explicitly designated as breaking.

The public entrypoints are defined by each published package's `exports` map:

- `packages/serial/src/index.ts` and `packages/serial/src/packet-core.ts`
- `packages/node/src/index.ts`
- `packages/web/src/index.ts`, `testing.ts`, and the `react`, `solid`, and
  `svelte` entrypoints
- `packages/events/src/index.ts`
- `packages/cli/src/index.ts` is the published executable entrypoint

Internal barrels may move implementations, but the symbols flowing through
these entrypoints must stay stable. Build before and after public-surface work
and compare the generated declarations. The package build verifiers and
`scripts/verify-package-tarballs.ts` are required release checks.

`@v5x/internal` is private. It must never be published, listed as a runtime
dependency of a published package, or left unresolved in a package tarball.
Published packages bundle the internal helpers they use.

## Naming and imports

- Use kebab-case filenames throughout the repository.
- Keep established exported symbol prefixes such as `Vex*` and `V5*`; filename
  conventions do not imply public API renames.
- Files in `packages/serial` use explicit `.js` extensions in relative imports.
  TypeScript preserves those specifiers for the package's directly published
  ESM output, so they must already describe the runtime files.
- Files in `packages/cli` omit relative import extensions. The CLI targets Bun
  and is bundled from TypeScript source, so Bun resolves those source imports
  during the build.

Do not try to unify the two extension styles: they serve different build
targets.

## Tests

- Use `bun test` for the full test suite or `bun test <path>` while iterating.
- Test files are named `*.test.ts` or `*.test.tsx`.
- Reusable test-only helpers are named `*.test-support.ts`.
- Serial protocol fixtures and packet helpers belong in
  `packages/serial/src/protocol.test-support.ts`.
- Keep output assertions byte-stable. In particular, CLI refactors must pass
  `packages/cli/src/commands/output.test.ts` and
  `packages/cli/src/device.test.ts` without changing their expectations.

Run `bun run check` after each coherent phase. It checks formatting, lint,
types, tests, builds, entrypoints, and documentation.
