import type { ParamValue } from '@/model/types';

export function pnum(params: Record<string, ParamValue>, id: string, fallback = 0): number {
  const v = params[id];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function pstr(params: Record<string, ParamValue>, id: string, fallback = ''): string {
  const v = params[id];
  return typeof v === 'string' ? v : fallback;
}

export function pbool(params: Record<string, ParamValue>, id: string, fallback = false): boolean {
  const v = params[id];
  return typeof v === 'boolean' ? v : fallback;
}

export function dbToLin(db: number): number {
  return Math.pow(10, db / 20);
}

export function linToDb(lin: number): number {
  return lin > 0 ? 20 * Math.log10(lin) : -Infinity;
}

/** Parse a multi-tone list like "440:1, 880:0.5, 1320:0.25" -> [freq, amp][] */
export function parseToneList(text: string): { tones: [number, number][]; error: string | null } {
  const tones: [number, number][] = [];
  const parts = text
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return { tones, error: 'Tone list is empty. Use "freq:amp, freq:amp".' };
  if (parts.length > 16) return { tones, error: 'Too many tones (max 16).' };
  for (const p of parts) {
    const m = /^([0-9.]+)\s*(?::\s*([0-9.]+))?$/.exec(p);
    if (!m) {
      return {
        tones,
        error: `Cannot read tone "${p}". Use "frequency:amplitude" like "440:0.5".`,
      };
    }
    const f = parseFloat(m[1]);
    const a = m[2] !== undefined ? parseFloat(m[2]) : 1;
    if (!(f > 0 && f <= 48000)) return { tones, error: `Frequency ${f} out of range (0–48000 Hz).` };
    if (!(a >= 0 && a <= 2)) return { tones, error: `Amplitude ${a} out of range (0–2).` };
    tones.push([f, a]);
  }
  return { tones, error: null };
}
