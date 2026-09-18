import { type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { OverflowMenuPlacement } from "./track-header-overflow";

export function TrackHeaderOverflowButton({
  trackId,
  open,
  onToggle,
}: {
  trackId: string;
  open: boolean;
  onToggle: (anchor: HTMLElement) => void;
}) {
  return (
    <button
      type="button"
      className={`lane-overflow-btn${open ? " open" : ""}`}
      data-testid={`lane-overflow-${trackId}`}
      data-header-control="overflow"
      title="More track controls"
      aria-label="More track controls"
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(e.currentTarget);
      }}
    >
      ▾
    </button>
  );
}

export function TrackHeaderOverflowMenu({
  trackId,
  open,
  left,
  top,
  maxHeight,
  placement,
  constrained,
  children,
}: {
  trackId: string;
  open: boolean;
  left: number;
  top: number;
  maxHeight?: number;
  placement?: OverflowMenuPlacement;
  constrained?: boolean;
  children: ReactNode;
}) {
  const node = (
    <div
      className="clip-menu lane-overflow-menu"
      data-testid={`lane-overflow-menu-${trackId}`}
      data-header-slot="overflow"
      data-overflow-placement={placement ?? "below"}
      data-overflow-constrained={constrained ? "true" : "false"}
      hidden={!open}
      role="menu"
      style={{
        left,
        top,
        maxHeight: maxHeight && maxHeight > 0 ? maxHeight : undefined,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
  if (typeof document === "undefined") return node;
  return createPortal(node, document.body);
}
