const DURATION_RE = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/i;
const UNIT_MS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** Parses "500ms", "30s", "15m", "24h", "1d" or a bare number of milliseconds. */
export function parseDuration(value: string | number, field = 'duration'): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${field}: ${value}`);
    return value;
  }
  const match = DURATION_RE.exec(value.trim());
  if (!match) throw new Error(`Invalid ${field}: "${value}" (use e.g. 30s, 15m, 24h)`);
  const unit = (match[2] ?? 'ms').toLowerCase();
  return Math.round(Number(match[1]) * (UNIT_MS[unit] ?? 1));
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  const hours = ms / 3_600_000;
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

const GREEK_MAP: Record<string, string> = {
  α: 'a', ά: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', έ: 'e', ζ: 'z', η: 'i', ή: 'i', θ: 'th',
  ι: 'i', ί: 'i', ϊ: 'i', ΐ: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', ό: 'o',
  π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', ύ: 'y', ϋ: 'y', ΰ: 'y', φ: 'f', χ: 'ch',
  ψ: 'ps', ω: 'o', ώ: 'o',
};

/** URL/file-safe identifier. Transliterates Greek so "Κατάστημα" becomes "katastima". */
export function slugify(input: string): string {
  const lower = input.toLowerCase();
  let out = '';
  for (const ch of lower) out += GREEK_MAP[ch] ?? ch;
  return (
    out
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'item'
  );
}

/** Replaces ${VAR} and ${VAR:-default} with environment values. */
export function interpolateEnv(value: string, env: NodeJS.ProcessEnv = process.env): string {
  return value.replace(/\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/gi, (_m, name: string, fallback?: string) => {
    const v = env[name];
    if (v !== undefined && v !== '') return v;
    return fallback ?? '';
  });
}

export function deepInterpolate<T>(input: T, env: NodeJS.ProcessEnv = process.env): T {
  if (typeof input === 'string') return interpolateEnv(input, env) as T;
  if (Array.isArray(input)) return input.map((v) => deepInterpolate(v, env)) as T;
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) out[k] = deepInterpolate(v, env);
    return out as T;
  }
  return input;
}

export function resolveUrl(base: string, target: string): string {
  return new URL(target, base.endsWith('/') ? base : `${base}/`).toString();
}

export function originOf(url: string): string {
  return new URL(url).origin;
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Removes secrets such as bot tokens from URLs before they are logged. */
export function redact(text: string): string {
  return text
    .replace(/bot\d+:[A-Za-z0-9_-]{20,}/g, 'bot***')
    .replace(/(webhooks\/\d+\/)[A-Za-z0-9_-]+/g, '$1***')
    .replace(/(hooks\.slack\.com\/services\/)[^\s"']+/g, '$1***')
    .replace(/(smtps?:\/\/[^:\s]+:)[^@\s]+@/g, '$1***@');
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
