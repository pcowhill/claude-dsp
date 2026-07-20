/**
 * Sandboxed mathematical expression language for the Expression source node.
 *
 * Implemented as a hand-written tokenizer + Pratt parser that compiles to a
 * tree of closures. There is no eval, no Function constructor, and only the
 * whitelisted identifiers below are reachable. Malformed input produces
 * actionable error messages with character positions.
 *
 * Syntax:
 *   numbers        1  0.5  2.5e3
 *   variables      t (time in seconds), sr (sample rate), pi, tau, e
 *   operators      + - * / % ^   (^ is right-associative power)
 *   comparison     < > <= >= == !=   (produce 1 or 0)
 *   grouping       ( ... )
 *   functions      sin cos tan asin acos atan atan2 sinh cosh tanh
 *                  exp log log2 log10 sqrt abs floor ceil round sign
 *                  min max pow mod clamp lerp step square sawtooth triangle
 *
 * Waveform helpers take a phase argument in cycles:
 *   square(x)   = sign(sin(2*pi*x))
 *   sawtooth(x) = 2*(x - floor(x + 0.5))
 *   triangle(x) = 2*abs(sawtooth(x)) * 2 - 1
 */

export class ExpressionError extends Error {
  constructor(
    message: string,
    public position: number,
  ) {
    super(message);
    this.name = 'ExpressionError';
  }
}

type Tok =
  | { kind: 'num'; value: number; pos: number }
  | { kind: 'ident'; name: string; pos: number }
  | { kind: 'op'; op: string; pos: number }
  | { kind: 'lparen' | 'rparen' | 'comma' | 'end'; pos: number };

const OPS = ['<=', '>=', '==', '!=', '+', '-', '*', '/', '%', '^', '<', '>'];

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  outer: while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new ExpressionError(`Invalid number`, i);
      toks.push({ kind: 'num', value: parseFloat(m[0]), pos: i });
      i += m[0].length;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      const m = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(src.slice(i))!;
      toks.push({ kind: 'ident', name: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    if (c === '(') {
      toks.push({ kind: 'lparen', pos: i });
      i++;
      continue;
    }
    if (c === ')') {
      toks.push({ kind: 'rparen', pos: i });
      i++;
      continue;
    }
    if (c === ',') {
      toks.push({ kind: 'comma', pos: i });
      i++;
      continue;
    }
    for (const op of OPS) {
      if (src.startsWith(op, i)) {
        toks.push({ kind: 'op', op, pos: i });
        i += op.length;
        continue outer;
      }
    }
    throw new ExpressionError(`Unexpected character '${c}'`, i);
  }
  toks.push({ kind: 'end', pos: src.length });
  return toks;
}

export type CompiledExpr = (t: number, sr: number) => number;

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  tau: 2 * Math.PI,
  e: Math.E,
};

const sawtooth = (x: number) => 2 * (x - Math.floor(x + 0.5));
const FUNCS: Record<string, { arity: number; fn: (...a: number[]) => number }> = {
  sin: { arity: 1, fn: Math.sin },
  cos: { arity: 1, fn: Math.cos },
  tan: { arity: 1, fn: Math.tan },
  asin: { arity: 1, fn: Math.asin },
  acos: { arity: 1, fn: Math.acos },
  atan: { arity: 1, fn: Math.atan },
  atan2: { arity: 2, fn: Math.atan2 },
  sinh: { arity: 1, fn: Math.sinh },
  cosh: { arity: 1, fn: Math.cosh },
  tanh: { arity: 1, fn: Math.tanh },
  exp: { arity: 1, fn: Math.exp },
  log: { arity: 1, fn: Math.log },
  log2: { arity: 1, fn: Math.log2 },
  log10: { arity: 1, fn: Math.log10 },
  sqrt: { arity: 1, fn: Math.sqrt },
  abs: { arity: 1, fn: Math.abs },
  floor: { arity: 1, fn: Math.floor },
  ceil: { arity: 1, fn: Math.ceil },
  round: { arity: 1, fn: Math.round },
  sign: { arity: 1, fn: Math.sign },
  min: { arity: 2, fn: Math.min },
  max: { arity: 2, fn: Math.max },
  pow: { arity: 2, fn: Math.pow },
  mod: { arity: 2, fn: (a, b) => ((a % b) + b) % b },
  clamp: { arity: 3, fn: (x, lo, hi) => Math.min(hi, Math.max(lo, x)) },
  lerp: { arity: 3, fn: (a, b, x) => a + (b - a) * x },
  step: { arity: 2, fn: (edge, x) => (x >= edge ? 1 : 0) },
  square: { arity: 1, fn: (x) => (Math.sin(2 * Math.PI * x) >= 0 ? 1 : -1) },
  sawtooth: { arity: 1, fn: sawtooth },
  triangle: { arity: 1, fn: (x) => 2 * Math.abs(sawtooth(x)) - 1 },
};

