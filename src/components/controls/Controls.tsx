/** Compact sliders, toggles and selects used on node faces and panels. */

import { useCallback, useId } from 'react';
import { formatValue } from './Knob';

export function HSlider({
  label,
  value,
  min,
  max,
  step = 0.01,
  unit,
  digits = 2,
  onChange,
  onGestureStart,
  width,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  digits?: number;
  onChange: (v: number) => void;
  onGestureStart?: () => void;
  width?: number;
}) {
  return (
    <div className="hslider-wrap" style={width ? { width } : undefined}>
      <div className="hslider-row">
        <span className="hslider-label" title={label}>
          {label}
        </span>
        <input
          type="range"
          className="hslider"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={value}
          onPointerDown={() => onGestureStart?.()}
          onKeyDown={(e) => {
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key))
              onGestureStart?.();
          }}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
        <span className="hslider-value">{formatValue(value, digits, unit)}</span>
      </div>
    </div>
  );
}

export function ToggleSwitch({
  label,
  value,
  onChange,
  onGestureStart,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  onGestureStart?: () => void;
}) {
  const toggle = useCallback(() => {
    onGestureStart?.();
    onChange(!value);
  }, [value, onChange, onGestureStart]);
  return (
    <div className="toggle-wrap">
      <button
        type="button"
        className="toggle"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={toggle}
      >
        <span className="thumb" />
      </button>
      <span className="knob-label">{label}</span>
    </div>
  );
}

export function SelectControl({
  label,
  value,
  options,
  onChange,
  onGestureStart,
  compact,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  onGestureStart?: () => void;
  compact?: boolean;
}) {
  const id = useId();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: compact ? 90 : 120 }}>
      <label htmlFor={id} className="knob-label" style={{ textAlign: 'left' }}>
        {label}
      </label>
      <select
        id={id}
        className="field"
        style={{ fontSize: 11, padding: '2px 20px 2px 6px' }}
        value={value}
        onChange={(e) => {
          onGestureStart?.();
          onChange(e.target.value);
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
