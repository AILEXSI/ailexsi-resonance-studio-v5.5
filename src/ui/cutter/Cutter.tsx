import type { EditorCommand } from "../../app/commands";
import type { TransitionType } from "../../core/transition";
import {
  TRANSITION_TYPES,
  editPairAtProbe,
  findTransitionForPair,
  resolveEditPair,
  transitionAtProbe,
  transitionAudioDurationMs,
  transitionAudioOf,
  transitionSourceOf,
} from "../../core/transition";
import type { Project } from "../../core/models";
import { snapPlayheadSeek } from "../../core/timeline";
import { AudioButtons } from "./AudioButtons";
import { CutStrip } from "./CutStrip";
import { DurationHandles } from "./DurationHandles";
import { SourceButtons } from "./SourceButtons";

function assetLabel(project: Project, assetId: string): string {
  return project.assets.find((a) => a.id === assetId)?.name ?? assetId;
}

export function Cutter({
  project,
  selectedClipId,
  selectedClipIds,
  apply,
  onPlayhead,
  laneLabelPx,
}: {
  project: Project;
  selectedClipId: string | null;
  selectedClipIds: string[];
  apply: (cmd: EditorCommand) => void;
  onPlayhead?: (ms: number) => void;
  laneLabelPx?: number;
}) {
  const probe = snapPlayheadSeek(project, project.playheadMs);
  const pair =
    resolveEditPair(project, selectedClipIds.length ? selectedClipIds : selectedClipId ? [selectedClipId] : []) ??
    editPairAtProbe(project, probe);
  const stored = pair
    ? findTransitionForPair(project.transitions ?? [], pair.sourceA.id, pair.sourceB.id)
    : transitionAtProbe(project.transitions ?? [], probe);
  const type: TransitionType = stored?.type ?? "cut";
  const durationMs = stored?.durationMs ?? (pair ? Math.max(1, pair.overlapDurationMs) : 0);
  const audio = transitionAudioOf(stored);
  const audioDurationMs = transitionAudioDurationMs(stored);
  const source = transitionSourceOf(stored);

  return (
    <div className="cutter cutter-strip" data-testid="cutter">
      <div className="cutter-title">Cutter</div>
      <SourceButtons
        value={source}
        testIdPrefix="cutter"
        onPick={(next) => apply({ type: "setTransitionSource", source: next })}
      />
      <AudioButtons
        value={audio}
        durationMs={audioDurationMs}
        testIdPrefix="cutter"
        onPick={(next) => apply({ type: "setTransitionAudio", audio: next })}
        onDuration={(ms) => apply({ type: "setTransitionAudioDuration", audioDurationMs: ms })}
      />
      <CutStrip project={project} onPlayhead={(ms) => onPlayhead?.(ms)} laneLabelPx={laneLabelPx} />
      {!pair ? (
        <div className="cutter-empty" data-testid="cutter-empty">
          No edit. Select a clip that overlaps another video track.
        </div>
      ) : (
        <div className="cutter-edit" data-testid="cutter-edit">
          <div className="cutter-pair" data-testid="cutter-source-a">
            Source A {assetLabel(project, pair.sourceA.assetId)} {pair.sourceA.trackId}
          </div>
          <div className="cutter-pair" data-testid="cutter-source-b">
            Source B {assetLabel(project, pair.sourceB.assetId)} {pair.sourceB.trackId}
          </div>
          <label className="cutter-field">
            Type
            <select
              data-testid="cutter-type"
              value={type}
              onChange={(e) => apply({ type: "setTransition", transitionType: e.target.value as TransitionType })}
            >
              {TRANSITION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="cutter-field">
            Duration ms
            <input
              data-testid="cutter-duration"
              type="number"
              min={0}
              value={durationMs}
              onChange={(e) => apply({ type: "setTransition", durationMs: Number(e.target.value) })}
            />
          </label>
          <DurationHandles
            project={project}
            startMs={stored?.startMs ?? pair.overlapStartMs}
            videoDurationMs={durationMs}
            audioDurationMs={audioDurationMs}
            showAudio
            testIdPrefix="cutter"
            onVideo={(ms) => apply({ type: "setTransition", durationMs: ms })}
            onAudio={(ms) => apply({ type: "setTransitionAudioDuration", audioDurationMs: ms })}
          />
        </div>
      )}
    </div>
  );
}
