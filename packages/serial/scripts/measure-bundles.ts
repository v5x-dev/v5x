const entries = [
  ["complete", new URL("../src/index.ts", import.meta.url).pathname],
  ["packet-core", new URL("../src/VexPacketCore.ts", import.meta.url).pathname],
] as const;

for (const [name, entrypoint] of entries) {
  const result = await Bun.build({
    entrypoints: [entrypoint],
    target: "browser",
    format: "esm",
    minify: true,
    write: false,
    external: ["neverthrow", "unzipit"],
  });
  if (!result.success) {
    throw new AggregateError(result.logs, `Failed to build ${name}`);
  }
  const bytes = result.outputs.reduce(
    (total, output) => total + output.size,
    0,
  );
  console.log(`${name}: ${bytes} bytes minified`);
}
