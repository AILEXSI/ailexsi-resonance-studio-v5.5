/** VIS styles overlay placement — keep the panel on-screen and prefer up when the arranger is short. */

export const VIS_BROWSER_PANEL_WIDTH = 440;
export const VIS_BROWSER_PANEL_HEIGHT_EST = 480;
export const VIS_BROWSER_MARGIN = 8;
export const VIS_BROWSER_POS_KEY = "ailexsi.vis-browser-pos";

export type VisBrowserPos = { left: number; top: number };

export function clampVisBrowserPos(
  pos: VisBrowserPos,
  panel: { width: number; height: number } = {
    width: VIS_BROWSER_PANEL_WIDTH,
    height: VIS_BROWSER_PANEL_HEIGHT_EST,
  },
  viewport: { width: number; height: number } = { width: 1024, height: 768 },
  margin = VIS_BROWSER_MARGIN,
): VisBrowserPos {
  const maxLeft = Math.max(margin, viewport.width - panel.width - margin);
  const maxTop = Math.max(margin, viewport.height - panel.height - margin);
  return {
    left: Math.min(Math.max(margin, pos.left), maxLeft),
    top: Math.min(Math.max(margin, pos.top), maxTop),
  };
}

export function placeVisBrowserPanel(opts: {
  header: { top: number; right: number; bottom: number };
  panel?: { width: number; height: number };
  viewport?: { width: number; height: number };
  arrangerHeight?: number;
  lastPos?: VisBrowserPos | null;
}): VisBrowserPos {
  const panel = opts.panel ?? { width: VIS_BROWSER_PANEL_WIDTH, height: VIS_BROWSER_PANEL_HEIGHT_EST };
  const viewport = opts.viewport ?? { width: 1024, height: 768 };
  if (opts.lastPos) return clampVisBrowserPos(opts.lastPos, panel, viewport);

  const wouldClipBottom = opts.header.top + panel.height > viewport.height - VIS_BROWSER_MARGIN;
  const arrangerTight =
    opts.arrangerHeight != null && opts.arrangerHeight < panel.height + 48;
  const preferUp = wouldClipBottom || arrangerTight;
  const left = opts.header.right + VIS_BROWSER_MARGIN;
  const top = preferUp ? opts.header.top - panel.height - VIS_BROWSER_MARGIN : opts.header.top;
  return clampVisBrowserPos({ left, top }, panel, viewport);
}

export function readVisBrowserPos(storage?: Pick<Storage, "getItem"> | null): VisBrowserPos | null {
  try {
    const raw = (storage ?? (typeof localStorage === "undefined" ? null : localStorage))?.getItem(
      VIS_BROWSER_POS_KEY,
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<VisBrowserPos>;
    if (typeof parsed.left !== "number" || typeof parsed.top !== "number") return null;
    if (!Number.isFinite(parsed.left) || !Number.isFinite(parsed.top)) return null;
    return { left: parsed.left, top: parsed.top };
  } catch {
    return null;
  }
}

export function writeVisBrowserPos(
  pos: VisBrowserPos,
  storage?: Pick<Storage, "setItem"> | null,
): void {
  try {
    (storage ?? (typeof localStorage === "undefined" ? null : localStorage))?.setItem(
      VIS_BROWSER_POS_KEY,
      JSON.stringify(pos),
    );
  } catch {
    /* ignore quota / private mode */
  }
}
