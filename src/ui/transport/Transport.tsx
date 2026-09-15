import { FRAME_MS, formatTimecode, type Project } from "../../core/models";
import { CLIP_MENU_SHORTCUTS } from "../shortcuts/labels";
import { TimecodeField } from "./TimecodeField";

interface Props {
  project: Project;
  playing: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onStep: (deltaMs: number) => void;
  onToggleLoop: () => void;
  followPlayhead?: boolean;
  onToggleFollow?: () => void;
  onIn: () => void;
  onOut: () => void;
  onClear: () => void;
  onMarker: () => void;
  onSplit: () => void;
  onSeek?: (ms: number) => void;
  snap?: boolean;
  onToggleSnap?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onToggleShortcuts?: () => void;
}

export function Transport(props: Props) {
  return (
    <div className="transport" data-testid="transport">
      <button type="button" onClick={props.onPlay} disabled={props.playing}>
        Play
      </button>
      <button type="button" onClick={props.onPause} disabled={!props.playing}>
        Pause
      </button>
      <button type="button" onClick={props.onStop}>
        Stop
      </button>
      <button type="button" onClick={() => props.onStep(-FRAME_MS)}>
        −1f
      </button>
      <button type="button" onClick={() => props.onStep(FRAME_MS)}>
        +1f
      </button>
      <button type="button" className={props.project.loop ? "active" : ""} onClick={props.onToggleLoop}>
        Loop
      </button>
      {props.onToggleFollow ? (
        <button
          type="button"
          className={props.followPlayhead !== false ? "active" : ""}
          data-testid="follow-playhead"
          title="Keep playhead in view"
          onClick={props.onToggleFollow}
        >
          Follow
        </button>
      ) : null}
      <button type="button" onClick={props.onIn}>
        IN
      </button>
      <button type="button" onClick={props.onOut}>
        OUT
      </button>
      <button type="button" onClick={props.onClear}>
        Clear
      </button>
      <button type="button" onClick={props.onMarker}>
        Marker
      </button>
      <button type="button" title={`Split (${CLIP_MENU_SHORTCUTS.split})`} onClick={props.onSplit}>
        Split
        <kbd className="btn-kbd">{CLIP_MENU_SHORTCUTS.split}</kbd>
      </button>
      <TimecodeField playheadMs={props.project.playheadMs} onSeek={props.onSeek} />
      <span className="transport-marks">
        <button
          type="button"
          data-testid="goto-in"
          title="Go to IN"
          disabled={props.project.inPointMs == null}
          onClick={() => {
            if (props.project.inPointMs != null) props.onSeek?.(props.project.inPointMs);
          }}
        >
          IN {props.project.inPointMs == null ? "—" : formatTimecode(props.project.inPointMs)}
        </button>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          data-testid="goto-out"
          title="Go to OUT"
          disabled={props.project.outPointMs == null}
          onClick={() => {
            if (props.project.outPointMs != null) props.onSeek?.(props.project.outPointMs);
          }}
        >
          OUT {props.project.outPointMs == null ? "—" : formatTimecode(props.project.outPointMs)}
        </button>
      </span>
      {props.onUndo ? (
        <button type="button" data-testid="transport-undo" title="Undo (Ctrl+Z)" onClick={props.onUndo}>
          Undo
        </button>
      ) : null}
      {props.onRedo ? (
        <button type="button" data-testid="transport-redo" title="Redo (Ctrl+Y)" onClick={props.onRedo}>
          Redo
        </button>
      ) : null}
      {props.onToggleSnap ? (
        <button
          type="button"
          className={props.snap ? "active" : ""}
          data-testid="transport-snap"
          aria-pressed={props.snap === true}
          onClick={props.onToggleSnap}
        >
          Snap
        </button>
      ) : null}
      {props.onToggleShortcuts ? (
        <button
          type="button"
          data-testid="shortcuts-help"
          title="Shortcuts (?)"
          onClick={props.onToggleShortcuts}
        >
          Help
          <kbd className="btn-kbd">?</kbd>
        </button>
      ) : null}
    </div>
  );
}
