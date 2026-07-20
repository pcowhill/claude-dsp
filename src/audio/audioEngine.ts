/**
 * Web Audio playback engine.
 *
 * Audio never starts on its own: an AudioContext is only created inside the
 * Play click handler (a user gesture). Rendered blocks from the live engine
 * are pushed into an AudioWorklet ring buffer; the output chain is
 *
 *   worklet → master gain (default 25%) → limiter (DynamicsCompressor)
 *           → hard safety clip (WaveShaper ±1) → destination
 *
 * so even a pathological graph cannot exceed full scale. Underruns produce
 * silence, never crashes. If AudioWorklet is unavailable the engine reports
 * an 'unavailable' status and the visual simulation keeps running.
 */

export type AudioStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'suspended'
  | 'unavailable'
  | 'error';

export interface AudioEngineEvents {
  onStatus?: (status: AudioStatus, detail?: string) => void;
  onLimiterActive?: (active: boolean) => void;
}

// The worklet is tiny, so it ships as an inline module via a Blob URL. This
// avoids bundler worklet-URL quirks and works from any base path.
const WORKLET_SOURCE = `
class RingPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capacity = Math.max(16384, Math.floor(sampleRate));
    this.buf = new Float32Array(this.capacity);
    this.readPos = 0;
    this.writePos = 0;
    this.fill = 0;
    this.started = false;
    this.underrunReported = 0;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.cmd === 'reset') {
        this.readPos = 0; this.writePos = 0; this.fill = 0; this.started = false;
        return;
      }
      if (d.cmd === 'push') {
        const data = d.samples;
        for (let i = 0; i < data.length; i++) {
          if (this.fill >= this.capacity) break; // drop when overfull
          this.buf[this.writePos] = data[i];
          this.writePos = (this.writePos + 1) % this.capacity;
          this.fill++;
        }
      }
    };
  }
  process(inputs, outputs) {
    const out = outputs[0][0];
    // Wait for ~90ms of pre-buffer before starting to read
    if (!this.started && this.fill >= sampleRate * 0.09) this.started = true;
    if (!this.started) { out.fill(0); return true; }
    let underrun = false;
    for (let i = 0; i < out.length; i++) {
      if (this.fill > 0) {
        out[i] = this.buf[this.readPos];
        this.readPos = (this.readPos + 1) % this.capacity;
        this.fill--;
      } else {
        out[i] = 0;
        underrun = true;
      }
    }
    if (underrun) {
      this.started = false; // re-buffer before resuming
      const now = currentTime;
      if (now - this.underrunReported > 1) {
        this.underrunReported = now;
        this.port.postMessage({ kind: 'underrun' });
      }
    }
    return true;
  }
}
registerProcessor('ring-player', RingPlayer);
`;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private worklet: AudioWorkletNode | null = null;
  private masterGain: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private events: AudioEngineEvents;
  private _status: AudioStatus = 'idle';
  private _volume = 0.25;
  private _muted = false;
  private limiterPoll: number | null = null;
  underruns = 0;

  constructor(events: AudioEngineEvents = {}) {
    this.events = events;
  }

  get status(): AudioStatus {
    return this._status;
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  get volume(): number {
    return this._volume;
  }

  get muted(): boolean {
    return this._muted;
  }

  private setStatus(s: AudioStatus, detail?: string): void {
    this._status = s;
    this.events.onStatus?.(s, detail);
  }

  /** Must be called from a user gesture. */
  async start(sampleRate: number): Promise<boolean> {
    if (typeof AudioContext === 'undefined') {
      this.setStatus('unavailable', 'This browser does not support the Web Audio API.');
      return false;
    }
    try {
      this.setStatus('starting');
      if (!this.ctx) {
        let ctx: AudioContext;
        try {
          ctx = new AudioContext({ sampleRate });
        } catch {
          // Safari may reject custom sample rates — fall back to the default.
          ctx = new AudioContext();
        }
        if (!ctx.audioWorklet) {
          this.setStatus(
            'unavailable',
            'AudioWorklet is not supported here. Visual simulation continues without sound.',
          );
          await ctx.close();
          return false;
        }
        const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        try {
          await ctx.audioWorklet.addModule(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        const worklet = new AudioWorkletNode(ctx, 'ring-player', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        worklet.port.onmessage = (e) => {
          if (e.data?.kind === 'underrun') this.underruns++;
        };
        const gain = ctx.createGain();
        gain.gain.value = this._muted ? 0 : this._volume;
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -6;
        limiter.knee.value = 3;
        limiter.ratio.value = 20;
        limiter.attack.value = 0.002;
        limiter.release.value = 0.15;
        const clipper = ctx.createWaveShaper();
        const curve = new Float32Array(2048);
        for (let i = 0; i < curve.length; i++) {
          const x = (i / (curve.length - 1)) * 2 - 1;
          curve[i] = Math.max(-1, Math.min(1, x));
        }
        clipper.curve = curve;
        worklet.connect(gain).connect(limiter).connect(clipper).connect(ctx.destination);
        this.ctx = ctx;
        this.worklet = worklet;
        this.masterGain = gain;
        this.limiter = limiter;
        ctx.onstatechange = () => {
          if (!this.ctx) return;
          if (this.ctx.state === 'suspended') this.setStatus('suspended');
          else if (this.ctx.state === 'running') this.setStatus('running');
        };
        this.limiterPoll = window.setInterval(() => {
          if (this.limiter) {
            this.events.onLimiterActive?.(this.limiter.reduction < -1);
          }
        }, 200);
      }
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      this.setStatus(this.ctx.state === 'running' ? 'running' : 'suspended');
      return this.ctx.state === 'running';
    } catch (err) {
      this.setStatus('error', err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  /** Actual context sample rate (may differ from requested on some browsers). */
  get actualSampleRate(): number | null {
    return this.ctx?.sampleRate ?? null;
  }

  pushBlock(samples: Float32Array): void {
    if (!this.worklet) return;
    const copy = new Float32Array(samples);
    this.worklet.port.postMessage({ cmd: 'push', samples: copy }, [copy.buffer]);
  }

  flush(): void {
    this.worklet?.port.postMessage({ cmd: 'reset' });
  }

  async suspend(): Promise<void> {
    if (this.ctx && this.ctx.state === 'running') {
      await this.ctx.suspend();
      this.setStatus('suspended');
    }
  }

  setVolume(v: number): void {
    this._volume = Math.max(0, Math.min(1, v));
    if (this.masterGain && this.ctx) {
      // Smooth ramp to avoid zipper noise / discontinuities
      this.masterGain.gain.setTargetAtTime(
        this._muted ? 0 : this._volume,
        this.ctx.currentTime,
        0.03,
      );
    }
  }

  setMuted(m: boolean): void {
    this._muted = m;
    this.setVolume(this._volume);
  }

  async dispose(): Promise<void> {
    if (this.limiterPoll !== null) clearInterval(this.limiterPoll);
    if (this.ctx) {
      await this.ctx.close().catch(() => undefined);
      this.ctx = null;
      this.worklet = null;
      this.masterGain = null;
      this.limiter = null;
    }
    this.setStatus('idle');
  }
}