/** Documented variables for UI help. */
export const EXPRESSION_HELP = {
  variables: [
    { name: 't', doc: 'time in seconds since transport start' },
    { name: 'sr', doc: 'sample rate in Hz' },
    { name: 'pi, tau, e', doc: 'mathematical constants' },
  ],
  functions: Object.entries(FUNCS).map(([name, f]) => ({ name, arity: f.arity })),
  examples: [
    'sin(2*pi*440*t)',
    '0.5*sin(2*pi*220*t) + 0.5*sin(2*pi*330*t)',
    'sawtooth(110*t) * exp(-3*t)',
    'sin(2*pi*440*t + 5*sin(2*pi*2*t))',
  ],
};

class Parser {
  private pos = 0;
  constructor(private toks: Tok[]) {}

  private peek(): Tok {
    return this.toks[this.pos];
  }
  private next(): Tok {
    return this.toks[this.pos++];
  }

  parse(): CompiledExpr {
    const e = this.parseExpr(0);
    const t = this.peek();
    if (t.kind !== 'end') {
      throw new ExpressionError(`Unexpected input after expression`, t.pos);
    }
    return e;
  }

  private static binaryPower(op: string): [number, number] | null {
    switch (op) {
      case '<':
      case '>':
      case '<=':
      case '>=':
      case '==':
      case '!=':
        return [1, 2];
      case '+':
      case '-':
        return [3, 4];
      case '*':
      case '/':
      case '%':
        return [5, 6];
      case '^':
        return [8, 7]; // right associative
      default:
        return null;
    }
  }

