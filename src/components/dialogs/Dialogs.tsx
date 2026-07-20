/** Modal dialogs: project manager, export center, onboarding, confirm. */

import { useEffect, useRef, useState } from 'react';
import { useProjectStore, makeEmptyProject } from '@/state/projectStore';
import { useUiStore } from '@/state/uiStore';
import {
  listProjects,
  saveProjectToStorage,
  loadProjectFromStorage,
  deleteProjectFromStorage,
} from '@/state/persist';
import { EXAMPLES, getExample } from '@/examples';
import { loadProject } from '@/model/schema';
import { downloadProjectJson } from '@/export/exporters';
import { buildShareUrl } from '@/export/share';
import {
  exportWav,
  exportCsv,
  exportAnalyzerPng,
  exportDiagramPng,
  exportReport,
} from '@/export/appExports';
import { getNodeDef } from '@/engine/registry';
import { runCaptureNow } from '@/state/engines';
import { PROJECT_SCHEMA_VERSION } from '@/model/types';

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('button, input, select, textarea')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal aria-label={title} ref={ref}>
        <div className="modal-head">
          <span className="modal-title">{title}</span>
          <button type="button" className="btn small" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  text,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  text: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn danger"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p>{text}</p>
    </Modal>
  );
}

/* ---------------- Project manager ---------------- */

export function ProjectManagerDialog({ onClose }: { onClose: () => void }) {
  const project = useProjectStore((s) => s.project);
  const setProject = useProjectStore((s) => s.setProject);
  const toast = useUiStore((s) => s.toast);
  const [entries, setEntries] = useState(listProjects());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => setEntries(listProjects());

  const openProject = (id: string) => {
    const p = loadProjectFromStorage(id);
    if (!p) {
      toast('error', 'Could not load that project (data missing or corrupted).');
      return;
    }
    saveProjectToStorage(useProjectStore.getState().project);
    setProject(p);
    onClose();
  };

  const importFile = (file: File) => {
    file.text().then((text) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        toast('error', `Not valid JSON: ${err instanceof Error ? err.message : err}`);
        return;
      }
      const result = loadProject(parsed);
      if (!result.ok || !result.project) {
        toast('error', `Import failed: ${result.errors.join(' · ')}`);
        return;
      }
      for (const w of result.warnings.slice(0, 3)) toast('warn', w);
      // Assign a new id so imports never overwrite existing projects
      const imported = { ...result.project, id: makeEmptyProject().id };
      saveProjectToStorage(imported);
      setProject(imported);
      toast('ok', `Imported “${imported.name}”.`);
      onClose();
    });
  };

  return (
    <Modal title="Projects" onClose={onClose} wide>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            saveProjectToStorage(project);
            setProject(makeEmptyProject());
            onClose();
          }}
        >
          + New project
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            saveProjectToStorage(project);
            refresh();
            toast('ok', 'Project saved.');
          }}
        >
          Save current
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            const copy = {
              ...project,
              id: makeEmptyProject().id,
              name: `${project.name} (copy)`,
              graph: JSON.parse(JSON.stringify(project.graph)),
            };
            saveProjectToStorage(copy);
            setProject(copy);
            refresh();
            toast('ok', 'Duplicated project.');
          }}
        >
          Duplicate current
        </button>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
          Import JSON…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          data-testid="import-file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importFile(f);
            e.target.value = '';
          }}
        />
      </div>

      <div className="panel-label" style={{ marginBottom: 6 }}>
        Saved projects
      </div>
      {entries.length === 0 && (
        <p style={{ color: 'var(--text-dim)', fontSize: 12 }}>
          Nothing saved yet. Projects autosave as you work.
        </p>
      )}
      {entries.map((e) => (
        <div
          key={e.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 4px',
            borderBottom: '1px dashed var(--line-faint)',
          }}
        >
          <button
            type="button"
            className="lib-item"
            style={{ flex: 1 }}
            onClick={() => openProject(e.id)}
          >
            <span className="t">
              {e.name}
              {e.id === project.id ? '  ·  (open)' : ''}
            </span>
            <span className="b">modified {new Date(e.modifiedAt).toLocaleString()}</span>
          </button>
          <button
            type="button"
            className="btn small danger"
            aria-label={`Delete ${e.name}`}
            onClick={() => setConfirmDelete(e.id)}
          >
            Delete
          </button>
        </div>
      ))}

      <div className="panel-label" style={{ margin: '16px 0 6px' }}>
        Built-in examples
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {EXAMPLES.map((ex) => (
          <button
            key={ex.id}
            type="button"
            className="lib-item"
            data-testid={`example-${ex.id}`}
            onClick={() => {
              saveProjectToStorage(project);
              const p = getExample(ex.id)!;
              // Open as a fresh copy so users can modify freely
              setProject({ ...p, id: makeEmptyProject().id });
              onClose();
            }}
          >
            <span className="t">{ex.name}</span>
            <span className="b">{ex.description}</span>
          </button>
        ))}
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete project"
          text={`Delete “${entries.find((e) => e.id === confirmDelete)?.name}”? This cannot be undone.`}
          confirmLabel="Delete permanently"
          onConfirm={() => {
            deleteProjectFromStorage(confirmDelete);
            refresh();
          }}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </Modal>
  );
}

