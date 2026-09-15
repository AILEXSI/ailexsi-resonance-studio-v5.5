import { useEffect, useMemo, useState } from "react";
import { orderedTracks, type MediaAsset, type Project, type TrackId } from "../../core/models";
import { displayMediaName, filterMediaAssets, type MediaKindFilter } from "../../core/media-display";
import { writeAssetDrag } from "../../core/media";
import { describeMissing } from "../../core/persistence";
import { binPosterKind, posterThumbForAsset } from "../timeline/ClipPreview";

interface Props {
  project: Project;
  targetTrackId: TrackId;
  selectedAssetId: string | null;
  onSelectAsset: (id: string | null) => void;
  onTargetTrack: (id: TrackId) => void;
  onPlace: (assetId: string) => void;
  onRelinkAsset?: (assetId: string) => void;
  posterOf?: (asset: MediaAsset) => Promise<string | null>;
}

export function MediaBrowser({
  project,
  targetTrackId,
  selectedAssetId,
  onSelectAsset,
  onTargetTrack,
  onPlace,
  onRelinkAsset,
  posterOf = posterThumbForAsset,
}: Props) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<MediaKindFilter>("all");
  const [posters, setPosters] = useState<Record<string, string>>({});
  const visible = useMemo(
    () => filterMediaAssets(project.assets, { query, kind }),
    [project.assets, query, kind],
  );
  useEffect(() => {
    let cancelled = false;
    const wanted = visible.filter((a) => binPosterKind(a));
    if (wanted.length === 0) return;
    void (async () => {
      const next: Record<string, string> = {};
      for (const asset of wanted) {
        const src = await posterOf(asset);
        if (cancelled) return;
        if (src) next[asset.id] = src;
      }
      if (!cancelled && Object.keys(next).length > 0) {
        setPosters((prev) => ({ ...prev, ...next }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, posterOf]);
  return (
    <aside className="panel" data-testid="media-browser">
      <h2>Media</h2>
      <p style={{ fontSize: 12, color: "var(--muted)" }}>
        Audio, video, and images (jpeg/png/webp/gif). Other types fail visibly.
      </p>
      <label style={{ fontSize: 12, color: "var(--muted)" }}>
        Target track{" "}
        <select
          value={targetTrackId}
          onChange={(e) => onTargetTrack(e.target.value as TrackId)}
        >
          {orderedTracks(project).map((track) => (
            <option key={track.id} value={track.id}>
              {track.name || track.id}
            </option>
          ))}
        </select>
      </label>
      <input
        type="search"
        value={query}
        placeholder="Search name…"
        data-testid="media-search"
        aria-label="Search media"
        style={{ display: "block", width: "100%", marginTop: 8, boxSizing: "border-box" }}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="media-kind-filter" data-testid="media-kind-filter" style={{ display: "flex", gap: 4, marginTop: 6 }}>
        {(["all", "video", "audio", "image"] as const).map((id) => (
          <button
            key={id}
            type="button"
            data-testid={`media-kind-${id}`}
            className={kind === id ? "active" : undefined}
            aria-pressed={kind === id}
            onClick={() => setKind(id)}
          >
            {id === "all" ? "All" : id}
          </button>
        ))}
      </div>
      <div style={{ marginTop: 10 }}>
        {project.assets.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>No media imported.</p>
        ) : visible.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 13 }} data-testid="media-empty-filter">
            No matching media.
          </p>
        ) : (
          visible.map((asset) => (
            <div
              key={asset.id}
              className={`media-item${selectedAssetId === asset.id ? " selected" : ""}${asset.missing ? " missing" : ""}`}
              title={asset.name}
              draggable
              data-testid={`media-item-${asset.id}`}
              data-asset-id={asset.id}
              data-asset-kind={asset.kind}
              onClick={() => onSelectAsset(asset.id)}
              onDoubleClick={() => onPlace(asset.id)}
              onDragStart={(e) => {
                writeAssetDrag(e.dataTransfer, asset.id);
                document.body.classList.add("media-asset-dragging");
              }}
              onDragEnd={() => {
                document.body.classList.remove("media-asset-dragging");
              }}
            >
              {posters[asset.id] ? (
                <img
                  className="media-thumb"
                  data-testid={`media-thumb-${asset.id}`}
                  src={posters[asset.id]}
                  alt=""
                />
              ) : null}
              <strong title={asset.name}>
                {asset.missing ? describeMissing(asset) : displayMediaName(asset.name)}
              </strong>
              <div className="media-meta">
                {asset.kind} · {(asset.durationMs / 1000).toFixed(2)}s
              </div>
              {asset.missing &&
              onRelinkAsset &&
              project.clips.some((c) => c.assetId === asset.id) ? (
                <button
                  type="button"
                  className="media-relink"
                  data-testid={`media-relink-${asset.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRelinkAsset(asset.id);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  Relink
                </button>
              ) : null}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
