import { useMemo, useState } from "react";
import {
  CLASSIC_FAMILIES,
  LEXI_FAMILIES,
  SCENE_CATALOG,
  VIS_BROWSER_CATEGORIES,
  catalogEntriesFor,
  getCatalogEntry,
  type VisBrowserCategory,
  type VisualizerSceneId,
} from "../../core/visualz/scene-catalog";
import { sceneShortName } from "../../core/visualizer";

interface Props {
  value: VisualizerSceneId;
  onSelect: (sceneId: VisualizerSceneId) => void;
  /** Inspector stack, compact popover, or overall VIS-header overlay. */
  variant?: "inspector" | "popover" | "overlay";
  /** When true, panel is open on mount (overlay / explicit lane open). */
  defaultOpen?: boolean;
  /** Header is the trigger — hide the inner name button. */
  hideTrigger?: boolean;
  testIdPrefix?: string;
  onCycle?: () => void;
}

export function VisSceneBrowser({
  value,
  onSelect,
  variant = "inspector",
  defaultOpen,
  hideTrigger = false,
  testIdPrefix = "vis-browser",
  onCycle,
}: Props) {
  const current = getCatalogEntry(value);
  const startsOpen = defaultOpen ?? (variant === "inspector" || variant === "overlay");
  const [open, setOpen] = useState(startsOpen);
  const showTrigger = !hideTrigger && variant !== "overlay";
  const showPanel = variant === "overlay" || variant === "inspector" || open;
  const [category, setCategory] = useState<VisBrowserCategory>(current?.suite === "LEXI" ? "LEXI" : "ALL");
  const [family, setFamily] = useState<string | undefined>(
    current?.suite === "LEXI" ? current.family : undefined,
  );

  const families = category === "LEXI" ? LEXI_FAMILIES : category === "CLASSIC" ? CLASSIC_FAMILIES : undefined;
  const scenes = useMemo(
    () =>
      catalogEntriesFor({
        category,
        family: category === "ALL" ? undefined : family,
      }),
    [category, family],
  );

  const pickCategory = (next: VisBrowserCategory) => {
    setCategory(next);
    if (next === "LEXI") setFamily(current?.suite === "LEXI" ? current.family : "FLOW");
    else if (next === "CLASSIC") setFamily(undefined);
    else setFamily(undefined);
  };

  const pickFamily = (next: string) => {
    setFamily(next);
  };

  const pickScene = (id: VisualizerSceneId) => {
    onSelect(id);
    if (variant === "popover") setOpen(false);
  };

  return (
    <div className={`vis-scene-browser vis-scene-browser-${variant}`} data-testid={testIdPrefix}>
      {showTrigger ? (
        <button
          type="button"
          className="vis-scene-browser-trigger"
          data-testid={`${testIdPrefix}-trigger`}
          aria-expanded={showPanel}
          onClick={() => setOpen((v) => !v)}
        >
          {sceneShortName(value)}
        </button>
      ) : variant === "overlay" ? (
        <h3
          className="vis-scene-browser-title vis-scene-browser-drag"
          data-testid={`${testIdPrefix}-title`}
          title="Drag to move"
        >
          VIS styles
        </h3>
      ) : null}
      {showPanel ? (
        <div
          className="vis-scene-browser-panel"
          data-testid={`${testIdPrefix}-panel`}
          role="dialog"
          aria-label="VIS styles"
        >
          <div className="vis-scene-browser-row" data-testid={`${testIdPrefix}-categories`}>
            {VIS_BROWSER_CATEGORIES.map((id) => (
              <button
                key={id}
                type="button"
                className={category === id ? "active" : undefined}
                data-testid={`${testIdPrefix}-category-${id}`}
                onClick={() => pickCategory(id)}
              >
                {id}
              </button>
            ))}
          </div>
          {families ? (
            <div className="vis-scene-browser-row" data-testid={`${testIdPrefix}-families`}>
              {families.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={family === id ? "active" : undefined}
                  data-testid={`${testIdPrefix}-family-${id}`}
                  onClick={() => pickFamily(id)}
                >
                  {id === "PARTICLE" ? "PARTICLE / NEBULA" : id}
                </button>
              ))}
            </div>
          ) : null}
          <div className="vis-scene-browser-scenes" data-testid={`${testIdPrefix}-scenes`}>
            {scenes.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={entry.id === value ? "active" : undefined}
                data-testid={`${testIdPrefix}-scene-${entry.id}`}
                data-suite={entry.suite}
                data-family={entry.family}
                data-renderer={entry.renderer}
                title={entry.description}
                onClick={() => pickScene(entry.id)}
              >
                <span>{entry.displayName}</span>
                {entry.suite === "LEXI" ? <em>{entry.family}</em> : null}
              </button>
            ))}
            {scenes.length === 0 ? (
              <p className="vis-scene-browser-empty" data-testid={`${testIdPrefix}-empty`}>
                No scenes in this family yet.
              </p>
            ) : null}
          </div>
          {onCycle ? (
            <button
              type="button"
              className="vis-scene-browser-cycle"
              data-testid={`${testIdPrefix}-cycle`}
              onClick={onCycle}
            >
              Next in cycle
            </button>
          ) : null}
          <p className="vis-scene-browser-hint">
            {SCENE_CATALOG.length} scenes · click applies immediately
          </p>
        </div>
      ) : null}
    </div>
  );
}
