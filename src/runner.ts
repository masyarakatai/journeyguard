import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type {
  Evidence,
  FailedRequest,
  ResolvedJourney,
  ResolvedSite,
  RunResult,
  RunStatus,
  Settings,
  StageResult,
  StepContext,
  StepResult,
} from './types.js';
import { assertNotBlocked, describeStep, executeStep, NotTestedError, StepError } from './steps.js';
import { guardScript, orderRequestReason, SafetyError } from './safety.js';
import { diagnose } from './diagnose.js';
import { parseDuration, redact, slugify, truncate } from './util.js';

export interface RunOptions {
  settings: Settings;
  /** Directory where this run's screenshots are written. */
  artifactDir: (site: ResolvedSite, journey: ResolvedJourney, runId: string) => string;
  browser?: Browser;
  onStage?: (stage: StageResult) => void;
}

/** The browser or the page stopped working; the result says nothing about the monitored site. */
export class MonitorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MonitorError';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new StepError(`The page stopped responding during this step (no result after ${Math.round(ms / 1000)}s)`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Same site, ignoring a leading "www." so headers survive the usual www redirect. */
function sameSite(url: string, siteHost: string): boolean {
  try {
    return new URL(url).hostname.replace(/^www\./, '') === siteHost;
  } catch {
    return false;
  }
}

export function newRunId(date = new Date()): string {
  return `${date.toISOString().replace(/[:.]/g, '-')}-${randomBytes(2).toString('hex')}`;
}

export async function launchBrowser(settings: Settings): Promise<Browser> {
  const executablePath = settings.browser.executablePath || process.env.JOURNEYGUARD_CHROMIUM_PATH || undefined;
  // Docker gives /dev/shm only 64 MB; Chromium crashes on heavy pages unless it uses /tmp instead.
  return chromium.launch({ headless: settings.browser.headless, executablePath, args: ['--disable-dev-shm-usage'] });
}

