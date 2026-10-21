import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import type { AlertConfig, Config, JourneyConfig, Settings, SiteConfig, Step } from './types.js';
import { STEP_ACTIONS } from './types.js';
import { deepInterpolate, parseDuration } from './util.js';
import { PRESET_NAMES } from './presets/index.js';
import { VERSION } from './version.js';

export const DEFAULT_SETTINGS: Settings = {
  interval: '15m',
  timeout: '30s',
  retries: 1,
  safeMode: true,
  language: 'en',
  dataDir: './journeyguard-data',
  keepRuns: 200,
  userAgentSuffix: `JourneyGuard/${VERSION} (+https://github.com/nxdpro/journeyguard)`,
  headers: { 'X-JourneyGuard': '1' },
  viewport: { width: 1366, height: 900 },
  browser: { headless: true },
  report: { poweredBy: true },
  dashboard: { host: '127.0.0.1', port: 8080 },
};

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

const ALERT_TYPES = ['telegram', 'discord', 'slack', 'email', 'webhook'] as const;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** HTTP header values must be strings; numbers from YAML are converted, anything else is an error. */
function normalizeHeaders(value: unknown, where: string, problems: string[]): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (!isObject(value)) {
    problems.push(`${where}: expected a mapping of header names to values`);
    return {};
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(k)) {
      problems.push(`${where}: "${k}" is not a valid header name`);
      continue;
    }
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      const value = String(v).trim();
      if (/[\r\n]/.test(value)) problems.push(`${where}.${k}: header values cannot contain line breaks`);
      else out[k] = value;
    } else problems.push(`${where}.${k}: header values must be text`);
  }
  return out;
}

function isHttpUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function validateStep(step: unknown, where: string, problems: string[]): void {
  if (!isObject(step)) {
    problems.push(`${where}: each step must be an object such as { goto: "/" }`);
    return;
  }
  const actions = Object.keys(step).filter((k) => (STEP_ACTIONS as readonly string[]).includes(k));
  if (actions.length !== 1) {
    problems.push(
      `${where}: a step needs exactly one action (${STEP_ACTIONS.join(', ')}); found ${actions.length ? actions.join(', ') : 'none'}`,
    );
    return;
  }
  const action = actions[0]!;
  const value = step[action];
  if (value === undefined || value === null || value === '') problems.push(`${where}.${action}: value is required`);
  if ((action === 'fill' || action === 'select') && (!isObject(value) || !value.selector || value.value === undefined)) {
    problems.push(`${where}.${action}: expected { selector, value }`);
  }
  if (action === 'press' && (!isObject(value) || typeof value.key !== 'string')) {
    problems.push(`${where}.press: expected { key, selector? }`);
  }
  if (step.timeout !== undefined) {
    try {
      parseDuration(step.timeout as string, 'timeout');
    } catch (e) {
      problems.push(`${where}.timeout: ${(e as Error).message}`);
    }
  }
}

function validateJourney(j: unknown, where: string, problems: string[]): void {
  if (!isObject(j)) {
    problems.push(`${where}: journey must be an object`);
    return;
  }
  const hasPreset = typeof j.preset === 'string';
  const hasSteps = Array.isArray(j.steps);
  const hasStages = Array.isArray(j.stages);
  if (!hasPreset && !hasSteps && !hasStages) {
    problems.push(`${where}: set either "preset" (${PRESET_NAMES.join(', ')}) or "steps"`);
  }
  if (hasPreset && !PRESET_NAMES.includes(j.preset as string)) {
    problems.push(`${where}.preset: unknown preset "${String(j.preset)}" (available: ${PRESET_NAMES.join(', ')})`);
  }
  if (!hasPreset && typeof j.name !== 'string') problems.push(`${where}: custom journeys need a "name"`);
  if (hasSteps) (j.steps as unknown[]).forEach((s, i) => validateStep(s, `${where}.steps[${i}]`, problems));
  if (hasStages) {
    (j.stages as unknown[]).forEach((st, i) => {
      if (!isObject(st) || typeof st.name !== 'string' || !Array.isArray(st.steps)) {
        problems.push(`${where}.stages[${i}]: expected { name, steps: [...] }`);
        return;
      }
      (st.steps as unknown[]).forEach((s, k) => validateStep(s, `${where}.stages[${i}].steps[${k}]`, problems));
    });
  }
  if (j.retries !== undefined && !(Number.isInteger(j.retries) && (j.retries as number) >= 0 && (j.retries as number) <= 5)) {
    problems.push(`${where}.retries: must be a whole number between 0 and 5`);
  }
  if (j.interval !== undefined) {
    try {
      parseDuration(j.interval as string, 'interval');
    } catch (e) {
      problems.push(`${where}.interval: ${(e as Error).message}`);
    }
  }
}

