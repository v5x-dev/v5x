import { expect, test } from "bun:test";

import { verifyManifest } from "./verify-package-tarballs";

function cliManifest(serialVersion: string): Record<string, unknown> {
  return {
    name: "@v5x/cli",
    sideEffects: true,
    os: ["darwin", "linux"],
    engines: { bun: ">=1.3.14" },
    bin: { v5x: "./dist/index.js" },
    dependencies: { "@v5x/serial": serialVersion },
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
    verifyManifest("@v5x/cli", cliManifest("0.5.5"), "0.5.6"),
  ).toThrow("must depend on @v5x/serial");

  expect(() =>
    verifyManifest("@v5x/cli", cliManifest("0.5.6"), "0.5.6"),
  ).not.toThrow();
});

test("accepts the standalone events package manifest", () => {
  expect(() =>
    verifyManifest("@v5x/events", eventsManifest(), "0.5.6"),
  ).not.toThrow();
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
    'bun scripts/verify-package-tarballs.ts --serial-version "${{ steps.release.outputs.serial_version }}" "${tarballs[0]}"',
  );
  expect(workflow).toContain(
    'echo "tarball=${tarballs[0]}" >> "$GITHUB_OUTPUT"',
  );
  expect(workflow).toContain(
    'npm publish "${{ steps.package.outputs.tarball }}" --provenance --access public',
  );
  expect(verifier).toContain('"npm",\n      "install",');
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
