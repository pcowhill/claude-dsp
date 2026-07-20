/**
 * Rotary knob — the primary tactile control on node faces.
 * Drag vertically to adjust (hold Shift for fine control), double-click to
 * reset, focus + arrow keys for keyboard use. Log-scaled knobs map drag
 * distance to multiplicative steps.
 */

import { useCallback, useRef } from 'react';

export interface KnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  scale?: 'linear' | 'log';
  unit?: string;
  digits?: number;
  defaultValue?: number;
  controlColor?: boolean;
  onChange: (v: number) => void;
  onGestureStart?: () => void;
}

export function formatValue(v: number, digits = 2, unit?: string): string {
  let out: string;
  if (unit === 'Hz' && Math.abs(v) >= 10000) {
    out = `${(v / 1000).toFixed(1)}k`;
  } else if (Math.abs(v) >= 1000) {
    out = v.toFixed(0);
  } else {
    out = v.toFixed(digits);
  }
  return unit ? `${out} ${unit}` : out;
}

function toNorm(v: number, min: number, max: number, scale: 'linear' | 'log'): number {
  if (scale === 'log') {
    const lmin = Math.log(Math.max(1e-6, min));
    const lmax = Math.log(max);
    return (Math.log(Math.max(1e-6, v)) - lmin) / (lmax - lmin);
  }
  return (v - min) / (max - min);
}

function fromNorm(n: number, min: number, max: number, scale: 'linear' | 'log'): number {
  const c = Math.min(1, Math.max(0, n));
  if (scale === 'log') {
    const lmin = Math.log(Math.max(1e-6, min));
    const lmax = Math.log(max);
    return Math.exp(lmin + c * (lmax - lmin));
  }
  return min + c * (max - min);
}

const SWEEP = 270; // degrees of rotation
const START = -135;

export function Knob({
  label,
  value,
  min,
  max,
  step,
  scale = 'linear',
  unit,
  digits = 2,
  defaultValue,
  controlColor,
  onChange,
  onGestureStart,
}: KnobProps) {
  const dragRef = useRef<{ startY: number; startNorm: number } | null>(null);
  const norm = toNorm(value, min, max, scale);
  const angle = START + norm * SWEEP;

  const quantize = useCallback(
    (v: number) => {
      let out = v;
      if (step && step > 0) out = Math.round(out / step) * step;
      return Math.min(max, Math.max(min, out));
    },
    [step, min, max],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = { startY: e.clientY, startNorm: toNorm(value, min, max, scale) };
      onGestureStart?.();
    },
    [value, min, max, scale, onGestureStart],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return;
      const fine = e.shiftKey ? 0.15 : 1;
      const dy = (dragRef.current.startY - e.clientY) / 160;
      const n = dragRef.current.startNorm + dy * fine;
      onChange(quantize(fromNorm(n, min, max, scale)));
    },
    [onChange, quantize, min, max, scale],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const fine = e.shiftKey ? 0.005 : 0.02;
      let n = toNorm(value, min, max, scale);
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') n += fine;
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') n -= fine;
      else if (e.key === 'Home') n = 0;
      else if (e.key === 'End') n = 1;
      else return;
      e.preventDefault();
      onGestureStart?.();
      onChange(quantize(fromNorm(n, min, max, scale)));
    },
    [value, min, max, scale, onChange, quantize, onGestureStart],
  );

  const onDoubleClick = useCallback(() => {
    if (defaultValue !== undefined) {
      onGestureStart?.();
      onChange(defaultValue);
    }
  }, [defaultValue, onChange, onGestureStart]);

  return (
    <div className={`knob-wrap${controlColor ? ' control-color' : ''}`}>
      <div
        className="knob"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number(value.toFixed(4))}
        aria-valuetext={formatValue(value, digits, unit)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={onKeyDown}
        onDoubleClick={onDoubleClick}
        title={`${label}: drag up/down, Shift = fine, double-click = reset`}
      >
        <div className="knob-ticks" aria-hidden>
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <i key={t} style={{ transform: `rotate(${START + t * SWEEP}deg)` }} />
          ))}
        </div>
        <div className="pointer" style={{ transform: `translateY(-100%) rotate(${angle}deg)` }} />
      </div>
      <div className="knob-value">{formatValue(value, digits, unit)}</div>
      <div className="knob-label">{label}</div>
    </div>
  );
}
