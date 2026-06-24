import react from "@vitejs/plugin-react";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import solid from "vite-plugin-solid";
import { defineConfig } from "vite";

const root = resolve(import.meta.dirname, "../..");
const reactRoot = packageRoot("react");
const reactDomRoot = packageRoot("react-dom");

function packageRoot(name: string): string {
  return fileURLToPath(
    new URL(".", import.meta.resolve(`${name}/package.json`)),
  );
}

export default defineConfig({
  plugins: [
    react({
      exclude: [/src\/solid\//],
    }),
    solid({
      include: [/src\/solid\//],
    }),
    svelte(),
  ],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      {
        find: "react/jsx-dev-runtime",
        replacement: resolve(reactRoot, "jsx-dev-runtime.js"),
      },
      {
        find: "react/jsx-runtime",
        replacement: resolve(reactRoot, "jsx-runtime.js"),
      },
      {
        find: "react",
        replacement: reactRoot,
      },
      {
        find: "react-dom/client",
        replacement: resolve(reactDomRoot, "client.js"),
      },
      {
        find: "react-dom",
        replacement: reactDomRoot,
      },
      {
        find: "@v5x/web/client-internal",
        replacement: resolve(root, "packages/web/src/client.ts"),
      },
      {
        find: "@v5x/web/react",
        replacement: resolve(root, "packages/web/src/react/index.ts"),
      },
      {
        find: "@v5x/web/solid",
        replacement: resolve(root, "packages/web/src/solid/index.tsx"),
      },
      {
        find: "@v5x/web/svelte",
        replacement: resolve(root, "packages/web/src/svelte/index.ts"),
      },
      {
        find: "@v5x/web",
        replacement: resolve(root, "packages/web/src/index.ts"),
      },
      {
        find: "@v5x/serial",
        replacement: resolve(root, "packages/serial/src/index.ts"),
      },
    ],
  },
});
