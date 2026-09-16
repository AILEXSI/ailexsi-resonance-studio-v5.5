import { AfeError } from "./errors";
import { patchAvcCBitstreamRestriction } from "./avc-sps";
import type { AfeAvcConfig } from "./types";

function hex2(n: number): string {
  return (n & 0xff).toString(16).padStart(2, "0");
}

/** Parse AVCDecoderConfigurationRecord (avcC payload, no box header). */
export function parseAvcC(record: Uint8Array, width: number, height: number): AfeAvcConfig {
  if (record.length < 7) {
    throw new AfeError("AFE_UNSUPPORTED_CODEC", "avcC too short");
  }
  const version = record[0] ?? 0;
  if (version !== 1) {
    throw new AfeError("AFE_UNSUPPORTED_CODEC", `avcC version ${version}`);
  }
  const profileIndication = record[1] ?? 0;
  const profileCompatibility = record[2] ?? 0;
  const levelIndication = record[3] ?? 0;
  const nalLengthSize = ((record[4] ?? 0) & 3) + 1;
  if (nalLengthSize !== 4 && nalLengthSize !== 2 && nalLengthSize !== 1) {
    throw new AfeError("AFE_UNSUPPORTED_CODEC", `nal length size ${nalLengthSize}`);
  }
  const description = record.slice();
  return {
    codec: `avc1.${hex2(profileIndication)}${hex2(profileCompatibility)}${hex2(levelIndication)}`,
    description,
    width,
    height,
    nalLengthSize,
    profileIndication,
    profileCompatibility,
    levelIndication,
  };
}

export function decoderConfigOf(avc: AfeAvcConfig): VideoDecoderConfig {
  return {
    codec: avc.codec,
    codedWidth: avc.width,
    codedHeight: avc.height,
    /**
     * STRESS-01: Chromium VideoDecoder drops the first disposable B after an
     * IDR (human/Chrome: PTS 100000 absent, later timestamps emitted) when
     * VUI bitstream_restriction is missing. Communicate inferred DPB / reorder
     * depth in avcC. No-op when the flag is already present (AFE-25 analog).
     * Exact PTS mapping is unchanged.
     */
    description: patchAvcCBitstreamRestriction(avc.description),
    optimizeForLatency: false,
    /**
     * CASE B (AFE-25): WebView2 hardware decode can swallow the last delayed
     * B-frame at EOS (human: 5958333 never emitted, lastDecoded 5916667)
     * even when VUI bitstream_restriction is already present. Chrome software
     * emits the frame. Export-only; exact PTS unchanged.
     */
    hardwareAcceleration: "prefer-software",
  };
}
