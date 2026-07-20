/** Bottom status strip: engine health, graph info, capture state, version. */

import { useUiStore } from '@/state/uiStore';
import { useProjectStore } from '@/state/projectStore';
import { liveEngine } from '@/state/engines';
import { APP_VERSION } from '@/model/schema';

export function StatusBar() {
  const ui = useUiStore();
  const project = useProjectStore((s) => s.project);
  useUiStore((s) => s.liveTick);
  const orderErrors = liveEngine.orderErrors;
  const load = liveEngine.load;

  return (
    <div className="status-bar" role="status">
      <span className="status-item">
        <span className={`led ${ui.transport === 'playing' ? 'on' : ''}`} aria-hidden />
        {ui.transport.toUpperCase()}
      </span>
      <span className="status-item" title="Modules and cables in the current patch">
        {project.graph.nodes.length} modules · {project.graph.edges.length} cables
      </span>
      <span className="status-item" title="Fraction of real time the engine spends rendering">
        load {(load * 100).toFixed(0)}%
      </span>
      {ui.limiterActive && (
        <span className="status-item status-warn" title="The output limiter is reducing gain">
          ⚠ limiter active
        </span>
      )}
      {orderErrors.length > 0 && (
        <span className="status-item status-error" title={orderErrors.join('\n')}>
          ⚠ {orderErrors[0]}
        </span>
      )}
      {ui.captureStatus === 'done' && <span className="status-item">capture ready</span>}
      <span style={{ flex: 1 }} />
      <span className="status-item" title="All data stays in your browser — no accounts, no servers">
        local-only
      </span>
      <span className="status-item">v{APP_VERSION}</span>
    </div>
  );
}

export function Toasts() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role="alert">
          {t.text}
          <button
            type="button"
            className="btn small"
            style={{ marginLeft: 8, padding: '0 6px' }}
            aria-label="Dismiss notification"
            onClick={() => dismiss(t.id)}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
