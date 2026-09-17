/**
 * Shared LEXI palettes + title-safe band.
 * Used by flagship LEXI (V3) and LEXI Minimal Horizon (V2).
 */

import type { SceneParams } from "../types";

/** Prepared palettes. Default ships gold / champagne. */
export const LEXI_THEMES = {
  gold: {
    colorPrimary: "#e8a33a",
    colorSecondary: "#07060a",
    accent: "#1a3c48",
    champagne: "#ffd27a",
    highlight: "#fff4d4",
  },
  cyan: {
    colorPrimary: "#3ec8e0",
    colorSecondary: "#05080c",
    accent: "#143048",
    champagne: "#9ae8f2",
    highlight: "#e8fbff",
  },
  red: {
    colorPrimary: "#e05a3a",
    colorSecondary: "#0a0606",
    accent: "#3a1820",
    champagne: "#ffb08a",
    highlight: "#ffe8dc",
  },
  green: {
    colorPrimary: "#6ecb5a",
    colorSecondary: "#060a07",
    accent: "#163428",
    champagne: "#b8e89a",
    highlight: "#eef8e4",
  },
  violet: {
    colorPrimary: "#b06cff",
    colorSecondary: "#08060e",
    accent: "#241848",
    champagne: "#d4b0ff",
    highlight: "#f4ecff",
  },
} as const;

export type LexiThemeId = keyof typeof LEXI_THEMES;
export const LEXI_DEFAULT_THEME: LexiThemeId = "gold";

/** Center-safe title band (layout only — no on-screen text/logo). */
export const LEXI_TITLE_SAFE = { x0: 0.3, x1: 0.7, y0: 0.36, y1: 0.5 };

export function isLexiThemeId(value: string): value is LexiThemeId {
  return Object.prototype.hasOwnProperty.call(LEXI_THEMES, value);
}

export function resolveLexiTheme(params: SceneParams): (typeof LEXI_THEMES)[LexiThemeId] {
  const key = typeof params.palette === "string" ? params.palette : LEXI_DEFAULT_THEME;
  return isLexiThemeId(key) ? LEXI_THEMES[key] : LEXI_THEMES[LEXI_DEFAULT_THEME];
}
