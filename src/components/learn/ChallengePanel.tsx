/** Challenge experience: scenario, tiered hints, grading with live progress. */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Challenge, GradeResult } from '@/learn/types';
import { gradeChallenge } from '@/learn/gradeRunner';
import { useLearnStore } from '@/state/learnStore';
import { useProjectStore } from '@/state/projectStore';
import { runCaptureAsync } from '@/state/engines';

export function ChallengePanel({
  challenge,
  onExit,
}: {
  challenge: Challenge;
  onExit: () => void;
}) {
  const learn = useLearnStore();
  const progress = learn.challenges[challenge.id] ?? { completed: false, bestScore: 0, hintsUsed: 0 };
  const graphRevision = useProjectStore((s) => s.graphRevision);
  const [result, setResult] = useState<GradeResult | null>(null);
  const [grading, setGrading] = useState(false);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [hintsOpen, setHintsOpen] = useState(progress.hintsUsed);
  const [autoGrade, setAutoGrade] = useState(false);
  const gradeSeq = useRef(0);

  const runGrade = useCallback(async () => {
    const seq = ++gradeSeq.current;
    setGrading(true);
    try {
      const { project } = useProjectStore.getState();
      const r = await gradeChallenge(challenge, project.graph, project.sampleRate, answers, {
        runCapture: runCaptureAsync,
      });
      if (seq !== gradeSeq.current) return;
      setResult(r);
      learn.recordChallengeResult(challenge.id, r.score, r.passed);
    } catch (err) {
      if (seq !== gradeSeq.current) return;
      setResult({
        score: 0,
        passed: false,
        parts: [],
        message: `Grading failed: ${err instanceof Error ? err.message : err}`,
      });
    } finally {
      if (seq === gradeSeq.current) setGrading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge, answers]);

  // Optional live progress: re-grade when the graph changes (debounced).
  useEffect(() => {
    if (!autoGrade) return;
    const t = setTimeout(() => {
      void runGrade();
    }, 1500);
    return () => clearTimeout(t);
  }, [graphRevision, autoGrade, runGrade]);

  return (
    <div className="learn-panel" data-testid="challenge-panel">
      <div className="learn-head">
        <div className="learn-kicker">
          Challenge {challenge.index} · pass at {challenge.passScore} pts
          {progress.completed ? ' · solved' : ''}
        </div>
        <div className="learn-title">{challenge.title}</div>
        <div style={{ fontSize: 12, color: '#6d6353' }}>
          best score: {progress.bestScore} · hints used: {hintsOpen}/{challenge.hints.length}
        </div>
      </div>

      <div className="learn-body">
        <h3>Scenario</h3>
        <p>{challenge.scenario}</p>
        <h3>Objective</h3>
        <p>{challenge.objective}</p>
        {challenge.efficiencyGoal && (
          <p style={{ fontSize: 12, color: '#6d6353' }}>Efficiency: {challenge.efficiencyGoal}</p>
        )}
        {Object.keys(challenge.fixedNodes).length > 0 && (
          <p style={{ fontSize: 12, color: '#6d6353' }}>
            Fixed equipment (grading restores their settings):{' '}
            <code>{Object.keys(challenge.fixedNodes).join(', ')}</code>
          </p>
        )}

        {challenge.answerFields && (
          <div className="goal-box">
            <h4 style={{ margin: '0 0 8px', fontFamily: 'var(--font-head)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Your measurements
            </h4>
            {challenge.answerFields.map((f) => (
              <div className="goal-row" key={f.id}>
                <label htmlFor={`ans-${f.id}`} style={{ width: 120 }}>
                  {f.label}
                </label>
                <input
                  id={`ans-${f.id}`}
                  type="number"
                  className="field"
                  style={{ width: 110, background: '#fffdf7', color: '#2b2823', boxShadow: 'none' }}
                  value={answers[f.id] ?? ''}
                  data-testid={`answer-${f.id}`}
                  onChange={(e) =>
                    setAnswers((a) => ({ ...a, [f.id]: parseFloat(e.target.value) || 0 }))
                  }
                />
                <span style={{ fontSize: 12 }}>{f.unit}</span>
              </div>
            ))}
          </div>
        )}

        <div className="hint-stack">
          <h3>Hints (tiered — open only what you need)</h3>
          {challenge.hints.map((h, i) => (
            <details
              key={i}
              className="hint-item"
              open={i < hintsOpen}
              onToggle={(e) => {
                if ((e.target as HTMLDetailsElement).open && i >= hintsOpen) {
                  setHintsOpen(i + 1);
                  learn.useHint(challenge.id);
                }
              }}
            >
              <summary>
                Hint {i + 1} {i >= hintsOpen ? '(click to reveal)' : ''}
              </summary>
              <div className="hint-body">{h}</div>
            </details>
          ))}
        </div>

        {result && (
          <div className="goal-box" data-testid="grade-result">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{ fontFamily: 'var(--font-head)', fontSize: 22, textTransform: 'uppercase' }}>
                {result.score} pts
              </span>
              <span style={{ fontSize: 13, color: result.passed ? '#2e7d4f' : '#8a5a12' }}>
                {result.passed ? '✓ PASSED' : `needs ${challenge.passScore} to pass`}
              </span>
            </div>
            <div className="progress-track" style={{ margin: '8px 0' }}>
              <div className="progress-fill" style={{ width: `${result.score}%` }} />
            </div>
            {result.parts.map((p, i) => (
              <div className="goal-row" key={i}>
                <span className={`goal-check${p.met ? ' met' : ''}`}>{p.met ? '✓' : ''}</span>
                <span>{p.label}</span>
                <span className="goal-value">
                  {p.detail} · {p.points}/{p.maxPoints}
                </span>
              </div>
            ))}
            <p style={{ fontSize: 12.5, marginBottom: 0 }}>{result.message}</p>
            {result.passed && (
              <div className="predict-reveal">
                <strong>Why this works:</strong> {challenge.explanation}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="learn-foot">
        <button type="button" className="pbtn" onClick={onExit}>
          ← Challenges
        </button>
        <label style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 5 }}>
          <input type="checkbox" checked={autoGrade} onChange={(e) => setAutoGrade(e.target.checked)} />
          live re-grade
        </label>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="pbtn primary"
          data-testid="grade-button"
          disabled={grading}
          onClick={() => void runGrade()}
        >
          {grading ? 'Grading…' : 'Grade my solution'}
        </button>
      </div>
    </div>
  );
}
