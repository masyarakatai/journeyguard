import type { Browser } from 'playwright';
import type { Config, ResolvedJourney, ResolvedSite, RunResult } from './types.js';
import { launchBrowser, MonitorError, newRunId, runJourney } from './runner.js';
import { Store, stateKey } from './store.js';
import { buildMessage, dispatch, messageFor, transition } from './alerts/index.js';
import { redact } from './util.js';

/** After this many checks in a row that could not run, the monitor itself is reported as broken. */
const MONITOR_FAILURE_THRESHOLD = 3;

export interface EngineEvents {
  onResult?: (run: RunResult) => void;
  onAlert?: (title: string, results: { channel: string; ok: boolean; error?: string }[]) => void;
  onError?: (message: string) => void;
}

type Target = { site: ResolvedSite; journey: ResolvedJourney };

/** Runs journeys, stores results, and sends alerts on state changes. */
export class Engine {
  readonly store: Store;
  private queue: Promise<unknown> = Promise.resolve();
  private pending = new Set<string>();
  private monitorErrorsInRow = 0;
  private monitorAlerted = false;
  private lastRealCheck = 0;
  private readonly startedAt = Date.now();

  constructor(
    readonly config: Config,
    readonly sites: ResolvedSite[],
    private readonly events: EngineEvents = {},
    private readonly options: { save: boolean; alert: boolean } = { save: true, alert: true },
  ) {
    this.store = new Store(config.settings.dataDir);
  }

  /** True while the journey is queued or running (used to refuse duplicate "run now" requests). */
  isPending(siteId: string, journeyId: string): boolean {
    return this.pending.has(stateKey(siteId, journeyId));
  }

  /**
   * Is the monitor actually able to check? False after repeated monitor errors, or when no real
   * check has completed for twice the longest journey interval (plus a grace period after start).
   */
  healthy(): boolean {
    if (this.monitorErrorsInRow >= MONITOR_FAILURE_THRESHOLD) return false;
    const longest = Math.max(0, ...this.sites.flatMap((s) => s.journeys.map((j) => j.intervalMs)));
    const since = this.lastRealCheck || this.startedAt;
    return Date.now() - since < longest * 2 + 10 * 60_000;
  }

  /** Runs the given journeys one after another in a shared browser. Calls are serialised. */
  run(targets: Target[]): Promise<RunResult[]> {
    const fresh = targets.filter((t) => !this.pending.has(stateKey(t.site.id, t.journey.id)));
    for (const t of fresh) this.pending.add(stateKey(t.site.id, t.journey.id));
    const job = this.queue.then(() => this.runNow(fresh)).finally(() => {
      // Normally released one by one in runNow; this also covers a batch that threw.
      for (const t of fresh) this.pending.delete(stateKey(t.site.id, t.journey.id));
    });
    this.queue = job.catch(() => undefined);
    return job;
  }

  runAll(): Promise<RunResult[]> {
    return this.run(this.sites.flatMap((site) => site.journeys.map((journey) => ({ site, journey }))));
  }

  private async runNow(targets: Target[]): Promise<RunResult[]> {
    if (!targets.length) return [];
    const results: RunResult[] = [];
    let browser: Browser | undefined;
    const ensureBrowser = async () => {
      if (!browser || !browser.isConnected()) {
        await browser?.close().catch(() => undefined);
        browser = await launchBrowser(this.config.settings);
      }
      return browser;
    };
    try {
      for (const { site, journey } of targets) {
        let run: RunResult | undefined;
        let lastError = '';
        // One extra try when the browser itself crashed, so an OOM kill is not reported as an outage.
        for (let attempt = 0; attempt < 2 && !run; attempt++) {
          try {
            run = await runJourney(site, journey, { settings: this.config.settings, artifactDir: this.store.artifactDir, browser: await ensureBrowser() });
          } catch (e) {
            lastError = redact((e as Error).message.split('\n')[0] ?? String(e));
            if (!(e instanceof MonitorError) && browser?.isConnected()) break;
          }
        }
        if (!run) {
          this.events.onError?.(`${site.name} / ${journey.name}: ${lastError}`);
          run = monitorErrorRun(site, journey, lastError);
        }
        try {
          await this.record(site, journey, run);
        } catch (e) {
          this.events.onError?.(`Could not save the result for ${site.name} / ${journey.name}: ${(e as Error).message}`);
        }
        results.push(run);
        this.pending.delete(stateKey(site.id, journey.id));
        this.events.onResult?.(run);
        await this.trackMonitorHealth(run);
      }
    } finally {
      await browser?.close().catch(() => undefined);
    }
    return results;
  }

