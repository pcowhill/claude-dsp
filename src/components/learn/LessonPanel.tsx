/** Guided lesson experience: paper panel with steps, predictions, goals, math. */

import { useEffect, useMemo, useState } from 'react';
import type { Lesson, GoalCtx } from '@/learn/types';
import { LESSONS } from '@/learn';
import { useLearnStore } from '@/state/learnStore';
import { useProjectStore } from '@/state/projectStore';
import { useUiStore } from '@/state/uiStore';
import { getSignalWindow } from '@/state/engines';
import { computeStats } from '@/engine/dsp/measurements';
import { MathBlock } from '../MathBlock';

/** Minimal inline markup: **bold** and `code`. */
function Rich({ text }: { text: string }) {
  const parts = useMemo(() => {
    const tokens: { t: 'b' | 'c' | 'p'; s: string }[] = [];
    let rest = text;
    const re = /\*\*(.+?)\*\*|`(.+?)`/;
    for (;;) {
      const m = re.exec(rest);
      if (!m) {
        tokens.push({ t: 'p', s: rest });
        break;
      }
      if (m.index > 0) tokens.push({ t: 'p', s: rest.slice(0, m.index) });
      if (m[1] !== undefined) tokens.push({ t: 'b', s: m[1] });
      else tokens.push({ t: 'c', s: m[2] });
      rest = rest.slice(m.index + m[0].length);
    }
    return tokens;
  }, [text]);
  return (
    <>
      {parts.map((p, i) =>
        p.t === 'b' ? <strong key={i}>{p.s}</strong> : p.t === 'c' ? <code key={i}>{p.s}</code> : p.s,
      )}
    </>
  );
}

