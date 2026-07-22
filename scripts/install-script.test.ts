import { expect, test } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

const installer = join(
  process.cwd(),
  "apps",
  "website",
  "public",
  "install.sh",
);

async function runInstaller(overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "v5x-installer-test-"));
  const bin = join(root, "bin");
  const temporaryDirectory = join(root, "tmp");
  const curlLog = join(root, "curl.log");
  const asset = join(root, "asset");
  const checksums = join(root, "SHA256SUMS");
  const realMkdir = Bun.which("mkdir");

  if (realMkdir === null) throw new Error("mkdir is required to run this test");

  await mkdir(bin);
  await mkdir(temporaryDirectory);
  await writeFile(asset, "#!/bin/sh\nexit 0\n");
  await writeFile(
    checksums,
    `${createHash("sha256")
      .update(await readFile(asset))
      .digest("hex")}  v5x-linux-x64\n`,
  );
  await writeFile(
    join(bin, "curl"),
    `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$MOCK_CURL_LOG"
output=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) output="$2"; shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
case "$url" in
  */SHA256SUMS) cp "$MOCK_CHECKSUMS" "$output" ;;
  *) cp "$MOCK_ASSET" "$output" ;;
esac
`,
  );
  await writeFile(
    join(bin, "mkdir"),
    `#!/bin/sh
set -eu
target=""
for argument in "$@"; do target="$argument"; done
case "$target" in
  "$MOCK_ROOT"/*) exec "$REAL_MKDIR" "$@" ;;
  *) printf 'test rejected write outside temporary directory: %s\\n' "$target" >&2; exit 1 ;;
esac
`,
  );
  await writeFile(
    join(bin, "uname"),
    `#!/bin/sh
case "\${1:-}" in
  -s) printf 'Linux\\n' ;;
  -m) printf 'x86_64\\n' ;;
  *) exit 1 ;;
esac
`,
  );
  await chmod(join(bin, "curl"), 0o755);
  await chmod(join(bin, "mkdir"), 0o755);
  await chmod(join(bin, "uname"), 0o755);

  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => name !== "HOME" && name !== "V5X_INSTALL_DIR",
    ),
  );
  const resolvedOverrides = Object.fromEntries(
    Object.entries(overrides).map(([name, value]) => [
      name,
      typeof value === "string" &&
      value !== "" &&
      !isAbsolute(value) &&
      (name === "HOME" || name === "V5X_INSTALL_DIR")
        ? join(root, value)
        : value,
    ]),
  );
  const subprocess = Bun.spawn(["sh", installer], {
    env: {
      ...environment,
      ...resolvedOverrides,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      TMPDIR: temporaryDirectory,
      V5X_VERSION: "1.2.3",
      MOCK_ASSET: asset,
      MOCK_CHECKSUMS: checksums,
      MOCK_CURL_LOG: curlLog,
      MOCK_ROOT: root,
      REAL_MKDIR: realMkdir,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ]);

  return {
    root,
    curlLog,
    stdout,
    stderr,
    exitCode,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test.each([
  ["missing", {}],
  ["empty", { HOME: "", V5X_INSTALL_DIR: "" }],
])(
  "fails before downloading when HOME and V5X_INSTALL_DIR are %s",
  async (_, environment) => {
    const result = await runInstaller(environment);

    try {
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("HOME or V5X_INSTALL_DIR must be set");
      expect(await Bun.file(result.curlLog).exists()).toBe(false);
    } finally {
      await result.cleanup();
    }
  },
);

test("uses an explicit destination without HOME", async () => {
  const result = await runInstaller({ V5X_INSTALL_DIR: "explicit-bin" });

  try {
    expect(result.exitCode).toBe(0);
    expect(
      await Bun.file(join(result.root, "explicit-bin", "v5x")).exists(),
    ).toBe(true);
  } finally {
    await result.cleanup();
  }
});

test("defaults to HOME/.local/bin", async () => {
  const result = await runInstaller({ HOME: "home", V5X_INSTALL_DIR: "" });

  try {
    expect(result.exitCode).toBe(0);
    expect(
      await Bun.file(
        join(result.root, "home", ".local", "bin", "v5x"),
      ).exists(),
    ).toBe(true);
  } finally {
    await result.cleanup();
  }
});
