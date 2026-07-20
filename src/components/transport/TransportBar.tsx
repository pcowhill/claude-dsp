/**
 * Transport bar: live playback controls with audio safety, master volume,
 * the live/capture mode switch and capture controls.
 */

import { useUiStore } from '@/state/uiStore';
import { useProjectStore } from '@/state/projectStore';
import {
  transportPlay,
  transportPause,
  transportStop,
  transportRestart,
  runCaptureNow,
  audioEngine,
  liveEngine,
} from '@/state/engines';
import { LIMITS } from '@/model/types';

const IconPlay = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
    <path d="M2 1l9 5-9 5z" fill="currentColor" />
  </svg>
);
const IconPause = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
    <path d="M2 1h3v10H2zM7 1h3v10H7z" fill="currentColor" />
  </svg>
);
const IconStop = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
    <path d="M2 2h8v8H2z" fill="currentColor" />
  </svg>
);
const IconRestart = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
    <path d="M2 1v10M4 6l7-5v10z" stroke="currentColor" strokeWidth="1.6" fill="none" />
  </svg>
);
const IconCapture = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
    <circle cx="6" cy="6" r="4.5" fill="currentColor" />
  </svg>
);

export function TransportBar() {
  const ui = useUiStore();
  const project = useProjectStore((s) => s.project);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const canUndo = useProjectStore((s) => s.past.length > 0);
  const canRedo = useProjectStore((s) => s.future.length > 0);

  const audioLabel =
    ui.audioStatus === 'running'
      ? 'AUDIO LIVE'
      : ui.audioStatus === 'suspended'
        ? 'AUDIO PAUSED'
        : ui.audioStatus === 'unavailable'
          ? 'NO AUDIO'
          : ui.audioStatus === 'error'
            ? 'AUDIO ERR'
            : 'AUDIO OFF';

  return (
    <div className="transport-bar" role="toolbar" aria-label="Transport">
      <div className="transport-group" aria-label="Run mode">
        <div className="segmented" role="group" aria-label="Live or capture mode">
          <button
            type="button"
            aria-pressed={ui.runMode === 'live'}
            onClick={() => ui.setRunMode('live')}
            title="Live mode: continuous signals, audible playback, oscilloscope-style observation"
          >
            Live
          </button>
          <button
            type="button"
            aria-pressed={ui.runMode === 'capture'}
            data-testid="mode-capture"
            onClick={() => {
              ui.setRunMode('capture');
            }}
            title="Capture mode: finite repeatable buffers for precise, seeded analysis and export"
          >
            Capture
          </button>
        </div>
      </div>

      {ui.runMode === 'live' ? (
        <div className="transport-group" aria-label="Playback">
          <button
            type="button"
            className={`transport-btn${ui.transport === 'playing' ? ' engaged' : ''}`}
            title="Play (starts audio — explicit user action required for sound)"
            aria-label="Play"
            data-testid="btn-play"
            onClick={() => transportPlay(!ui.muted)}
            disabled={ui.transport === 'playing'}
          >
            <IconPlay />
          </button>
          <button
            type="button"
            className="transport-btn"
            title="Pause"
            aria-label="Pause"
            data-testid="btn-pause"
            onClick={() => transportPause()}
            disabled={ui.transport !== 'playing'}
          >
            <IconPause />
          </button>
          <button
            type="button"
            className="transport-btn"
            title="Stop and rewind"
            aria-label="Stop"
            data-testid="btn-stop"
            onClick={() => transportStop()}
            disabled={ui.transport === 'stopped'}
          >
            <IconStop />
          </button>
          <button
            type="button"
            className="transport-btn"
            title="Restart from zero"
            aria-label="Restart"
            onClick={() => transportRestart()}
          >
            <IconRestart />
          </button>
          <span className="readout" data-testid="playhead">
            {formatTime(liveEngine.playheadSeconds)}
          </span>
        </div>
      ) : (
        <div className="transport-group capture-fields" aria-label="Capture controls">
          <button
            type="button"
            className={`transport-btn rec${ui.captureStatus === 'running' ? ' engaged' : ''}`}
            title="Run capture: render the graph deterministically for the set duration"
            aria-label="Start capture"
            data-testid="btn-capture"
            onClick={() => runCaptureNow()}
            disabled={ui.captureStatus === 'running'}
          >
            <IconCapture />
          </button>
          <label htmlFor="cap-dur">Dur</label>
          <input
            id="cap-dur"
            className="field"
            type="number"
            min={0.05}
            max={LIMITS.maxCaptureSeconds}
            step={0.1}
            value={ui.captureDuration}
            onChange={(e) =>
              ui.setCaptureDuration(
                Math.max(0.05, Math.min(LIMITS.maxCaptureSeconds, parseFloat(e.target.value) || 1)),
              )
            }
            title={`Capture duration in seconds (max ${LIMITS.maxCaptureSeconds}s)`}
          />
          <span className="p-unit">s</span>
          <label htmlFor="cap-seed">Seed</label>
          <input
            id="cap-seed"
            className="field"
            type="number"
            min={0}
            max={99999}
            step={1}
            value={ui.captureSeed}
            onChange={(e) => ui.setCaptureSeed(Math.max(0, parseInt(e.target.value) || 0))}
            title="Noise seed: identical seeds reproduce identical captures"
          />
          <button
            type="button"
            className="btn small"
            title="Re-run with the same seed (identical result)"
            onClick={() => runCaptureNow()}
          >
            Re-run
          </button>
          <button
            type="button"
            className="btn small"
            title="Single shot with a fresh seed"
            onClick={() => {
              const next = ui.captureSeed + 1;
              ui.setCaptureSeed(next);
              runCaptureNow(next);
            }}
          >
            New seed
          </button>
          <span className="readout dim" data-testid="capture-status">
            {ui.captureStatus === 'running'
              ? 'CAPTURING…'
              : ui.captureStatus === 'done'
                ? 'CAPTURE READY'
                : ui.captureStatus === 'error'
                  ? 'CAPTURE ERROR'
                  : 'NO CAPTURE'}
          </span>
        </div>
      )}

      <div className="transport-group" aria-label="Master output">
        <button
          type="button"
          className={`btn small${ui.muted ? ' active' : ''}`}
          aria-pressed={ui.muted}
          title="Master mute"
          onClick={() => {
            const next = !ui.muted;
            ui.setMuted(next);
            audioEngine.setMuted(next);
          }}
        >
          {ui.muted ? 'MUTED' : 'MUTE'}
        </button>
        <input
          type="range"
          className="hslider volume-slider"
          min={0}
          max={1}
          step={0.01}
          value={ui.masterVolume}
          aria-label="Master volume"
          title="Master volume (starts conservatively at 25%)"
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            ui.setMasterVolume(v);
            audioEngine.setVolume(v);
          }}
        />
        <span
          className={`led ${ui.limiterActive ? 'warn' : ui.audioStatus === 'running' ? 'on' : ''}`}
          role="img"
          aria-label={ui.limiterActive ? 'Safety limiter active' : 'Limiter idle'}
          title={
            ui.limiterActive
              ? 'Safety limiter is actively reducing gain — your signal exceeds safe levels'
              : 'Safety limiter armed'
          }
        />
        <span className="panel-label">LIM</span>
      </div>

      <div className="transport-group" aria-label="Status readouts">
        <span className="readout amber" title="Project sample rate">
          {(project.sampleRate / 1000).toFixed(1)} kHz
        </span>
        <span
          className={`readout${ui.audioStatus === 'error' || ui.audioStatus === 'unavailable' ? ' amber' : ''}`}
          title={ui.audioDetail ?? 'Audio engine status'}
          data-testid="audio-status"
        >
          {audioLabel}
        </span>
      </div>

      <div className="transport-group" aria-label="History">
        <button type="button" className="btn small" onClick={undo} disabled={!canUndo} title="Undo (Ctrl/⌘+Z)">
          ↩ Undo
        </button>
        <button type="button" className="btn small" onClick={redo} disabled={!canRedo} title="Redo (Ctrl/⌘+Shift+Z)">
          ↪ Redo
        </button>
      </div>
    </div>
  );
}

function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m.toString().padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}
