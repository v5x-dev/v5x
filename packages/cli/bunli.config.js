import { defineConfig } from "bunli";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  name: "@v5x/cli",
  version: pkg.version,
  description: pkg.description,

  commands: {
    directory: "./src/commands",
  },

  build: {
    entry: "./src/index.ts",
    outdir: "./dist",
    targets: ["native"],
    minify: true,
    sourcemap: true,
    compress: false,
  },

  dev: {
    watch: true,
    inspect: true,
  },

  test: {
    pattern: ["**/*.test.ts", "**/*.spec.ts"],
    coverage: true,
    watch: false,
  },

  plugins: [],
});