function useGoalCtx(): GoalCtx {
  const graph = useProjectStore((s) => s.project.graph);
  const sampleRate = useProjectStore((s) => s.project.sampleRate);
  const transport = useUiStore((s) => s.transport);
  useUiStore((s) => s.liveTick);
  useUiStore((s) => s.captureRevision);
  return useMemo<GoalCtx>(
    () => ({
      graph,
      sampleRate,
      playing: transport === 'playing',
      signal: (nodeId, n = 16384) => getSignalWindow(nodeId, n),
      stats: (nodeId) => {
        const sig = getSignalWindow(nodeId, 16384);
        return sig && sig.length >= 64 ? computeStats(sig, sampleRate) : null;
      },
      param: (nodeId, paramId) => graph.nodes.find((n) => n.id === nodeId)?.params[paramId],
      nodeOfType: (type) => graph.nodes.find((n) => n.type === type)?.id ?? null,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph, sampleRate, transport, useUiStore.getState().liveTick],
  );
}

export function LessonPanel({ lesson, onExit }: { lesson: Lesson; onExit: () => void }) {
  const learn = useLearnStore();
  const progress = learn.lessons[lesson.id] ?? { completed: false, step: 0, predictions: {} };
  const stepIndex = Math.min(progress.step, lesson.steps.length - 1);
  const step = lesson.steps[stepIndex];
  const ctx = useGoalCtx();
  const [showClosing, setShowClosing] = useState(false);

  const goalResults = (step.goals ?? []).map((g) => ({ goal: g, result: g.check(ctx) }));
  const predictionAnswered =
    !step.prediction || progress.predictions[step.prediction.id] !== undefined;
  const goalsMet = goalResults.every((g) => g.result.met);
  const canAdvance = predictionAnswered && goalsMet;
  const isLast = stepIndex === lesson.steps.length - 1;

  useEffect(() => setShowClosing(false), [lesson.id]);

  return (
    <div className="learn-panel" data-testid="lesson-panel">
      <div className="learn-head">
        <div className="learn-kicker">
          Lesson {lesson.index} of {LESSONS.length} · step {stepIndex + 1}/{lesson.steps.length}
        </div>
        <div className="learn-title">{lesson.title}</div>
        <div className="step-dots" aria-label={`Step ${stepIndex + 1} of ${lesson.steps.length}`}>
          {lesson.steps.map((s, i) => (
            <i key={s.id} className={i < stepIndex ? 'done' : i === stepIndex ? 'current' : ''} />
          ))}
        </div>
      </div>

      <div className="learn-body">
        {showClosing ? (
          <>
            <h3>What just happened</h3>
            <p>{lesson.closing}</p>
            <p style={{ fontStyle: 'italic', color: '#6d6353' }}>
              Lesson complete — it is marked in your progress. Feel free to keep experimenting with
              this bench; nothing here is fragile.
            </p>
          </>
        ) : (
          <>
            <h3>{step.title}</h3>
            {step.body.map((p, i) => (
              <p key={i}>
                <Rich text={p} />
              </p>
            ))}
            {step.action && (
              <div className="predict-card" style={{ borderLeftColor: 'var(--sig-process)' }}>
                <h4 style={{ color: '#2c5a78' }}>Try it</h4>
                <Rich text={step.action} />
              </div>
            )}

            {step.prediction && (
              <div className="predict-card">
                <h4>Predict first</h4>
                <p style={{ marginTop: 0 }}>{step.prediction.question}</p>
                {step.prediction.options.map((opt, i) => {
                  const chosen = progress.predictions[step.prediction!.id];
                  const cls =
                    chosen === undefined
                      ? ''
                      : i === step.prediction!.correct
                        ? ' chosen-right'
                        : i === chosen
                          ? ' chosen-wrong'
                          : '';
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`predict-option${cls}`}
                      disabled={chosen !== undefined}
                      onClick={() => learn.recordPrediction(lesson.id, step.prediction!.id, i)}
                    >
                      {String.fromCharCode(65 + i)}. {opt}
                    </button>
                  );
                })}
                {progress.predictions[step.prediction.id] !== undefined && (
                  <div className="predict-reveal">
                    {progress.predictions[step.prediction.id] === step.prediction.correct
                      ? '✓ Correct. '
                      : '✗ Not quite. '}
                    {step.prediction.reveal}
                  </div>
                )}
              </div>
            )}

            {goalResults.length > 0 && (
              <div className="goal-box">
                <h4 style={{ margin: '0 0 6px', fontFamily: 'var(--font-head)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#514a3e' }}>
                  Checkpoint
                </h4>
                {goalResults.map(({ goal, result }) => (
                  <div className="goal-row" key={goal.id}>
                    <span className={`goal-check${result.met ? ' met' : ''}`} aria-hidden>
                      {result.met ? '✓' : ''}
                    </span>
                    <span>{goal.description}</span>
                    {result.value && <span className="goal-value">{result.value}</span>}
                  </div>
                ))}
              </div>
            )}

            {step.math && (
              <details style={{ margin: '14px 0' }}>
                <summary style={{ cursor: 'pointer', fontFamily: 'var(--font-head)', textTransform: 'uppercase', letterSpacing: '0.1em', fontSize: 11, color: '#514a3e' }}>
                  ∑ The math behind it
                </summary>
                <div style={{ marginTop: 8 }}>
                  <MathBlock
                    doc={{ ...step.math, substitute: undefined }}
                    params={{}}
                    sampleRate={ctx.sampleRate}
                  />
                </div>
              </details>
            )}
          </>
        )}
      </div>

      <div className="learn-foot">
        <button type="button" className="pbtn" onClick={onExit}>
          ← Lessons
        </button>
        <span style={{ flex: 1 }} />
        {!showClosing && stepIndex > 0 && (
          <button
            type="button"
            className="pbtn"
            onClick={() => learn.setLessonStep(lesson.id, stepIndex - 1)}
          >
            Back
          </button>
        )}
        {showClosing ? (
          <button type="button" className="pbtn primary" onClick={onExit} data-testid="lesson-finish">
            Finish
          </button>
        ) : (
          <button
            type="button"
            className="pbtn primary"
            data-testid="lesson-next"
            disabled={!canAdvance}
            title={
              canAdvance
                ? undefined
                : !predictionAnswered
                  ? 'Answer the prediction first'
                  : 'Complete the checkpoint to continue'
            }
            onClick={() => {
              if (isLast) {
                learn.completeLesson(lesson.id);
                setShowClosing(true);
              } else {
                learn.setLessonStep(lesson.id, stepIndex + 1);
              }
            }}
          >
            {isLast ? 'Complete lesson' : 'Continue →'}
          </button>
        )}
      </div>
    </div>
  );
}
