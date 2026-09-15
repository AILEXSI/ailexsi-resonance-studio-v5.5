import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { VOLUME_LANE_HEIGHT_PX, fixedLaneBoxStyle } from "../../core/layout-prefs";
import type { Project, TrackId, VolumeAutomation } from "../../core/models";
import { RULER_PAD_PX } from "../../core/zoom";
import {
  dbToFader,
  dbToLinear,
  faderToDb,
  formatDb,
  linearToDb,
} from "../../core/volume";
import {
  automationValueAt,
  defaultVolumeAutomation,
  volumeAutomationOf,
} from "../../core/volume-automation";

function msToX(ms: number, zoom: number, scrollMs: number): number {
  return RULER_PAD_PX + ((ms - scrollMs) / 1000) * zoom;
}

function xToMs(x: number, zoom: number, scrollMs: number): number {
  return scrollMs + ((x - RULER_PAD_PX) / zoom) * 1000;
}

function valueToY(value: number, height: number): number {
  const pos = dbToFader(linearToDb(value));
  return (1 - pos) * Math.max(1, height);
}

function yToValue(y: number, height: number): number {
  const h = Math.max(1, height);
  const pos = 1 - Math.max(0, Math.min(1, y / h));
  return dbToLinear(faderToDb(pos));
}

function envelopePath(
  automation: VolumeAutomation,
  width: number,
  height: number,
  zoom: number,
  scrollMs: number,
  durationMs: number,
): string {
  const startMs = scrollMs;
  const endMs = scrollMs + (Math.max(1, width) / Math.max(0.05, zoom)) * 1000;
  const points = automation.points;
  if (points.length === 0) {
    const y = valueToY(1, height);
    return `M 0 ${y.toFixed(1)} L ${width} ${y.toFixed(1)}`;
  }
  const samples: { x: number; y: number }[] = [];
  const times = new Set<number>([startMs, endMs, ...points.map((p) => p.timeMs)]);
  if (durationMs > 0) times.add(durationMs);
  const sorted = [...times].filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  for (const t of sorted) {
    samples.push({
      x: msToX(t, zoom, scrollMs),
      y: valueToY(automationValueAt({ ...automation, enabled: true }, t), height),
    });
  }
  if (samples.length === 0) return "";
  return samples
    .map((s, i) => `${i === 0 ? "M" : "L"} ${s.x.toFixed(1)} ${s.y.toFixed(1)}`)
    .join(" ");
}

