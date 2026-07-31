import { expect, test } from "bun:test";

import { parseArguments, verifyManifest } from "./verify-package-tarballs";

function cliManifest(
  serialVersion: string,
  nodeVersion = "0.1.0",
): Record<string, unknown> {
  return {
    name: "@v5x/cli",
    sideEffects: true,
    os: ["darwin", "linux", "win32"],
    engines: { bun: ">=1.3.14" },
    bin: { v5x: "./dist/index.js" },
    dependencies: {
      "@v5x/node": nodeVersion,
      "@v5x/serial": serialVersion,
    },
  };
}

function nodeManifest(serialVersion = "0.5.8"): Record<string, unknown> {
  return {
    name: "@v5x/node",
    type: "module",
    main: "./dist/index.js",
    module: "./dist/index.js",
    types: "./dist/index.d.ts",
    sideEffects: true,
    exports: {
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
      },
    },
    dependencies: { "@v5x/serial": serialVersion },
    peerDependenciesMeta: {
      "bun-serialport": { optional: true },
      serialport: { optional: true },
    },
  };
}

function eventsManifest(): Record<string, unknown> {
  return {
    name: "@v5x/events",
    type: "module",
    main: "./dist/index.js",
    module: "./dist/index.js",
    types: "./dist/index.d.ts",
    sideEffects: false,
    exports: {
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
      },
    },
  };
}

test("rejects unresolved workspace dependencies in packed CLI manifests", () => {
  expect(() => verifyManifest("@v5x/cli", cliManifest("workspace:*"))).toThrow(
    "must depend on @v5x/serial",
  );
});

test("requires the packed CLI manifest to use the release serial version", () => {
  expect(() =>
    verifyManifest("@v5x/cli", cliManifest("0.5.5"), { serial: "0.5.6" }),
  ).toThrow("must depend on @v5x/serial");

  expect(() =>
    verifyManifest("@v5x/cli", cliManifest("0.5.6"), { serial: "0.5.6" }),
  ).not.toThrow();
});

test("requires the packed CLI manifest to use the release node version", () => {
  expect(() =>
    verifyManifest("@v5x/cli", cliManifest("0.5.6", "workspace:*")),
  ).toThrow("must depend on @v5x/node");

  expect(() =>
    verifyManifest("@v5x/cli", cliManifest("0.5.6", "0.1.0"), {
      node: "0.1.1",
    }),
  ).toThrow("must depend on @v5x/node");

  expect(() =>
    verifyManifest("@v5x/cli", cliManifest("0.5.6", "0.1.1"), {
      node: "0.1.1",
    }),
  ).not.toThrow();
});

test("requires the packed CLI manifest to claim every supported platform", () => {
  const manifest = cliManifest("0.5.6");
  manifest.os = ["darwin", "linux"];

  expect(() =>
    verifyManifest("@v5x/cli", manifest, { serial: "0.5.6" }),
  ).toThrow("CLI platform, runtime, or executable metadata are invalid");
});

test("accepts the standalone node transport manifest", () => {
  expect(() =>
    verifyManifest("@v5x/node", nodeManifest("0.5.6"), { serial: "0.5.6" }),
  ).not.toThrow();
});

test("requires the node transport to keep native peers optional", () => {
  const manifest = nodeManifest();
  manifest.peerDependenciesMeta = { "bun-serialport": { optional: false } };

  expect(() => verifyManifest("@v5x/node", manifest)).toThrow(
    "must keep bun-serialport and serialport optional peer dependencies",
  );
});

test("requires the Node SerialPort peer to stay optional", () => {
  const manifest = nodeManifest();
  manifest.peerDependenciesMeta = {
    "bun-serialport": { optional: true },
    serialport: { optional: false },
  };

  expect(() => verifyManifest("@v5x/node", manifest)).toThrow(
    "must keep bun-serialport and serialport optional peer dependencies",
  );
});

test("accepts the standalone events package manifest", () => {
  expect(() =>
    verifyManifest("@v5x/events", eventsManifest(), { serial: "0.5.6" }),
  ).not.toThrow();
});

test("parses the release dependency version flags in any order", () => {
  expect(
    parseArguments([
      "--node-version",
      "0.1.0",
      "--serial-version",
      "0.5.8",
      "a.tgz",
    ]),
  ).toEqual({
    archives: ["a.tgz"],
    expected: { node: "0.1.0", serial: "0.5.8" },
  });

  expect(parseArguments(["a.tgz"])).toEqual({
    archives: ["a.tgz"],
    expected: {},
  });

  expect(() => parseArguments(["--node-version", "--serial-version"])).toThrow(
    "--node-version requires a concrete version",
  );
});

test("rejects invalid events package exports", () => {
  const manifest = eventsManifest();
  manifest.exports = {
    ".": { types: "./dist/index.d.ts", import: "./src/index.ts" },
  };

  expect(() => verifyManifest("@v5x/events", manifest)).toThrow(
    "@v5x/events . export metadata is invalid",
  );
});

