import {
  TRANSITION_SOURCES,
  type TransitionSource,
} from "../../core/transition";

const LABELS: Record<TransitionSource, string> = {
  auto: "AUTO",
  vis: "VIS",
  V1: "V1",
  V2: "V2",
  black: "BLACK",
};

export function SourceButtons({
  value,
  testIdPrefix,
  onPick,
}: {
  value: TransitionSource;
  testIdPrefix: string;
  onPick: (source: TransitionSource) => void;
}) {
  return (
    <div className="source-picks" data-testid={`${testIdPrefix}-source`}>
      <span className="source-picks-label">Source</span>
      {TRANSITION_SOURCES.map((source) => (
        <button
          key={source}
          type="button"
          className={`source-pick${value === source ? " on" : ""}`}
          data-testid={`${testIdPrefix}-source-${source}`}
          aria-pressed={value === source}
          onClick={() => onPick(source)}
        >
          {LABELS[source]}
        </button>
      ))}
    </div>
  );
}
