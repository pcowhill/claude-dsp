/** Application shell: masthead, mode tabs, transport, panels, dialogs. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { FlowCanvas } from './components/canvas/FlowCanvas';
import { NodeLibrary } from './components/library/NodeLibrary';
import { Inspector } from './components/inspector/Inspector';
import { TransportBar } from './components/transport/TransportBar';
import { StatusBar, Toasts } from './components/StatusBar';
import { ProjectManagerDialog, ExportDialog, OnboardingDialog } from './components/dialogs/Dialogs';
import { LessonPanel } from './components/learn/LessonPanel';
import { ChallengePanel } from './components/learn/ChallengePanel';
import { LESSONS, CHALLENGES } from './learn';
import { useProjectStore, makeEmptyProject } from './state/projectStore';
import { useUiStore } from './state/uiStore';
import { useLearnStore } from './state/learnStore';
import {
  startAutosave,
  wasOnboarded,
  markOnboarded,
  lastProjectId,
  loadProjectFromStorage,
  saveProjectToStorage,
} from './state/persist';
import { loadFromHash } from './export/share';
import { transportPause, transportPlay, transportStop } from './state/engines';
import { getExample } from './examples';

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 26 26" aria-hidden>
      <rect x="0.5" y="0.5" width="25" height="25" rx="3" fill="#10141a" stroke="#4a5462" />
      <path
        d="M3 13 L6 13 L8 6 L11 20 L14 9 L16 16 L18 13 L23 13"
        fill="none"
        stroke="#43e08a"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Remembers the sandbox project while a lesson/challenge project is open. */
let sandboxReturnId: string | null = null;