test("the release workflow verifies and publishes the same tarball", async () => {
  const workflow = await Bun.file(".github/workflows/release.yml").text();
  const verifier = await Bun.file("scripts/verify-package-tarballs.ts").text();

  expect(workflow).toContain(
    'bun scripts/verify-package-tarballs.ts --serial-version "${{ steps.release.outputs.serial_version }}" --node-version "${{ steps.release.outputs.node_version }}" "${tarballs[0]}"',
  );
  expect(workflow).toContain(
    'echo "tarball=${tarballs[0]}" >> "$GITHUB_OUTPUT"',
  );
  expect(workflow).toContain('tarball="${{ steps.package.outputs.tarball }}"');
  expect(workflow).toContain(
    'npm publish "$tarball" --provenance --access public',
  );
  expect(verifier).toContain('"npm",\n      "install",');
});

test("manual releases resolve and check out an explicit existing package tag", async () => {
  const release = await Bun.file(".github/workflows/release.yml").text();

  expect(release).toContain(
    'description: "Existing package tag to release (for example, @v5x/cli@0.0.25)"',
  );
  expect(release).toContain("MANUAL_RELEASE_TAG: ${{ inputs.release_tag }}");
  expect(release).toContain('tag="$MANUAL_RELEASE_TAG"');
  expect(release).toContain('tag="${GITHUB_REF#refs/tags/}"');
  expect(release).toContain('git show-ref --verify --quiet "refs/tags/$tag"');
  expect(release).toContain(
    "ref: ${{ github.event_name == 'workflow_dispatch' && inputs.release_tag || github.ref }}",
  );
  expect(release).toContain(
    "if: ${{ needs.publish.outputs.package_name == '@v5x/cli' }}",
  );
});

test("npm publishing prefers OIDC and narrowly scopes its token fallback", async () => {
  const release = await Bun.file(".github/workflows/release.yml").text();

  expect(release).toContain(
    'published_version="$(npm view "${package_name}@${version}" version 2>/dev/null || true)"',
  );
  expect(release).toContain(
    "if: ${{ steps.npm.outputs.already_published != 'true' }}",
  );
  expect(release).toContain(
    'env -u NODE_AUTH_TOKEN npm publish "$tarball" --provenance --access public',
  );
  expect(release).toContain("NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}");
  expect(
    release.match(/NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}/g),
  ).toHaveLength(1);
});

test("CLI release assets can be resumed on the validated release tag", async () => {
  const release = await Bun.file(".github/workflows/release.yml").text();

  expect(release).toContain("ref: ${{ needs.publish.outputs.release_tag }}");
  expect(release).toContain('gh release view "$RELEASE_TAG"');
  expect(release).toContain(
    'gh release upload "$RELEASE_TAG" artifacts/* --clobber',
  );
  for (const target of [
    "linux-x64",
    "linux-arm64",
    "darwin-x64",
    "darwin-arm64",
  ]) {
    expect(release).toContain(target);
  }
  expect(release).toContain("sha256sum v5x-* > SHA256SUMS");
});

test("release-date documentation matches workflow validation", async () => {
  const release = await Bun.file(".github/workflows/release.yml").text();
  const contributing = await Bun.file("CONTRIBUTING.md").text();

  expect(release).toContain("with a valid calendar date in YYYY-MM-DD format");
  expect(contributing).toContain(
    "with a valid calendar date in `YYYY-MM-DD` format",
  );
  expect(contributing).not.toContain("UTC date of the workflow run");
});

test("the release and quality workflows include the events package", async () => {
  const release = await Bun.file(".github/workflows/release.yml").text();
  const quality = await Bun.file(".github/workflows/quality.yml").text();

  expect(release).toContain('- "@v5x/events@*"');
  expect(release).toContain('package_dir="packages/events"');
  expect(release).toContain('tarball_glob="v5x-events-*.tgz"');
  expect(quality).toContain("cd ../events");
  expect(quality).toContain("bun add ./v5x-events-*.tgz");
  expect(quality).toContain('import("@v5x/events")');
});

test("the release and quality workflows include the node transport", async () => {
  const release = await Bun.file(".github/workflows/release.yml").text();
  const quality = await Bun.file(".github/workflows/quality.yml").text();

  expect(release).toContain('- "@v5x/node@*"');
  expect(release).toContain('package_dir="packages/node"');
  expect(release).toContain('tarball_glob="v5x-node-*.tgz"');
  expect(release).toContain(
    'published_node_version="$(npm view "@v5x/node@${node_version}" version)"',
  );
  expect(quality).toContain("cd ../node");
  // The CLI depends on @v5x/node, which is not on npm until its first release,
  // so the smoke install has to override it to the packed tarball.
  expect(quality).toContain('packageJson.overrides = { "@v5x/node"');
  expect(quality).toContain(
    "bun add ./v5x-serial-*.tgz ./v5x-node-*.tgz ./v5x-cli-*.tgz",
  );
  expect(quality).toContain('import("@v5x/node")');
  expect(quality).toContain('type SerialBackend } from \\"@v5x/node\\"');
});

test("the release and quality workflows validate documentation", async () => {
  const release = await Bun.file(".github/workflows/release.yml").text();
  const quality = await Bun.file(".github/workflows/quality.yml").text();

  expect(release).toContain("run: bun run docs:check");
  expect(quality).toContain("run: bun run docs:check");
});
