import { builtinModules, createRequire } from "node:module";
import { resolve } from "node:path";

import { defineConfig } from "vite";

const externals = [
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
  "node-pty",
  "ws",
];

const apiRequire = createRequire(resolve(__dirname, "../api/package.json"));

export default defineConfig({
  resolve: {
    alias: [
      // @xterm/headless 6.0.0 declares a `module` entry it does not ship; Node itself uses `main`.
      { find: /^@xterm\/headless$/, replacement: apiRequire.resolve("@xterm/headless") },
    ],
  },
  build: {
    outDir: resolve(__dirname, "../../dist/api"),
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, "../api/src/cli.ts"),
      formats: ["es"],
      fileName: () => "cli.js",
    },
    minify: false,
    sourcemap: true,
    target: "node22",
    rollupOptions: {
      external: externals,
      output: {
        entryFileNames: "cli.js",
      },
    },
  },
});
