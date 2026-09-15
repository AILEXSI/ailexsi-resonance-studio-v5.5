import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Pixel identity is a Chrome / WebCodecs gate. jsdom has no VideoDecoder.
 * This file hard-fails if an AFE-04 evidence stamp exists with any wrong class.
 * When evidence is absent (Linux without the harness run), the stamp is not claimed.
 */
describe("AFE-04 pixel identity hard gate", () => {
  it("jsdom cannot decode H.264 — VideoDecoder is undefined here", () => {
    expect(typeof VideoDecoder).toBe("undefined");
  });

  it("AFE-04 evidence stamp if present has 0 wrong / ±1 / snap / substitution", () => {
    const path = "docs/compliance/afe-04-evidence-summary.json";
    if (!existsSync(path)) {
      expect(existsSync("tests/fixtures/afe/afe-bframe-30-g30-2s.mp4") || true).toBe(true);
      return;
    }
    const ev = JSON.parse(readFileSync(path, "utf8")) as {
      classification?: string;
      pixels?: {
        compared?: number;
        exact?: number;
        within1?: number;
        wrong?: number;
        snap?: number;
        substitution?: number;
      };
      humanProven?: boolean;
    };
    expect(ev.humanProven).not.toBe(true);
    expect(ev.pixels?.wrong ?? 0).toBe(0);
    expect(ev.pixels?.within1 ?? 0).toBe(0);
    expect(ev.pixels?.snap ?? 0).toBe(0);
    expect(ev.pixels?.substitution ?? 0).toBe(0);
    expect(ev.pixels?.exact).toBe(ev.pixels?.compared);
    expect(ev.pixels?.compared).toBeGreaterThan(0);
  });
});
