import { AfeError } from "./errors";
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
    description: avc.description,
    optimizeForLatency: false,
  };
}
