import { SHORTCUT_ROWS } from "./labels";

interface Props {
  open: boolean;
  onClose?: () => void;
}

export function ShortcutsOverlay({ open, onClose }: Props) {
  if (!open) return null;
  return (
    <div
      className="shortcuts-overlay"
      data-testid="shortcuts"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        className="shortcuts-card"
        role="dialog"
        aria-label="Shortcuts"
        aria-modal="false"
        data-testid="shortcuts-sheet"
        data-fit-viewport="true"
      >
        <header className="shortcuts-card-head">
          <div>
            <h2>Shortcuts</h2>
            <p>Split is S. Save is Ctrl+S. Cut is Ctrl+X. Copy is Ctrl+C. Paste is Ctrl+V.</p>
          </div>
          <button
            type="button"
            className="shortcuts-close"
            data-testid="shortcuts-close"
            aria-label="Close"
            onClick={() => onClose?.()}
          >
            ×
          </button>
        </header>
        <dl className="shortcuts-list" data-testid="shortcuts-list" data-scroll="inner">
          {SHORTCUT_ROWS.map((row) => (
            <div key={row.key}>
              <dt>
                <kbd>{row.key}</kbd>
              </dt>
              <dd>{row.action}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