  /** Tells the owner (once) when JourneyGuard itself cannot run checks, and when it recovers. */
  private async trackMonitorHealth(run: RunResult): Promise<void> {
    if (!run.monitorError) {
      this.monitorErrorsInRow = 0;
      this.lastRealCheck = Date.now();
      if (this.monitorAlerted) {
        this.monitorAlerted = false;
        await this.sendMonitorAlert(run, 'recovery');
      }
      return;
    }
    this.monitorErrorsInRow++;
    if (this.monitorErrorsInRow >= MONITOR_FAILURE_THRESHOLD && !this.monitorAlerted) {
      this.monitorAlerted = await this.sendMonitorAlert(run, 'monitor');
    }
  }

  private async sendMonitorAlert(run: RunResult, kind: 'monitor' | 'recovery'): Promise<boolean> {
    if (!this.options.alert || !this.config.alerts.length) return false;
    const msg = buildMessage(run, kind === 'monitor' ? 'monitor' : 'monitor-recovered', this.config.settings.language, {
      publicUrl: this.config.settings.dashboard.publicUrl,
    });
    const results = await dispatch(this.config.alerts, msg);
    this.events.onAlert?.(msg.title, results);
    return results.some((r) => r.ok);
  }

  private async record(site: ResolvedSite, journey: ResolvedJourney, run: RunResult): Promise<void> {
    if (!this.options.save) return;
    // Saving the run is best effort: a full disk must never stop a failure alert from going out.
    await this.store.saveRun(run, this.config.settings.keepRuns).catch((e: Error) => {
      this.events.onError?.(`Could not save the run for ${site.name} / ${journey.name}: ${e.message}`);
    });
    if (run.monitorError) return; // says nothing about the site: leave its state alone

    const state = await this.store.readState();
    const key = stateKey(site.id, journey.id);
    const prev = state[key];
    const kind = transition(prev, run);
    const next = {
      status: run.status,
      since: prev && prev.status === run.status ? prev.since : run.startedAt,
      lastRunAt: run.startedAt,
      lastRunId: run.id,
      alerted: prev?.alerted,
      // Start of the current outage; kept until it is resolved so downtime is measured correctly.
      failingSince: run.status === 'failed' ? (prev?.failingSince ?? run.startedAt) : prev?.failingSince,
    };

    if (kind && this.options.alert && this.config.alerts.length) {
      const msg = messageFor(run, kind, this.config.settings, this.store.artifactDir(site, journey, run.id), prev);
      const results = await dispatch(this.config.alerts, msg);
      this.events.onAlert?.(msg.title, results);
      if (results.some((r) => r.ok)) {
        next.alerted = kind;
        if (kind === 'recovery') next.failingSince = undefined;
      }
    } else if (!kind && run.status !== 'failed' && !run.inconclusive && prev?.alerted !== 'failure') {
      next.failingSince = undefined;
    }
    state[key] = next;
    await this.store.writeState(state).catch((e: Error) => {
      this.events.onError?.(`Could not save the alert state: ${e.message}`);
    });
  }
}

/** A placeholder result shown on the dashboard when the monitor itself failed. Never alerts. */
function monitorErrorRun(site: ResolvedSite, journey: ResolvedJourney, message: string): RunResult {
  const startedAt = new Date().toISOString();
  return {
    id: newRunId(),
    siteId: site.id,
    siteName: site.name,
    siteUrl: site.url,
    journeyId: journey.id,
    journeyName: journey.name,
    status: 'warning',
    startedAt,
    durationMs: 0,
    attempts: 1,
    stages: [{ name: 'Monitor', status: 'warning', durationMs: 0, steps: [], reason: `JourneyGuard could not run this check: ${message}` }],
    hints: [],
    info: {},
    monitorError: message,
  };
}
