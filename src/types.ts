import type { Page } from 'playwright';

export type Language = 'en' | 'el';

/** A selector can be a single Playwright selector or a list of fallbacks (first match wins). */
export type SelectorInput = string | string[];

/** Steps users can write in YAML. Exactly one action key per step. */
export interface StepBase {
  /** Human-readable label shown in reports. */
  name?: string;
  /** Per-step timeout, e.g. "15s". Defaults to settings.timeout. */
  timeout?: string | number;
  /** If true, a failure of this step is recorded as a warning instead of failing the stage. */
  optional?: boolean;
}

export interface GotoStep extends StepBase { goto: string }
export interface ClickStep extends StepBase { click: SelectorInput | { selector?: SelectorInput; text?: string } }
export interface FillStep extends StepBase { fill: { selector: SelectorInput; value: string } }
export interface SelectStep extends StepBase { select: { selector: SelectorInput; value: string } }
export interface CheckStep extends StepBase { check: SelectorInput }
export interface PressStep extends StepBase { press: { selector?: SelectorInput; key: string } }
export interface ExpectVisibleStep extends StepBase { expectVisible: SelectorInput }
export interface ExpectHiddenStep extends StepBase { expectHidden: SelectorInput }
export interface ExpectTextStep extends StepBase { expectText: string | { selector: SelectorInput; text: string } }
export interface ExpectNoTextStep extends StepBase { expectNoText: string }
export interface ExpectUrlStep extends StepBase { expectUrl: string }
export interface WaitForStep extends StepBase { waitFor: SelectorInput | number }
export interface ScreenshotStep extends StepBase { screenshot: string }

/** Internal step used by presets; never accepted from YAML. */
export interface CustomStep extends StepBase {
  custom: (ctx: StepContext) => Promise<void>;
}

export type Step =
  | GotoStep
  | ClickStep
  | FillStep
  | SelectStep
  | CheckStep
  | PressStep
  | ExpectVisibleStep
  | ExpectHiddenStep
  | ExpectTextStep
  | ExpectNoTextStep
  | ExpectUrlStep
  | WaitForStep
  | ScreenshotStep
  | CustomStep;

export const STEP_ACTIONS = [
  'goto',
  'click',
  'fill',
  'select',
  'check',
  'press',
  'expectVisible',
  'expectHidden',
  'expectText',
  'expectNoText',
  'expectUrl',
  'waitFor',
  'screenshot',
] as const;

export interface Stage {
  name: string;
  steps: Step[];
  /**
   * Marks a stage that is intentionally not executed (e.g. real payments in safe mode).
   * It is reported as "not tested" with this reason.
   */
  notTestedReason?: string;
}

export interface JourneyConfig {
  name?: string;
  preset?: string;
  /** Preset-specific options. */
  options?: Record<string, unknown>;
  /** Flat list of steps (each becomes its own stage unless `stages` is used). */
  steps?: Step[];
  stages?: Stage[];
  /** Override check interval for this journey, e.g. "24h" for contact forms. */
  interval?: string;
  /** Override settings.retries for this journey. */
  retries?: number;
  enabled?: boolean;
}

export interface SiteConfig {
  name: string;
  url: string;
  journeys: JourneyConfig[];
  /** Extra headers sent with every request for this site (e.g. a WAF allowlist token). */
  headers?: Record<string, string>;
  interval?: string;
}

export interface AlertConfig {
  type: 'telegram' | 'discord' | 'slack' | 'email' | 'webhook';
  name?: string;
  // telegram
  botToken?: string;
  chatId?: string;
  // discord / slack / webhook
  webhookUrl?: string;
  url?: string;
  // email
  smtp?: string;
  from?: string;
  to?: string | string[];
}

export interface Settings {
  interval: string;
  timeout: string;
  retries: number;
  safeMode: boolean;
  language: Language;
  dataDir: string;
  keepRuns: number;
  userAgentSuffix: string;
  headers: Record<string, string>;
  viewport: { width: number; height: number };
  browser: { executablePath?: string; headless: boolean };
  report: { brandName?: string; brandUrl?: string; poweredBy: boolean };
  /** publicUrl is used to link alerts to the dashboard, e.g. https://monitor.example.com */
  dashboard: { host: string; port: number; password?: string; publicUrl?: string };
}

export interface Config {
  settings: Settings;
  alerts: AlertConfig[];
  sites: SiteConfig[];
  /** Absolute path of the config file, if loaded from disk. */
  path?: string;
}

/** A journey after presets have been expanded into concrete stages. */
export interface ResolvedJourney {
  id: string;
  name: string;
  preset?: string;
  stages: Stage[];
  intervalMs: number;
  /** Re-runs before reporting a failure (journeys that send messages default to 0: no duplicates). */
  retries?: number;
}

export interface ResolvedSite {
  id: string;
  name: string;
  url: string;
  headers: Record<string, string>;
  journeys: ResolvedJourney[];
}

export type StageStatus = 'passed' | 'failed' | 'warning' | 'not_tested';
export type RunStatus = 'passed' | 'failed' | 'warning';

export interface FailedRequest {
  url: string;
  method: string;
  status?: number;
  failure?: string;
  resourceType: string;
}

export interface Evidence {
  url?: string;
  title?: string;
  httpStatus?: number;
  screenshot?: string;
  html?: string;
  consoleErrors: string[];
  failedRequests: FailedRequest[];
  textSample?: string;
  responseHeaders?: Record<string, string>;
}

export interface Hint {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
}

export interface StepResult {
  name: string;
  status: 'passed' | 'failed' | 'warning';
  durationMs: number;
  error?: string;
}

export interface StageResult {
  name: string;
  status: StageStatus;
  durationMs: number;
  steps: StepResult[];
  error?: string;
  reason?: string;
}

export interface RunResult {
  id: string;
  siteId: string;
  siteName: string;
  siteUrl: string;
  journeyId: string;
  journeyName: string;
  status: RunStatus;
  startedAt: string;
  durationMs: number;
  attempts: number;
  stages: StageResult[];
  failedStage?: string;
  evidence?: Evidence;
  hints: Hint[];
  info: Record<string, string | number | boolean>;
  /** A stage could not be verified (CAPTCHA, bot challenge): the run proves neither failure nor recovery. */
  inconclusive?: boolean;
  /** The monitor itself failed (browser crash, configuration error); the site may be fine. */
  monitorError?: string;
}

export interface StepContext {
  page: Page;
  baseUrl: string;
  timeoutMs: number;
  safeMode: boolean;
  /** Values discovered during the run (e.g. product URL), shown in reports. */
  info: Record<string, string | number | boolean>;
  /** Record a non-fatal observation. */
  warn: (message: string) => void;
  /** HTTP status of the last main-frame navigation. */
  lastStatus: () => number | undefined;
  /** Saves a named screenshot as run evidence and returns its file name. */
  screenshot: (name: string) => Promise<string | undefined>;
  /** Requests that failed (network error or HTTP >= 400) so far in this run. */
  failedRequests: () => FailedRequest[];
  /** Extra headers for requests to the monitored site, for API calls made outside the page. */
  siteHeaders: Record<string, string>;
}
