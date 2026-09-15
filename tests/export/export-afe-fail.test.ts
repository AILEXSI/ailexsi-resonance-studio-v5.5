import { afterEach, describe, expect, it } from "vitest";
import { getDecoder, resetFrameSourceBackend, setFrameSourceBackend } from "../../src/core/exporter/frame-source";
import { isAfeError } from "../../src/core/frame-engine";

afterEach(() => {
  resetFrameSourceBackend();
});

describe("typed AFE_* export failures (no HTMLVideo fallback)", () => {
  it("unplayable data: URL is AFE_UNSUPPORTED_CONTAINER", async () => {
    await expect(getDecoder("data:text/plain,nope")).rejects.toSatisfy(
      (e) => isAfeError(e) && e.code === "AFE_UNSUPPORTED_CONTAINER",
    );
  });

  it("htmlvideo identity cannot be used as a silent export fallback", async () => {
    setFrameSourceBackend("htmlvideo");
    await expect(getDecoder("https://127.0.0.1/clip.mp4")).rejects.toSatisfy(
      (e) => isAfeError(e) && e.code === "AFE_UNSUPPORTED_CONTAINER" && /HTMLVideo/.test(e.message),
    );
  });
});
