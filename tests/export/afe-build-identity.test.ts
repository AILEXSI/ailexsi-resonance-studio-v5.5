import { describe, expect, it } from "vitest";
import {
  AILEXSI_FRAME_ENGINE,
  AILEXSI_GIT_SHA,
  AILEXSI_PRODUCT_VERSION,
  ailexsiBuildIdentity,
  formatBuildIdentityPrefix,
  formatStallMessage,
  withBuildIdentityPrefix,
} from "../../src/core/frame-engine";
import { failExportDialog, openExportDialog } from "../../src/core/exporter/dialog";

describe("AFE dump build identity", () => {
  const id = ailexsiBuildIdentity();

  it("product version is 5.5.0 and frame engine is AILEXSI", () => {
    expect(AILEXSI_PRODUCT_VERSION).toBe("5.5.0");
    expect(id.productVersion).toBe("5.5.0");
    expect(id.frameEngine).toBe(AILEXSI_FRAME_ENGINE);
    expect(id.frameEngine).toBe("AILEXSI");
  });

  it("git SHA is baked at Vite config from git rev-parse --short HEAD", () => {
    expect(AILEXSI_GIT_SHA).toMatch(/^(?:unknown|[0-9a-f]{7,40})$/i);
    expect(id.gitSha).toBe(AILEXSI_GIT_SHA);
    expect(id.gitSha).not.toBe("");
    expect(id.branch.length).toBeGreaterThan(0);
  });

  it("stall dump front-loads productVersion / gitSha / frameEngine with lastSubmitted / soft / hard", () => {
    const text = formatStallMessage({
      sourceSampleRequested: 38,
      requestedSample: 38,
      requestedPtsUs: 1_625_000,
      lastSubmittedSample: 36,
      currentTargetRequiredSample: 44,
      softHighWater: 12,
      hardDependencyCeiling: 20,
      decodeQueueSize: 21,
    });
    expect(text.startsWith("productVersion 5.5.0; gitSha ")).toBe(true);
    const head = text.slice(0, 280);
    expect(head).toContain("productVersion 5.5.0");
    expect(head).toContain(`gitSha ${id.gitSha}`);
    expect(head).toContain("frameEngine AILEXSI");
    expect(head).toContain(`branch ${id.branch}`);
    expect(head).toContain("lastSubmittedSample 36");
    expect(head).toContain("softHighWater 12");
    expect(head).toContain("hardDependencyCeiling 20");
    expect(text).not.toMatch(/nearest|snap|allowSkip|Mediabunny|HTMLVideo/i);
  });

  it("export fail dialog prefixes the same identity and does not double-prefix", () => {
    const prefix = formatBuildIdentityPrefix();
    const failed = failExportDialog(
      openExportDialog({ fileName: "out.mp4", width: 1280, height: 720, fps: 30 }),
      "AFE_DECODE_STALL requested sample 38",
    );
    expect(failed.error).toBe(`${prefix}; AFE_DECODE_STALL requested sample 38`);
    expect(failed.error).toContain("productVersion 5.5.0");
    expect(failed.error).toContain("frameEngine AILEXSI");
    expect(withBuildIdentityPrefix(failed.error ?? "")).toBe(failed.error);
  });
});
