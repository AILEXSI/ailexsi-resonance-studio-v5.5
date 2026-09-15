import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Project } from "../../core/models";
import { durationMsFromHandleDrag, transitionDurationSnapTargets } from "../../core/transition-handles";

export function DurationHandles({
  project,
  startMs,
  videoDurationMs,
  audioDurationMs,
  showAudio,
  testIdPrefix,
  onVideo,
  onAudio,
}: {
  project: Project;
  startMs: number;
  videoDurationMs: number;
  audioDurationMs: number;
  showAudio: boolean;
  testIdPrefix: string;
  onVideo: (durationMs: number) => void;
  onAudio: (audioDurationMs: number) => void;
}) {
  const lastRef = useRef(0);
  const [liveVideo, setLiveVideo] = useState<number | null>(null);
  const [liveAudio, setLiveAudio] = useState<number | null>(null);
  const zoom = project.zoomPxPerSec > 0 ? project.zoomPxPerSec : 80;
  const shownVideo = liveVideo ?? videoDurationMs;
  const shownAudio = liveAudio ?? audioDurationMs;
  const videoW = Math.max(28, (shownVideo / 1000) * zoom);
  const audioW = Math.max(8, (shownAudio / 1000) * zoom);

  const bind = (kind: "video" | "audio", originMs: number) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const originX = e.clientX;
    const targets = project.snap ? transitionDurationSnapTargets(project) : [];
    lastRef.current = originMs;
    const move = (ev: PointerEvent) => {
      const next = durationMsFromHandleDrag({
        originDurationMs: originMs,
        startMs,
        deltaPx: ev.clientX - originX,
        zoomPxPerSec: zoom,
        snap: project.snap,
        snapTargets: targets,
      });
      lastRef.current = next;
      if (kind === "video") setLiveVideo(next);
      else setLiveAudio(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (kind === "video") onVideo(lastRef.current);
      else onAudio(lastRef.current);
      setLiveVideo(null);
      setLiveAudio(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="cutter-duration-bar" data-testid={`${testIdPrefix}-duration-bar`}>
      <div className="cutter-duration-video" style={{ width: videoW }} data-testid={`${testIdPrefix}-duration-video`}>
        <span className="cutter-duration-label">{Math.round(shownVideo)}ms</span>
        <div
          className="transition-duration-handle video"
          data-testid={`${testIdPrefix}-duration-handle-video`}
          onPointerDown={bind("video", videoDurationMs)}
        />
      </div>
      {showAudio ? (
        <div className="cutter-duration-audio" style={{ width: audioW }} data-testid={`${testIdPrefix}-duration-audio`}>
          <div
            className="transition-duration-handle audio"
            data-testid={`${testIdPrefix}-duration-handle-audio`}
            onPointerDown={bind("audio", audioDurationMs)}
          />
        </div>
      ) : null}
    </div>
  );
}