export function VolumeAutomationLane(props: {
  project: Project;
  trackId: TrackId;
  selectedTimeMs: number | null;
  onToggle: () => void;
  onSetEnabled: (enabled: boolean) => void;
  onSelectPoint: (timeMs: number | null) => void;
  onAddPoint: (timeMs: number, value: number) => void;
  onDeletePoint: (timeMs: number) => void;
  onPointLive: (fromTimeMs: number, timeMs: number, value: number) => void;
  onPointCommit: () => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const dragFromRef = useRef<number | null>(null);
  const track = props.project.tracks.find((t) => t.id === props.trackId);
  const automation = volumeAutomationOf(track) ?? defaultVolumeAutomation();
  const zoom = props.project.zoomPxPerSec;
  const scrollMs = props.project.scrollMs;
  const height = VOLUME_LANE_HEIGHT_PX;
  const unityY = valueToY(1, height);
  const durationMs = Math.max(
    props.project.outPointMs ?? 0,
    ...props.project.clips.map((c) => c.startMs + c.durationMs),
    1000,
  );

  const localFromClient = (e: { clientX: number; clientY: number }) => {
    const body = bodyRef.current;
    if (!body) return null;
    const rect = body.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    return {
      timeMs: Math.max(0, xToMs(x, zoom, scrollMs)),
      value: yToValue(y, rect.height || height),
    };
  };

  const onBodyPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const local = localFromClient(e);
    if (!local) return;
    const hit = automation.points.find((p) => {
      const px = msToX(p.timeMs, zoom, scrollMs);
      const py = valueToY(p.value, bodyRef.current?.clientHeight || height);
      const body = bodyRef.current!.getBoundingClientRect();
      const x = e.clientX - body.left;
      const y = e.clientY - body.top;
      return Math.hypot(px - x, py - y) <= 8;
    });
    if (hit) {
      props.onSelectPoint(hit.timeMs);
      return;
    }
    props.onAddPoint(local.timeMs, local.value);
  };

  const onPointPointerDown = (e: ReactPointerEvent<HTMLButtonElement>, timeMs: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    props.onSelectPoint(timeMs);
    dragFromRef.current = timeMs;
    const move = (ev: PointerEvent) => {
      const from = dragFromRef.current;
      if (from == null) return;
      const local = localFromClient(ev);
      if (!local) return;
      props.onPointLive(from, local.timeMs, local.value);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      dragFromRef.current = null;
      props.onPointCommit();
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const selectedDb =
    props.selectedTimeMs != null
      ? formatDb(linearToDb(automation.points.find((p) => p.timeMs === props.selectedTimeMs)?.value ?? 1))
      : formatDb(linearToDb(automationValueAt({ ...automation, enabled: true }, props.project.playheadMs)));

  return (
    <div
      className="lane volume-lane"
      data-testid={`volume-lane-${props.trackId}`}
      data-enabled={automation.enabled ? "true" : "false"}
      style={fixedLaneBoxStyle(height)}
    >
      <div
        className="lane-label volume-lane-label"
        data-testid={`volume-lane-label-${props.trackId}`}
        data-header-pack="pack"
      >
        <div className="volume-lane-head">
          <span className="volume-lane-title">VOL</span>
          <button
            type="button"
            className="volume-lane-close"
            data-testid={`volume-lane-close-${props.trackId}`}
            title="Hide volume lane"
            onClick={(e) => {
              e.stopPropagation();
              props.onToggle();
            }}
          >
            ×
          </button>
        </div>
        <div className="volume-lane-meta">
          <label className="volume-lane-enable">
            <input
              type="checkbox"
              checked={automation.enabled}
              data-testid={`volume-lane-enabled-${props.trackId}`}
              aria-label={`${track?.name ?? props.trackId} volume automation`}
              onChange={(e) => {
                props.onSetEnabled(e.target.checked);
                e.target.blur();
              }}
            />
            On
          </label>
          <span className="volume-lane-db" data-testid={`volume-lane-db-${props.trackId}`}>
            {selectedDb}
          </span>
        </div>
      </div>
      <div
        ref={bodyRef}
        className="lane-body volume-lane-body"
        data-testid={`volume-lane-${props.trackId}-body`}
        onPointerDown={onBodyPointerDown}
      >
        <svg className="volume-envelope" aria-hidden="true">
          <line
            className="volume-unity"
            x1="0"
            x2="100%"
            y1={unityY}
            y2={unityY}
          />
          <path
            className={`volume-envelope-path${automation.enabled ? " on" : ""}`}
            d={envelopePath(
              automation,
              bodyRef.current?.clientWidth ?? 800,
              height,
              zoom,
              scrollMs,
              durationMs,
            )}
          />
        </svg>
        {automation.points.map((point) => {
          const selected = props.selectedTimeMs === point.timeMs;
          return (
            <button
              key={point.timeMs}
              type="button"
              className={`volume-point${selected ? " selected" : ""}`}
              data-testid={`volume-point-${props.trackId}-${point.timeMs}`}
              data-selected={selected ? "true" : "false"}
              title={`${formatDb(linearToDb(point.value))} @ ${Math.round(point.timeMs)}ms`}
              style={{
                left: msToX(point.timeMs, zoom, scrollMs),
                top: valueToY(point.value, height),
              }}
              onPointerDown={(e) => onPointPointerDown(e, point.timeMs)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                props.onDeletePoint(point.timeMs);
              }}
            />
          );
        })}
        <div
          className="playhead"
          style={{ left: msToX(props.project.playheadMs, zoom, scrollMs) }}
        />
      </div>
    </div>
  );
}
