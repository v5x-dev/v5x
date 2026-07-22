const entries = [
  ["root", new URL("../src/index.ts", import.meta.url).pathname],
  ["testing", new URL("../src/testing.ts", import.meta.url).pathname],
  ["react", new URL("../src/react/index.ts", import.meta.url).pathname],
  ["svelte", new URL("../src/svelte/index.ts", import.meta.url).pathname],
  ["solid", new URL("../src/solid/index.tsx", import.meta.url).pathname],
] as const;

const external = [
  "@v5x/serial",
  "neverthrow",
  "react",
  "svelte",
  "svelte/reactivity",
  "solid-js",
  "solid-js/web",
];

for (const [name, entrypoint] of entries) {
  const result = await Bun.build({
    entrypoints: [entrypoint],
    target: "browser",
    format: "esm",
    minify: true,
    write: false,
    external,
    jsx: { runtime: "automatic", importSource: "solid-js" },
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

const shared = await Bun.build({
  entrypoints: entries.map(([, entrypoint]) => entrypoint),
  root: new URL("../src", import.meta.url).pathname,
  target: "browser",
  format: "esm",
  splitting: true,
  minify: true,
  write: false,
  external,
  jsx: { runtime: "automatic", importSource: "solid-js" },
  naming: {
    entry: "[dir]/[name].js",
    chunk: "chunks/[name]-[hash].js",
  },
});
if (!shared.success) {
  throw new AggregateError(shared.logs, "Failed to build shared ESM output");
}
const sharedBytes = shared.outputs.reduce(
  (total, output) => total + output.size,
  0,
);
console.log(`shared ESM total: ${sharedBytes} bytes minified`);
