import { type ReactNode } from "react";

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
  children,
}: {
  trackId: string;
  open: boolean;
  left: number;
  top: number;
  children: ReactNode;
}) {
  return (
    <div
      className="clip-menu lane-overflow-menu"
      data-testid={`lane-overflow-menu-${trackId}`}
      data-header-slot="overflow"
      hidden={!open}
      role="menu"
      style={{ left, top }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}
