import { describe, it, expect } from 'vitest';
import { compileExpression, validateExpression, ExpressionError } from '@/engine/expr/expression';

describe('Expression language', () => {
  it('evaluates arithmetic and precedence', () => {
    expect(compileExpression('1 + 2 * 3')(0, 48000)).toBe(7);
    expect(compileExpression('(1 + 2) * 3')(0, 48000)).toBe(9);
    expect(compileExpression('2 ^ 3 ^ 2')(0, 48000)).toBe(512); // right assoc
    expect(compileExpression('-2 ^ 2')(0, 48000)).toBe(-4);
    expect(compileExpression('7 % 3')(0, 48000)).toBe(1);
  });

  it('provides t, sr and constants', () => {
    expect(compileExpression('t')(1.5, 48000)).toBe(1.5);
    expect(compileExpression('sr')(0, 44100)).toBe(44100);
    expect(compileExpression('pi')(0, 0)).toBeCloseTo(Math.PI, 12);
    expect(compileExpression('tau / pi')(0, 0)).toBeCloseTo(2, 12);
  });

  it('evaluates functions', () => {
    expect(compileExpression('sin(pi/2)')(0, 0)).toBeCloseTo(1, 12);
    expect(compileExpression('clamp(5, 0, 1)')(0, 0)).toBe(1);
    expect(compileExpression('min(3, 2)')(0, 0)).toBe(2);
    expect(compileExpression('square(0.25)')(0, 0)).toBe(1);
    expect(compileExpression('square(0.75)')(0, 0)).toBe(-1);
    expect(compileExpression('sawtooth(0.25)')(0, 0)).toBeCloseTo(0.5, 12);
    expect(compileExpression('step(0.5, 0.7)')(0, 0)).toBe(1);
  });

  it('produces a 440 Hz sine', () => {
    const fn = compileExpression('sin(2*pi*440*t)');
    const sr = 48000;
    // Zero at t=0, positive shortly after
    expect(fn(0, sr)).toBeCloseTo(0, 9);
    expect(fn(1 / (4 * 440), sr)).toBeCloseTo(1, 6);
  });

  it('guards non-finite results', () => {
    expect(compileExpression('1/0')(0, 0)).toBe(0);
    expect(compileExpression('log(0-1)')(0, 0)).toBe(0);
  });

  it('reports helpful errors with positions', () => {
    expect(validateExpression('sin(')).toMatch(/Unexpected end|Expected/);
    expect(validateExpression('foo(1)')).toMatch(/Unknown function 'foo'/);
    expect(validateExpression('bar')).toMatch(/Unknown variable 'bar'/);
    expect(validateExpression('sin(1, 2)')).toMatch(/expects 1 argument/);
    expect(validateExpression('1 + + ')).toBeTruthy();
    expect(validateExpression('')).toMatch(/empty/);
    expect(validateExpression('2 @ 3')).toMatch(/Unexpected character '@'/);
  });

  it('is safe: no identifier escape hatch', () => {
    // Anything that is not whitelisted must throw, not resolve.
    for (const evil of ['window', 'globalThis', 'constructor', 'eval', 'Function', 'this']) {
      expect(() => compileExpression(evil)).toThrow(ExpressionError);
    }
    expect(validateExpression('constructor(1)')).toMatch(/Unknown function/);
  });

  it('rejects oversized expressions', () => {
    expect(validateExpression('1+'.repeat(400) + '1')).toMatch(/too long/);
  });
});
