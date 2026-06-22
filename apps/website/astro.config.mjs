// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://v5x.dev",
  vite: {
    plugins: [tailwindcss()],
  },
});
