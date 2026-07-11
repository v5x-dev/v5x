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