async function newContext(browser: Browser, settings: Settings, site: ResolvedSite, blockedRequests: string[]): Promise<BrowserContext> {
  // A regular Chrome user agent plus an explicit JourneyGuard suffix: honest about being a monitor,
  // without tripping the "HeadlessChrome" rules that many firewalls block outright.
  const chrome = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version()} Safari/537.36`;
  const context = await browser.newContext({
    userAgent: `${chrome} ${settings.userAgentSuffix}`.trim(),
    viewport: settings.viewport,
    locale: settings.language === 'el' ? 'el-GR' : 'en-US',
    // Service-worker requests would bypass the routing below (headers and the order backstop).
    serviceWorkers: 'block',
  });
  if (settings.safeMode) await context.addInitScript({ content: guardScript() });

  // Extra headers (the X-JourneyGuard marker and any allow-list secrets) go only to the monitored
  // site. Sent to third parties they would leak secrets and trigger CORS preflights that real
  // visitors never cause, breaking payment widgets and analytics for the monitor only.
  const headers = { ...settings.headers, ...site.headers };
  const hasHeaders = Object.keys(headers).length > 0;
  if (hasHeaders || settings.safeMode) {
    const siteHost = new URL(site.url).hostname.replace(/^www\./, '');
    await context.route('**/*', async (route) => {
      const request = route.request();
      if (settings.safeMode) {
        const reason = orderRequestReason(request.method(), request.url(), request.postData() ?? '');
        if (reason) {
          blockedRequests.push(`an order request (${reason})`);
          return route.abort('blockedbyclient').catch(() => undefined);
        }
      }
      if (!hasHeaders || !sameSite(request.url(), siteHost)) return route.continue().catch(() => undefined);
      const all = await request.allHeaders().catch(() => request.headers());
      // Never leave a request hanging if the override is rejected: continue it unchanged instead.
      return route.continue({ headers: { ...all, ...headers } }).catch(() => route.continue().catch(() => undefined));
    });
  }
  return context;
}

async function captureEvidence(page: Page, dir: string, consoleErrors: string[], failedRequests: FailedRequest[], status?: number): Promise<Evidence> {
  const evidence: Evidence = {
    url: page.url(),
    httpStatus: status,
    consoleErrors: consoleErrors.slice(-20),
    failedRequests: failedRequests.slice(-30),
  };
  // Every call is bounded: a page stuck in an endless script must not stall the monitor.
  evidence.title = await withTimeout(page.title(), 3_000, undefined);
  evidence.textSample = truncate((await withTimeout(page.locator('body').innerText({ timeout: 3_000 }), 4_000, '')).trim(), 3_000);
  await mkdir(dir, { recursive: true }).catch(() => undefined);
  const shot = await withTimeout(page.screenshot({ path: path.join(dir, 'failure.png'), timeout: 10_000 }).then(() => true), 12_000, false);
  if (shot) evidence.screenshot = 'failure.png';
  const html = await withTimeout(page.content(), 5_000, '');
  if (html) {
    await writeFile(path.join(dir, 'failure.html'), html).catch(() => undefined);
    evidence.html = 'failure.html';
  }
  return evidence;
}

async function attempt(browser: Browser, site: ResolvedSite, journey: ResolvedJourney, runId: string, opts: RunOptions): Promise<Omit<RunResult, 'attempts'>> {
  const { settings } = opts;
  const startedAt = new Date();
  const dir = opts.artifactDir(site, journey, runId);
  if (!browser.isConnected()) throw new MonitorError('The browser is not running');
  const blockedRequests: string[] = [];
  const context = await newContext(browser, settings, site, blockedRequests);
  const page = await context.newPage();
  const defaultTimeout = parseDuration(settings.timeout);
  page.setDefaultTimeout(defaultTimeout);

  // Watchdog: if the whole journey overruns its step budget (e.g. a script freezes the page),
  // closing the context makes every pending call fail fast instead of hanging forever.
  const budget = journey.stages.reduce(
    (sum, st) => sum + st.steps.reduce((a, s) => a + (s.timeout !== undefined ? parseDuration(s.timeout) : defaultTimeout) + 2_000, 0),
    0,
  );
  let timedOut = false;
  const watchdog = setTimeout(() => {
    timedOut = true;
    void context.close().catch(() => undefined);
  }, Math.min(budget + 60_000, 20 * 60_000));

  const consoleErrors: string[] = [];
  const failedRequests: FailedRequest[] = [];
  let lastStatus: number | undefined;
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(truncate(m.text(), 500));
  });
  page.on('pageerror', (e) => consoleErrors.push(truncate(`Uncaught ${e.name}: ${e.message}`, 500)));
  page.on('requestfailed', (r) => {
    const failure = r.failure()?.errorText ?? 'failed';
    // Aborted requests are usually the page navigating away, not a fault.
    if (failure.includes('ERR_ABORTED')) return;
    failedRequests.push({ url: redact(r.url()), method: r.method(), failure, resourceType: r.resourceType() });
  });
  page.on('response', (r) => {
    const req = r.request();
    if (req.isNavigationRequest() && req.frame() === page.mainFrame()) lastStatus = r.status();
    if (r.status() >= 400) failedRequests.push({ url: redact(r.url()), method: req.method(), status: r.status(), resourceType: req.resourceType() });
  });

  const info: Record<string, string | number | boolean> = {};
  const stages: StageResult[] = [];
  let failedStage: string | undefined;
  let blocked: { reason: string; status: 'failed' | 'not_tested' } | undefined;
  let evidence: Evidence | undefined;
  let runtimeNotTested = false;

  for (const stage of journey.stages) {
    if (blocked) {
      const result: StageResult = {
        name: stage.name,
        status: 'not_tested',
        durationMs: 0,
        steps: [],
        reason: stage.notTestedReason ?? blocked.reason,
      };
      stages.push(result);
      opts.onStage?.(result);
      continue;
    }
    if (stage.notTestedReason) {
      const result: StageResult = { name: stage.name, status: 'not_tested', durationMs: 0, steps: [], reason: stage.notTestedReason };
      stages.push(result);
      opts.onStage?.(result);
      continue;
    }

    const stageStart = Date.now();
    const steps: StepResult[] = [];
    const warnings: string[] = [];
    let stageError: string | undefined;
    let stageNotTested: string | undefined;

    for (const step of stage.steps) {
      const timeout = step.timeout !== undefined ? parseDuration(step.timeout) : defaultTimeout;
      const ctx: StepContext = {
        page,
        baseUrl: site.url,
        timeoutMs: timeout,
        safeMode: settings.safeMode,
        info,
        warn: (m) => warnings.push(m),
        lastStatus: () => lastStatus,
        failedRequests: () => failedRequests,
        siteHeaders: { ...settings.headers, ...site.headers },
        screenshot: async (name) => {
          await mkdir(dir, { recursive: true });
          const file = `${slugify(name)}.png`;
          await page.screenshot({ path: path.join(dir, file) }).catch(() => undefined);
          return file;
        },
      };
      const t0 = Date.now();
      try {
        // A page stuck in an endless script must not stall the run: cap every step generously.
        await withDeadline(executeStep(step, ctx, timeout), timeout * 3 + 15_000);
        // Catches order/payment actions triggered indirectly, e.g. by a custom step or a page script.
        if (settings.safeMode) {
          if (blockedRequests.length) throw new SafetyError(blockedRequests.splice(0)[0]!);
          await assertNotBlocked(page);
        }
        steps.push({ name: describeStep(step), status: 'passed', durationMs: Date.now() - t0 });
      } catch (e) {
        const err = e as Error;
        if (!browser.isConnected()) {
          clearTimeout(watchdog);
          throw new MonitorError('The browser crashed during the check');
        }
        const message = timedOut
          ? 'The page stopped responding (the journey exceeded its time budget)'
          : redact(err.message.split('\n')[0] ?? String(err));
        if (err instanceof NotTestedError) {
          steps.push({ name: describeStep(step), status: 'warning', durationMs: Date.now() - t0, error: message });
          stageNotTested = message;
          break;
        }
        if (step.optional) {
          steps.push({ name: describeStep(step), status: 'warning', durationMs: Date.now() - t0, error: message });
          warnings.push(message);
          continue;
        }
        steps.push({ name: describeStep(step), status: 'failed', durationMs: Date.now() - t0, error: message });
        stageError = message;
        break;
      }
    }

    const result: StageResult = {
      name: stage.name,
      status: stageError ? 'failed' : stageNotTested ? 'not_tested' : warnings.length ? 'warning' : 'passed',
      durationMs: Date.now() - stageStart,
      steps,
      error: stageError,
      reason: stageNotTested ?? (warnings.length ? warnings.join('; ') : undefined),
    };
    stages.push(result);
    opts.onStage?.(result);

    if (stageError) {
      failedStage = stage.name;
      evidence = await captureEvidence(page, dir, consoleErrors, failedRequests, lastStatus);
      blocked = {
        reason: settings.language === 'el' ? `Δεν έγινε: απέτυχε το «${stage.name}»` : `Not reached: "${stage.name}" failed`,
        status: 'failed',
      };
    } else if (stageNotTested) {
      runtimeNotTested = true;
      blocked = {
        reason: settings.language === 'el' ? `Δεν έγινε: δεν ελέγχθηκε το «${stage.name}»` : `Not reached: "${stage.name}" could not be tested`,
        status: 'not_tested',
      };
    }
  }

  clearTimeout(watchdog);
  await context.close().catch(() => undefined);

  let status: RunStatus = 'passed';
  if (failedStage) status = 'failed';
  else if (runtimeNotTested || stages.some((s) => s.status === 'warning')) status = 'warning';

  const run: Omit<RunResult, 'attempts'> = {
    id: runId,
    siteId: site.id,
    siteName: site.name,
    siteUrl: site.url,
    journeyId: journey.id,
    journeyName: journey.name,
    status,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    stages,
    failedStage,
    evidence,
    hints: [],
    info,
  };
  if (runtimeNotTested) run.inconclusive = true;
  if (!evidence && status !== 'passed') {
    run.evidence = { url: undefined, consoleErrors: consoleErrors.slice(-20), failedRequests: failedRequests.slice(-30) };
  }
  return run;
}

/** Runs one journey, retrying failures so a single network blip does not wake anyone up. */
export async function runJourney(site: ResolvedSite, journey: ResolvedJourney, opts: RunOptions): Promise<RunResult> {
  const ownBrowser = !opts.browser;
  const browser = opts.browser ?? (await launchBrowser(opts.settings));
  try {
    const runId = newRunId();
    let attempts = 0;
    let result: Omit<RunResult, 'attempts'>;
    do {
      attempts++;
      result = await attempt(browser, site, journey, runId, attempts === 1 ? opts : { ...opts, onStage: undefined });
      if (result.status === 'failed' && !browser.isConnected()) throw new MonitorError('The browser crashed during the check');
    } while (result.status === 'failed' && attempts <= (journey.retries ?? opts.settings.retries));

    const final: RunResult = { ...result, attempts };
    if (attempts > 1 && final.status !== 'failed') {
      final.status = 'warning';
      final.info.flaky = true;
    }
    final.hints = diagnose(final, opts.settings.language);
    return final;
  } finally {
    if (ownBrowser) await browser.close().catch(() => undefined);
  }
}
