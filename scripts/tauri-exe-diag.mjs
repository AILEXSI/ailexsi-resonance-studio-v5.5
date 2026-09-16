/**
 * STRESS-02 diagnostic MODE-B EXE.
 * Production minify (same runtime shape) + source maps + keepNames.
 * Windows: npm run tauri:exe:diag
 * or: $env:AILEXSI_DIAG_SOURCEMAP="1"; npm run tauri:exe
 */
import { spawn } from "node:child_process";

process.env.AILEXSI_DIAG_SOURCEMAP = "1";

const child = spawn("npm", ["run", "tauri:exe"], {
  stdio: "inherit",
  env: process.env,
  shell: true,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
