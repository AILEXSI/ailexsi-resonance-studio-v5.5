import {
  TRANSITION_AUDIO_MODES,
  type TransitionAudioMode,
} from "../../core/transition";

const LABELS: Record<TransitionAudioMode, string> = {
  cut: "CUT",
  crossfade: "CROSSFADE",
  keepA: "KEEP A",
  keepB: "KEEP B",
};

export function AudioButtons({
  value,
  durationMs,
  testIdPrefix,
  onPick,
  onDuration,
}: {
  value: TransitionAudioMode;
  durationMs: number;
  testIdPrefix: string;
  onPick: (audio: TransitionAudioMode) => void;
  onDuration: (audioDurationMs: number) => void;
}) {
  return (
    <div className="source-picks" data-testid={`${testIdPrefix}-audio`}>
      <span className="source-picks-label">Audio</span>
      {TRANSITION_AUDIO_MODES.map((audio) => (
        <button
          key={audio}
          type="button"
          className={`source-pick${value === audio ? " on" : ""}`}
          data-testid={`${testIdPrefix}-audio-${audio}`}
          aria-pressed={value === audio}
          onClick={() => onPick(audio)}
        >
          {LABELS[audio]}
        </button>
      ))}
      <label className="source-picks-duration">
        Duration
        <input
          type="number"
          min={0}
          data-testid={`${testIdPrefix}-audio-duration`}
          value={Math.round(durationMs)}
          onChange={(e) => onDuration(Number(e.target.value))}
        />
      </label>
    </div>
  );
}
