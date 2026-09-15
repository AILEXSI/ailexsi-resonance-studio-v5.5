import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN = /mediabunny/i;

function walk(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === "dist" || name === "target") continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) walk(path, files);
    else files.push(path);
  }
  return files;
}

describe("MEDIABUNNY ABSENCE GATE", () => {
  it("package.json has no mediabunny dependency", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.mediabunny).toBeUndefined();
    expect(pkg.devDependencies?.mediabunny).toBeUndefined();
    expect(JSON.stringify(pkg)).not.toMatch(FORBIDDEN);
  });

  it("package-lock.json has no mediabunny package", () => {
    const lock = readFileSync("package-lock.json", "utf8");
    expect(lock).not.toMatch(/"mediabunny"/);
    expect(lock).not.toMatch(/node_modules\/mediabunny/);
  });

  it("src/ has no mediabunny import or backend identity", () => {
    const files = walk("src").filter((f) => /\.(ts|tsx|js|jsx)$/.test(f));
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (FORBIDDEN.test(text)) hits.push(file);
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("runtime export path cannot construct a mediabunny backend", () => {
    const src = readFileSync("src/core/exporter/frame-source.ts", "utf8");
    const backend = readFileSync("src/core/frame-engine/backend.ts", "utf8");
    expect(src).not.toMatch(FORBIDDEN);
    expect(backend).not.toMatch(FORBIDDEN);
    expect(src).toMatch(/ailexsi/);
  });

  it("dist/ if present has no mediabunny identifiers", () => {
    if (!existsSync("dist")) return;
    const files = walk("dist");
    const hits: string[] = [];
    for (const file of files) {
      if (!/\.(js|css|html|map|json)$/.test(file)) continue;
      const text = readFileSync(file, "utf8");
      if (FORBIDDEN.test(text)) hits.push(file);
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });
});