/* ---------------- Export center ---------------- */

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useProjectStore((s) => s.project);
  const ui = useUiStore();
  const toast = useUiStore((s) => s.toast);
  const captureRevision = useUiStore((s) => s.captureRevision);
  void captureRevision;
  const signalNodes = project.graph.nodes.filter((n) => getNodeDef(n.type).category !== 'analyze' || true);
  const analyzers = project.graph.nodes.filter((n) => getNodeDef(n.type).category === 'analyze');
  const defaultNode =
    project.graph.nodes.find((n) => n.type === 'out.audio')?.id ?? project.graph.nodes[0]?.id ?? '';
  const [nodeId, setNodeId] = useState(defaultNode);
  const [includeFormulas, setIncludeFormulas] = useState(true);
  const [share, setShare] = useState<{ url: string | null; length: number; tooLarge: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const needCapture = ui.runMode === 'capture' && ui.captureStatus !== 'done';

  const guard = (fn: () => boolean, what: string) => {
    if (!fn()) {
      toast(
        'warn',
        `No signal data at that node yet. ${ui.runMode === 'capture' ? 'Run a capture first.' : 'Press Play so the live engine produces samples, or switch to capture mode.'}`,
      );
    } else {
      toast('ok', `${what} exported.`);
    }
  };

  return (
    <Modal title="Export & Share" onClose={onClose} wide>
      {needCapture && (
        <div className="toast warn" style={{ marginBottom: 12 }}>
          Capture mode has no data yet —{' '}
          <button type="button" className="btn small" onClick={() => runCaptureNow()}>
            run a capture now
          </button>{' '}
          for deterministic, full-length exports.
        </div>
      )}

      <div className="panel-label" style={{ marginBottom: 6 }}>
        Signal data
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <label htmlFor="export-node" style={{ fontSize: 12 }}>
          Signal at
        </label>
        <select
          id="export-node"
          className="field"
          style={{ width: 240 }}
          value={nodeId}
          onChange={(e) => setNodeId(e.target.value)}
        >
          {signalNodes.map((n) => (
            <option key={n.id} value={n.id}>
              {getNodeDef(n.type).title} ({n.id.slice(-6)})
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn"
          data-testid="export-wav"
          onClick={() => guard(() => exportWav(nodeId), 'WAV')}
        >
          WAV (16-bit)
        </button>
        <button
          type="button"
          className="btn"
          data-testid="export-csv"
          onClick={() => guard(() => exportCsv(nodeId), 'CSV')}
        >
          CSV samples
        </button>
      </div>

      <div className="panel-label" style={{ marginBottom: 6 }}>
        Images
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {analyzers.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            Add an analyzer node to export instrument images.
          </span>
        )}
        {analyzers
          .filter((n) => n.type !== 'ana.stats')
          .map((n) => (
            <button
              key={n.id}
              type="button"
              className="btn"
              onClick={() =>
                exportAnalyzerPng(n.id)
                  .then(() => toast('ok', 'Analyzer image exported.'))
                  .catch((err) => toast('warn', String(err.message ?? err)))
              }
            >
              {getNodeDef(n.type).title} PNG
            </button>
          ))}
        <button
          type="button"
          className="btn"
          onClick={() =>
            exportDiagramPng()
              .then(() => toast('ok', 'Diagram exported.'))
              .catch((err) => toast('warn', String(err.message ?? err)))
          }
        >
          Signal-chain diagram PNG
        </button>
      </div>

      <div className="panel-label" style={{ marginBottom: 6 }}>
        Project
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
        <button
          type="button"
          className="btn"
          data-testid="export-json"
          onClick={() => {
            downloadProjectJson(project);
            toast('ok', 'Project JSON exported.');
          }}
        >
          Project JSON (v{PROJECT_SCHEMA_VERSION})
        </button>
        <button
          type="button"
          className="btn"
          data-testid="share-url"
          onClick={() => {
            const r = buildShareUrl(project);
            setShare(r);
            if (r.url) {
              navigator.clipboard?.writeText(r.url).catch(() => undefined);
              toast('ok', 'Share URL copied to clipboard.');
            }
          }}
        >
          Share URL
        </button>
        {share?.tooLarge && (
          <span style={{ fontSize: 11.5, color: 'var(--warn)' }}>
            This project is too large for a share URL ({share.length.toLocaleString()} chars encoded;
            limit ~8,000). Use Project JSON instead.
          </span>
        )}
      </div>
      {share?.url && (
        <input
          className="field mono"
          readOnly
          value={share.url}
          data-testid="share-url-value"
          onFocus={(e) => e.target.select()}
          style={{ marginBottom: 12, fontSize: 10.5 }}
        />
      )}

      <div className="panel-label" style={{ margin: '10px 0 6px' }}>
        Experiment report
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={includeFormulas}
            onChange={(e) => setIncludeFormulas(e.target.checked)}
          />
          include formulas
        </label>
        <button
          type="button"
          className="btn primary"
          disabled={busy !== null}
          onClick={() => {
            setBusy('report');
            exportReport(includeFormulas)
              .then(() => toast('ok', 'Report exported — open it and use your browser’s Print for PDF.'))
              .catch((err) => toast('error', `Report failed: ${err.message ?? err}`))
              .finally(() => setBusy(null));
          }}
        >
          {busy === 'report' ? 'Building…' : 'Self-contained HTML report'}
        </button>
        <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
          Includes diagram, settings, measurements, analyzer captures, notes and warnings.
        </span>
      </div>
    </Modal>
  );
}

/* ---------------- Onboarding ---------------- */

export function OnboardingDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="Welcome to the Signal Lab"
      onClose={onClose}
      wide
      footer={
        <button type="button" className="btn primary" onClick={onClose} data-testid="onboarding-done">
          Start experimenting
        </button>
      }
    >
      <p style={{ marginTop: 0, fontSize: 13 }}>
        This is an interactive laboratory for learning digital signal processing. You patch
        together <strong>modules</strong> on the bench, observe signals with{' '}
        <strong>instruments</strong>, and — when you press Play — hear them (safely limited, at a
        conservative volume).
      </p>
      <div className="onboard-steps">
        <div className="onboard-step">
          <span className="n">01</span>
          <div className="t">Patch a chain</div>
          <div className="d">
            Drag a Sine Wave from the library, then an Oscilloscope and an Audio Output. Wire them
            left to right by dragging between the round jacks.
          </div>
        </div>
        <div className="onboard-step">
          <span className="n">02</span>
          <div className="t">Play & tweak</div>
          <div className="d">
            Press Play in the transport bar. Turn knobs (drag vertically; Shift for fine control)
            and watch + hear the signal change in real time.
          </div>
        </div>
        <div className="onboard-step">
          <span className="n">03</span>
          <div className="t">Inspect deeply</div>
          <div className="d">
            Select any node: the inspector shows exact values, before/after views, a deterministic
            “Explain This Signal” readout and the math behind the module.
          </div>
        </div>
        <div className="onboard-step">
          <span className="n">04</span>
          <div className="t">Learn & solve</div>
          <div className="d">
            The Lessons tab teaches DSP concept by concept; Challenges give you graded goals with
            multiple valid solutions. Capture mode makes every run repeatable.
          </div>
        </div>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>
        Everything runs locally in your browser — no account, no uploads. Reopen this guide anytime
        via the ? button. Signal inputs are round jacks; modulation inputs are square (◇); feedback
        ports are dashed (↺) and add one block of delay.
      </p>
    </Modal>
  );
}
