import {
  projectPanelView,
  type ProjectFileMemory,
  type RecentProject,
} from "../../core/project-file";

interface Props {
  memory: ProjectFileMemory;
  onNew: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onOpen: () => void;
  onOpenFile?: (file: File) => void;
  onOpenLast?: () => void;
  onOpenRecent: (recent: RecentProject) => void;
}

export function ProjectFilePanel({
  memory,
  onNew,
  onSave,
  onSaveAs,
  onOpen,
  onOpenFile,
  onOpenLast,
  onOpenRecent,
}: Props) {
  const view = projectPanelView(memory);
  return (
    <section className="project-file-panel" data-testid="project-file-panel">
      <h2>Projekt</h2>
      <dl className="project-file-meta">
        <div>
          <dt>Datei</dt>
          <dd data-testid="project-file-name" title={view.fileName}>
            {view.fileName}
          </dd>
        </div>
        <div>
          <dt>Ordner</dt>
          <dd data-testid="project-file-folder" title={view.folderLabel}>
            {view.folderLabel}
          </dd>
        </div>
      </dl>
      {view.folderRemembered ? (
        <p className="project-file-hint" data-testid="project-folder-remembered">
          Ordner gemerkt
        </p>
      ) : (
        <p className="project-file-hint muted">Noch kein Projektordner.</p>
      )}
      <div className="project-file-actions">
        <button type="button" data-testid="project-new" onClick={onNew}>
          New
        </button>
        <button type="button" data-testid="save-project" onClick={onSave}>
          Speichern
        </button>
        <button type="button" data-testid="project-save-as" onClick={onSaveAs}>
          Speichern unter
        </button>
        <button type="button" data-testid="open-fsa" data-open-project onClick={onOpen}>
          Öffnen
        </button>
        <input
          type="file"
          accept=".json,application/json"
          hidden
          data-testid="open-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onOpenFile?.(file);
            e.target.value = "";
          }}
        />
        {memory.lastFileName ? (
          <button
            type="button"
            data-testid="open-last"
            title={memory.lastFileName}
            onClick={onOpenLast ?? onOpen}
          >
            Zuletzt
          </button>
        ) : null}
      </div>
      <h3>Zuletzt</h3>
      {memory.recents.length === 0 ? (
        <p className="project-file-hint muted">Keine zuletzt geöffneten Projekte.</p>
      ) : (
        <ul className="project-file-recents" data-testid="project-recents">
          {memory.recents.map((recent) => {
            const folder = recent.directoryHandle?.name;
            return (
              <li key={recent.lastFileName}>
                <button
                  type="button"
                  data-testid={`project-recent-${recent.lastFileName}`}
                  title={folder ? `${recent.lastFileName} · ${folder}` : recent.lastFileName}
                  onClick={() => onOpenRecent(recent)}
                >
                  <span className="recent-name">{recent.lastFileName}</span>
                  {folder ? <span className="recent-folder">{folder}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
