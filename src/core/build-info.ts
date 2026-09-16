/**
 * Build identity baked at Vite/Tauri frontend compile time.
 * Single source for stall dumps and export fail dialog text.
 * Product version stays 5.5.0 / schema 5. SHA comes from
 * `git rev-parse --short HEAD` via vite define (see vite.config.ts).
 */

export const AILEXSI_FRAME_ENGINE = "AILEXSI";
export const AILEXSI_PRODUCT_VERSION = "5.5.0";

function definedToken(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.length > 0 && value !== "undefined") return value;
  return fallback;
}

export const AILEXSI_GIT_SHA = definedToken(
  typeof __AILEXSI_GIT_SHA__ !== "undefined" ? __AILEXSI_GIT_SHA__ : undefined,
  "unknown",
);

export const AILEXSI_GIT_BRANCH = definedToken(
  typeof __AILEXSI_GIT_BRANCH__ !== "undefined" ? __AILEXSI_GIT_BRANCH__ : undefined,
  "unknown",
);

export const AILEXSI_BAKED_PRODUCT_VERSION = definedToken(
  typeof __AILEXSI_PRODUCT_VERSION__ !== "undefined" ? __AILEXSI_PRODUCT_VERSION__ : undefined,
  AILEXSI_PRODUCT_VERSION,
);

export type AilexsiBuildIdentity = {
  productVersion: string;
  gitSha: string;
  frameEngine: string;
  branch: string;
};

export function ailexsiBuildIdentity(): AilexsiBuildIdentity {
  return {
    productVersion: AILEXSI_BAKED_PRODUCT_VERSION || AILEXSI_PRODUCT_VERSION,
    gitSha: AILEXSI_GIT_SHA,
    frameEngine: AILEXSI_FRAME_ENGINE,
    branch: AILEXSI_GIT_BRANCH,
  };
}

/** Compact dump/dialog ledger. Keep short — truncated EXE screenshots. */
export function formatBuildIdentityLedger(identity = ailexsiBuildIdentity()): string[] {
  return [
    `productVersion ${identity.productVersion}`,
    `gitSha ${identity.gitSha}`,
    `frameEngine ${identity.frameEngine}`,
    `branch ${identity.branch}`,
  ];
}

export function formatBuildIdentityPrefix(identity = ailexsiBuildIdentity()): string {
  return formatBuildIdentityLedger(identity).join("; ");
}

/** Prepend identity once so dump and fail-dialog share the same front fields. */
export function withBuildIdentityPrefix(text: string, identity = ailexsiBuildIdentity()): string {
  const prefix = formatBuildIdentityPrefix(identity);
  if (text.startsWith("productVersion ") || text.includes(`productVersion ${identity.productVersion}`)) {
    return text;
  }
  if (!text) return prefix;
  return `${prefix}; ${text}`;
}
