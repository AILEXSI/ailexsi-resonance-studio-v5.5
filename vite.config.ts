/// <reference types="vitest/config" />
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };

function gitToken(args: string): string {
  try {
    const out = execSync(`git ${args}`, { cwd: root, encoding: "utf8" }).trim();
    return out || "unknown";
  } catch {
    return "unknown";
  }
}

/** STRESS-02 diagnostic EXE: production minify + usable source maps. */
const diagSourcemap = process.env.AILEXSI_DIAG_SOURCEMAP === "1";

/** Baked into EXE and Vite so AFE stall / export-fail dumps name the binary. */
const ailexsiBuildDefine = {
  __AILEXSI_PRODUCT_VERSION__: JSON.stringify(pkg.version || "5.5.0"),
  __AILEXSI_GIT_SHA__: JSON.stringify(gitToken("rev-parse --short HEAD")),
  __AILEXSI_GIT_BRANCH__: JSON.stringify(gitToken("rev-parse --abbrev-ref HEAD")),
  __AILEXSI_DIAG_SOURCEMAP__: JSON.stringify(diagSourcemap ? "1" : "0"),
};

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  define: ailexsiBuildDefine,
  esbuild: diagSourcemap ? { keepNames: true } : undefined,
  build: {
    // Default EXE stays minified without maps (unchanged runtime).
    // Diagnostic MODE-B: minify ON (same stack-depth shape) + maps + keepNames.
    minify: true,
    sourcemap: diagSourcemap,
  },
  server: {
    port: 1421,
    strictPort: true,
    host: "127.0.0.1",
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["tests/setup.ts"],
  },
});
