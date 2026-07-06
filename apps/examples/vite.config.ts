import react from "@vitejs/plugin-react";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import solid from "vite-plugin-solid";
import { defineConfig } from "vite";

function packageRoot(name: string): string {
  return fileURLToPath(
    new URL(".", import.meta.resolve(`${name}/package.json`)),
  );
}

const reactRoot = packageRoot("react");
const reactDomRoot = packageRoot("react-dom");
const packages = resolve(import.meta.dirname, "../../packages");

export default defineConfig({
  plugins: [
    react({ exclude: [/src\/solid\//] }),
    solid({ include: [/src\/solid\//] }),
    svelte(),
  ],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "react/jsx-dev-runtime": resolve(reactRoot, "jsx-dev-runtime.js"),
      "react/jsx-runtime": resolve(reactRoot, "jsx-runtime.js"),
      react: reactRoot,
      "react-dom/client": resolve(reactDomRoot, "client.js"),
      "react-dom": reactDomRoot,
      "@v5x/web/client-internal": resolve(packages, "web/src/client.ts"),
      "@v5x/web/react": resolve(packages, "web/src/react/index.ts"),
      "@v5x/web/solid": resolve(packages, "web/src/solid/index.tsx"),
      "@v5x/web/svelte": resolve(packages, "web/src/svelte/index.ts"),
      "@v5x/web": resolve(packages, "web/src/index.ts"),
      "@v5x/serial": resolve(packages, "serial/src/index.ts"),
    },
  },
});