export default function App() {
  const ui = useUiStore();
  const setProject = useProjectStore((s) => s.setProject);
  const learn = useLearnStore();
  const [booted, setBooted] = useState(false);
  const bootRef = useRef(false);

  // Boot: share URL > last project > starter example
  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    startAutosave();
    const shared = loadFromHash(location.hash);
    if (shared) {
      if (shared.project) {
        setProject({ ...shared.project, id: makeEmptyProject().id });
        useUiStore.getState().toast('ok', `Opened shared project “${shared.project.name}”.`);
        for (const w of shared.warnings.slice(0, 3)) useUiStore.getState().toast('warn', w);
      } else {
        useUiStore.getState().toast('error', shared.errors.join(' '));
      }
      history.replaceState(null, '', location.pathname + location.search);
    } else {
      const last = lastProjectId();
      const proj = last ? loadProjectFromStorage(last) : null;
      if (proj) {
        setProject(proj);
      } else {
        const starter = getExample('ex-starter');
        if (starter) setProject(starter);
      }
    }
    if (!wasOnboarded()) {
      useUiStore.getState().setOnboardingOpen(true);
      markOnboarded();
    }
    setBooted(true);
  }, [setProject]);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
      const st = useProjectStore.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (typing) return;
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        if (typing) return;
        e.preventDefault();
        st.redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        if (typing) return;
        e.preventDefault();
        if (st.selection.length) st.duplicateNodes(st.selection);
      } else if (e.key === ' ' && !typing) {
        e.preventDefault();
        const uiState = useUiStore.getState();
        if (uiState.transport === 'playing') void transportPause();
        else void transportPlay(!uiState.muted);
      } else if (e.key === '?' && !typing) {
        useUiStore.getState().setOnboardingOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openLearnProject = useCallback(
    (build: () => ReturnType<typeof makeEmptyProject>) => {
      const cur = useProjectStore.getState().project;
      const isLearnProject =
        cur.id.startsWith('lesson-') || cur.id.startsWith('ch-') || cur.id.startsWith('ex-');
      if (!isLearnProject) {
        saveProjectToStorage(cur);
        sandboxReturnId = cur.id;
      }
      void transportStop();
      setProject(build());
    },
    [setProject],
  );

  const backToSandbox = useCallback(() => {
    const cur = useProjectStore.getState().project;
    const isLearnProject = cur.id.startsWith('lesson-') || cur.id.startsWith('ch-');
    if (isLearnProject && sandboxReturnId) {
      const restored = loadProjectFromStorage(sandboxReturnId);
      if (restored) setProject(restored);
      else setProject(makeEmptyProject());
    }
  }, [setProject]);

  const activeLesson = ui.activeLessonId ? LESSONS.find((l) => l.id === ui.activeLessonId) : null;
  const activeChallenge = ui.activeChallengeId
    ? CHALLENGES.find((c) => c.id === ui.activeChallengeId)
    : null;

  if (!booted) return null;

  return (
    <div className="app">
      <div className="small-screen-guard">
        <div className="inner">
          <BrandMark />
          <h1>Signal Processing Playground</h1>
          <p>
            This laboratory needs a desktop-sized screen (at least 900 × 500) — the patching canvas,
            instruments and inspector do not fit on small displays. Please revisit on a larger
            screen.
          </p>
        </div>
      </div>

      <header className="masthead">
        <div className="brand">
          <BrandMark />
          <div>
            <div className="brand-name">Signal Processing Playground</div>
            <div className="brand-sub">Interactive DSP Laboratory</div>
          </div>
        </div>
        <nav className="mode-tabs" role="tablist" aria-label="Application modes">
          {(
            [
              ['sandbox', 'Sandbox'],
              ['lessons', 'Lessons'],
              ['challenges', 'Challenges'],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              role="tab"
              className="mode-tab"
              aria-selected={ui.appMode === mode}
              data-testid={`tab-${mode}`}
              onClick={() => {
                ui.setAppMode(mode);
                if (mode === 'sandbox') {
                  ui.setActiveLesson(null);
                  ui.setActiveChallenge(null);
                  backToSandbox();
                }
              }}
            >
              <span className="tab-led" aria-hidden />
              {label}
            </button>
          ))}
        </nav>
        <span className="masthead-spacer" />
        <div className="masthead-actions">
          <button
            type="button"
            className="btn small"
            data-testid="btn-projects"
            onClick={() => ui.setProjectManagerOpen(true)}
          >
            Projects
          </button>
          <button
            type="button"
            className="btn small"
            data-testid="btn-export"
            onClick={() => ui.setExportDialogOpen(true)}
          >
            Export
          </button>
          <button
            type="button"
            className="btn small icon"
            title="Help & onboarding (?)"
            aria-label="Help"
            onClick={() => ui.setOnboardingOpen(true)}
          >
            ?
          </button>
        </div>
      </header>

      <TransportBar />

      <div className="app-main">
        {ui.appMode === 'sandbox' && (
          <>
            <NodeLibrary />
            <div className="app-canvas-zone">
              <FlowCanvas />
            </div>
            <Inspector />
          </>
        )}

        {ui.appMode === 'lessons' &&
          (activeLesson ? (
            <>
              <LessonPanel
                lesson={activeLesson}
                onExit={() => {
                  ui.setActiveLesson(null);
                }}
              />
              <div className="app-canvas-zone">
                <FlowCanvas />
              </div>
              <Inspector />
            </>
          ) : (
            <div className="learn-catalog" data-testid="lesson-catalog">
              <h2 className="catalog-section-title">Guided Lessons</h2>
              <p className="catalog-sub">
                A ten-part course from reading a waveform to convolution. Each lesson opens a
                prepared bench, asks you to predict before you act, and checks measurable goals as
                you experiment. Progress is saved locally.
              </p>
              <div className="catalog-grid">
                {LESSONS.map((l) => {
                  const p = learn.lessons[l.id];
                  return (
                    <button
                      key={l.id}
                      type="button"
                      className="catalog-card"
                      data-testid={`lesson-card-${l.index}`}
                      onClick={() => {
                        openLearnProject(l.build);
                        learn.setLessonStep(l.id, 0);
                        ui.setActiveLesson(l.id);
                      }}
                    >
                      <span className="num">LESSON {String(l.index).padStart(2, '0')}</span>
                      <span className="name">{l.title}</span>
                      <span className="desc">{l.summary}</span>
                      <span className="meta">≈ {l.minutes} min</span>
                      {p?.completed && <span className="done-stamp">complete</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

        {ui.appMode === 'challenges' &&
          (activeChallenge ? (
            <>
              <ChallengePanel
                challenge={activeChallenge}
                onExit={() => ui.setActiveChallenge(null)}
              />
              <div className="app-canvas-zone">
                <FlowCanvas />
              </div>
              <Inspector />
            </>
          ) : (
            <div className="learn-catalog" data-testid="challenge-catalog">
              <h2 className="catalog-section-title">Practical Challenges</h2>
              <p className="catalog-sub">
                Eight engineering problems with measurable success conditions and multiple valid
                solutions. Grading runs a deterministic capture — same seed, same result — and
                scores real measurements: SNR, frequency error, correlation, clipping, efficiency.
              </p>
              <div className="catalog-grid">
                {CHALLENGES.map((c) => {
                  const p = learn.challenges[c.id];
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className="catalog-card"
                      data-testid={`challenge-card-${c.index}`}
                      onClick={() => {
                        openLearnProject(c.build);
                        ui.setActiveChallenge(c.id);
                      }}
                    >
                      <span className="num">CHALLENGE {String(c.index).padStart(2, '0')}</span>
                      <span className="name">{c.title}</span>
                      <span className="desc">{c.objective}</span>
                      <span className="meta">
                        ≈ {c.minutes} min · pass {c.passScore} pts
                        {p ? ` · best ${p.bestScore}` : ''}
                      </span>
                      {p?.completed && <span className="done-stamp">solved</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
      </div>

      <StatusBar />
      <Toasts />

      {ui.projectManagerOpen && (
        <ProjectManagerDialog onClose={() => ui.setProjectManagerOpen(false)} />
      )}
      {ui.exportDialogOpen && <ExportDialog onClose={() => ui.setExportDialogOpen(false)} />}
      {ui.onboardingOpen && <OnboardingDialog onClose={() => ui.setOnboardingOpen(false)} />}
    </div>
  );
}
