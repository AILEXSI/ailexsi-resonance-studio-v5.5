import { useEffect, useRef, useState } from "react";
import { formatTimecode, parseTimecode } from "../../core/models";

interface Props {
  playheadMs: number;
  onSeek?: (ms: number) => void;
}

export function TimecodeField({ playheadMs, onSeek }: Props) {
  const printed = formatTimecode(playheadMs);
  const [draft, setDraft] = useState(printed);
  const focusedRef = useRef(false);
  const skipBlurCommit = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setDraft(printed);
  }, [printed]);

  const restore = () => {
    setDraft(printed);
  };

  const commit = () => {
    const parsed = parseTimecode(draft);
    if (parsed == null) {
      restore();
      return;
    }
    if (parsed !== playheadMs) onSeek?.(parsed);
    else setDraft(formatTimecode(playheadMs));
  };

  return (
    <input
      type="text"
      data-testid="timecode"
      aria-label="Playhead timecode"
      spellCheck={false}
      value={draft}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        focusedRef.current = false;
        if (skipBlurCommit.current) {
          skipBlurCommit.current = false;
          restore();
          return;
        }
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          commit();
          e.currentTarget.blur();
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          skipBlurCommit.current = true;
          restore();
          e.currentTarget.blur();
        }
      }}
    />
  );
}