  private parseExpr(minBp: number): CompiledExpr {
    let lhs = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.kind !== 'op') break;
      const bp = Parser.binaryPower(t.op);
      if (!bp || bp[0] < minBp) break;
      this.next();
      const rhs = this.parseExpr(bp[1]);
      const l = lhs;
      switch (t.op) {
        case '+':
          lhs = (tt, sr) => l(tt, sr) + rhs(tt, sr);
          break;
        case '-':
          lhs = (tt, sr) => l(tt, sr) - rhs(tt, sr);
          break;
        case '*':
          lhs = (tt, sr) => l(tt, sr) * rhs(tt, sr);
          break;
        case '/':
          lhs = (tt, sr) => l(tt, sr) / rhs(tt, sr);
          break;
        case '%':
          lhs = (tt, sr) => l(tt, sr) % rhs(tt, sr);
          break;
        case '^':
          lhs = (tt, sr) => Math.pow(l(tt, sr), rhs(tt, sr));
          break;
        case '<':
          lhs = (tt, sr) => (l(tt, sr) < rhs(tt, sr) ? 1 : 0);
          break;
        case '>':
          lhs = (tt, sr) => (l(tt, sr) > rhs(tt, sr) ? 1 : 0);
          break;
        case '<=':
          lhs = (tt, sr) => (l(tt, sr) <= rhs(tt, sr) ? 1 : 0);
          break;
        case '>=':
          lhs = (tt, sr) => (l(tt, sr) >= rhs(tt, sr) ? 1 : 0);
          break;
        case '==':
          lhs = (tt, sr) => (l(tt, sr) === rhs(tt, sr) ? 1 : 0);
          break;
        case '!=':
          lhs = (tt, sr) => (l(tt, sr) !== rhs(tt, sr) ? 1 : 0);
          break;
      }
    }
    return lhs;
  }

  private parseUnary(): CompiledExpr {
    const t = this.peek();
    if (t.kind === 'op' && (t.op === '-' || t.op === '+')) {
      this.next();
      // Unary minus binds looser than ^ (so -2^2 = -(2^2) = -4, the standard
      // mathematical convention) but tighter than * and /.
      const inner = this.parseExpr(6.5);
      return t.op === '-' ? (tt, sr) => -inner(tt, sr) : inner;
    }
    return this.parseAtom();
  }

  private parseAtom(): CompiledExpr {
    const t = this.next();
    if (t.kind === 'num') {
      const v = t.value;
      return () => v;
    }
    if (t.kind === 'lparen') {
      const e = this.parseExpr(0);
      const close = this.next();
      if (close.kind !== 'rparen') {
        throw new ExpressionError(`Expected ')'`, close.pos);
      }
      return e;
    }
    if (t.kind === 'ident') {
      const name = t.name;
      if (this.peek().kind === 'lparen') {
        // function call
        this.next();
        // hasOwnProperty guard: without it, names like "constructor" would
        // resolve through the object prototype chain and escape the sandbox.
        const fn = Object.prototype.hasOwnProperty.call(FUNCS, name) ? FUNCS[name] : undefined;
        if (!fn) {
          throw new ExpressionError(
            `Unknown function '${name}'. Available: ${Object.keys(FUNCS).join(', ')}`,
            t.pos,
          );
        }
        const args: CompiledExpr[] = [];
        if (this.peek().kind !== 'rparen') {
          for (;;) {
            args.push(this.parseExpr(0));
            const sep = this.peek();
            if (sep.kind === 'comma') {
              this.next();
              continue;
            }
            break;
          }
        }
        const close = this.next();
        if (close.kind !== 'rparen') {
          throw new ExpressionError(`Expected ')' to close '${name}(...)'`, close.pos);
        }
        if (args.length !== fn.arity) {
          throw new ExpressionError(
            `'${name}' expects ${fn.arity} argument${fn.arity === 1 ? '' : 's'}, got ${args.length}`,
            t.pos,
          );
        }
        const f = fn.fn;
        if (args.length === 1) {
          const a0 = args[0];
          return (tt, sr) => f(a0(tt, sr));
        }
        if (args.length === 2) {
          const a0 = args[0];
          const a1 = args[1];
          return (tt, sr) => f(a0(tt, sr), a1(tt, sr));
        }
        const a0 = args[0];
        const a1 = args[1];
        const a2 = args[2];
        return (tt, sr) => f(a0(tt, sr), a1(tt, sr), a2(tt, sr));
      }
      if (name === 't') return (tt) => tt;
      if (name === 'sr') return (_tt, sr) => sr;
      if (Object.prototype.hasOwnProperty.call(CONSTANTS, name)) {
        const v = CONSTANTS[name];
        return () => v;
      }
      throw new ExpressionError(
        `Unknown variable '${name}'. Available: t, sr, pi, tau, e`,
        t.pos,
      );
    }
    throw new ExpressionError(`Unexpected end of expression`, t.pos);
  }
}

/**
 * Compile an expression. Throws ExpressionError with a character position on
 * invalid input. The compiled function is pure and safe: it can only compute
 * numbers from whitelisted math functions.
 */
export function compileExpression(src: string): CompiledExpr {
  if (src.trim().length === 0) throw new ExpressionError('Expression is empty', 0);
  if (src.length > 500) throw new ExpressionError('Expression too long (max 500 characters)', 500);
  const raw = new Parser(tokenize(src)).parse();
  // Guard non-finite results so downstream DSP never sees NaN/Infinity.
  return (t, sr) => {
    const v = raw(t, sr);
    return Number.isFinite(v) ? v : 0;
  };
}

/** Validate without keeping the compiled result; returns null when valid. */
export function validateExpression(src: string): string | null {
  try {
    compileExpression(src);
    return null;
  } catch (e) {
    if (e instanceof ExpressionError) {
      return `${e.message} (at position ${e.position + 1})`;
    }
    return String(e);
  }
}