function validateAlert(a: unknown, where: string, problems: string[], rawAlert?: unknown): void {
  if (!isObject(a) || !ALERT_TYPES.includes(a.type as (typeof ALERT_TYPES)[number])) {
    problems.push(`${where}.type: must be one of ${ALERT_TYPES.join(', ')}`);
    return;
  }
  const need = (keys: string[]) => {
    for (const k of keys) {
      if (a[k]) continue;
      const rawValue = isObject(rawAlert) ? rawAlert[k] : undefined;
      const envVar = typeof rawValue === 'string' ? /\$\{([A-Z0-9_]+)/i.exec(rawValue)?.[1] : undefined;
      problems.push(
        envVar
          ? `${where}.${k}: the environment variable ${envVar} is not set`
          : `${where}: "${k}" is required for ${String(a.type)} alerts`,
      );
    }
  };
  switch (a.type) {
    case 'telegram':
      need(['botToken', 'chatId']);
      break;
    case 'discord':
    case 'slack':
      need(['webhookUrl']);
      break;
    case 'webhook':
      need(['url']);
      break;
    case 'email':
      need(['smtp', 'from', 'to']);
      break;
  }
}

/** Validates and normalises a parsed config object. Throws ConfigError listing every problem. */
export interface LoadOptions {
  /** Ignore the alerts section entirely (e.g. `run --no-alerts` in CI, where alert secrets are absent). */
  skipAlerts?: boolean;
}

export function normalizeConfig(raw: unknown, env: NodeJS.ProcessEnv = process.env, options: LoadOptions = {}): Config {
  const problems: string[] = [];
  if (!isObject(raw)) throw new ConfigError(['config file is empty or not a YAML mapping']);
  const data = deepInterpolate(raw, env);

  const rawSettings = isObject(data.settings) ? data.settings : {};
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    ...rawSettings,
    headers: { ...DEFAULT_SETTINGS.headers, ...normalizeHeaders(rawSettings.headers, 'settings.headers', problems) },
    viewport: { ...DEFAULT_SETTINGS.viewport, ...(isObject(rawSettings.viewport) ? rawSettings.viewport : {}) },
    browser: { ...DEFAULT_SETTINGS.browser, ...(isObject(rawSettings.browser) ? rawSettings.browser : {}) },
    report: { ...DEFAULT_SETTINGS.report, ...(isObject(rawSettings.report) ? rawSettings.report : {}) },
    dashboard: { ...DEFAULT_SETTINGS.dashboard, ...(isObject(rawSettings.dashboard) ? rawSettings.dashboard : {}) },
  } as Settings;

  for (const key of ['interval', 'timeout'] as const) {
    try {
      parseDuration(settings[key], key);
    } catch (e) {
      problems.push(`settings.${key}: ${(e as Error).message}`);
    }
  }
  if (!['en', 'el', 'es'].includes(settings.language)) problems.push('settings.language: use "en", "el" or "es"');
  if (typeof settings.retries !== 'number' || settings.retries < 0 || settings.retries > 5) {
    problems.push('settings.retries: must be a number between 0 and 5');
  }
  // Safe mode fails closed: only an explicit false turns it off (an unset ${VAR} keeps it on).
  const rawSafe = rawSettings.safeMode;
  if (rawSafe === false || rawSafe === 'false') settings.safeMode = false;
  else if (rawSafe === undefined || rawSafe === null || rawSafe === '' || rawSafe === true || rawSafe === 'true') settings.safeMode = true;
  else {
    settings.safeMode = true;
    problems.push('settings.safeMode: use true or false');
  }
  if (!Number.isInteger(Number(settings.retries))) problems.push('settings.retries: must be a whole number');
  settings.retries = Number(settings.retries);
  settings.keepRuns = Number(settings.keepRuns);
  if (!Number.isInteger(settings.keepRuns) || settings.keepRuns < 1) problems.push('settings.keepRuns: must be a whole number of at least 1');
  settings.viewport = { width: Number(settings.viewport.width), height: Number(settings.viewport.height) };
  if (!(settings.viewport.width > 0 && settings.viewport.height > 0)) problems.push('settings.viewport: width and height must be positive numbers');

  if (!settings.dashboard.password && env.JOURNEYGUARD_PASSWORD) settings.dashboard.password = env.JOURNEYGUARD_PASSWORD;
  if (settings.dashboard.password === '' || settings.dashboard.password === undefined || settings.dashboard.password === null) {
    delete settings.dashboard.password;
  } else {
    settings.dashboard.password = String(settings.dashboard.password);
  }
  settings.dashboard.port = Number(settings.dashboard.port);
  if (!Number.isInteger(settings.dashboard.port) || settings.dashboard.port < 0 || settings.dashboard.port > 65535) {
    problems.push('settings.dashboard.port: must be a port number');
  }
  if (settings.dashboard.publicUrl === '') delete settings.dashboard.publicUrl;
  if (settings.dashboard.publicUrl !== undefined && !isHttpUrl(settings.dashboard.publicUrl)) {
    problems.push('settings.dashboard.publicUrl: must start with http:// or https://');
  }
  if (settings.report.brandUrl === '') delete settings.report.brandUrl;
  if (settings.report.brandUrl !== undefined && !isHttpUrl(settings.report.brandUrl)) {
    problems.push('settings.report.brandUrl: must start with http:// or https://');
  }

  const alerts = !options.skipAlerts && Array.isArray(data.alerts) ? (data.alerts as unknown[]) : [];
  const rawAlerts = Array.isArray(raw.alerts) ? (raw.alerts as unknown[]) : [];
  alerts.forEach((a, i) => validateAlert(a, `alerts[${i}]`, problems, rawAlerts[i]));

  if (!Array.isArray(data.sites) || data.sites.length === 0) {
    problems.push('sites: add at least one site, e.g. sites: [{ name: My shop, url: https://example.com, journeys: [{ preset: website }] }]');
  } else {
    (data.sites as unknown[]).forEach((s, i) => {
      const where = `sites[${i}]`;
      if (!isObject(s)) {
        problems.push(`${where}: must be an object`);
        return;
      }
      if (typeof s.name !== 'string' || !s.name.trim()) problems.push(`${where}.name: required`);
      if (typeof s.url !== 'string') {
        problems.push(`${where}.url: required`);
      } else {
        try {
          const u = new URL(s.url);
          if (!['http:', 'https:'].includes(u.protocol)) problems.push(`${where}.url: must start with http:// or https://`);
        } catch {
          problems.push(`${where}.url: "${s.url}" is not a valid URL`);
        }
      }
      s.headers = normalizeHeaders(s.headers, `${where}.headers`, problems);
      if (!Array.isArray(s.journeys) || s.journeys.length === 0) {
        problems.push(`${where}.journeys: add at least one journey (e.g. - preset: website)`);
      } else {
        (s.journeys as unknown[]).forEach((j, k) => validateJourney(j, `${where}.journeys[${k}]`, problems));
      }
    });
  }

  if (problems.length) throw new ConfigError(problems);

  return {
    settings,
    alerts: alerts as AlertConfig[],
    sites: (data.sites as SiteConfig[]).map((s) => ({
      ...s,
      journeys: s.journeys.map((j: JourneyConfig) => ({ ...j, steps: j.steps as Step[] | undefined })),
    })),
  };
}

export async function loadConfig(file: string, env: NodeJS.ProcessEnv = process.env, options: LoadOptions = {}): Promise<Config> {
  const abs = path.resolve(file);
  let text: string;
  try {
    text = await readFile(abs, 'utf8');
  } catch {
    throw new ConfigError([`cannot read ${abs} — create one with: journeyguard init https://your-site.com`]);
  }
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (e) {
    throw new ConfigError([`YAML syntax error in ${abs}: ${(e as Error).message}`]);
  }
  const config = normalizeConfig(raw, env, options);
  config.path = abs;
  // JOURNEYGUARD_DATA_DIR wins (Docker volumes); relative paths resolve next to the config file.
  config.settings.dataDir = env.JOURNEYGUARD_DATA_DIR
    ? path.resolve(env.JOURNEYGUARD_DATA_DIR)
    : path.resolve(path.dirname(abs), config.settings.dataDir);
  return config;
}
