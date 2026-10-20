import type { Engine } from './engine.js';
import type { ResolvedJourney, ResolvedSite } from './types.js';
import { stateKey } from './store.js';

/**
 * Runs each journey on its own interval. Journeys that are due are batched into one
 * browser session; the engine serialises batches so checks never overlap.
 */
export class Scheduler {
  private timer?: NodeJS.Timeout;
  private nextRun = new Map<string, number>();
  private busy = false;

  constructor(
    private readonly engine: Engine,
    private readonly tickMs = 15_000,
    private readonly onError?: (message: string) => void,
  ) {}

  async start(): Promise<void> {
    const state = await this.engine.store.readState();
    const now = Date.now();
    for (const site of this.engine.sites) {
      for (const journey of site.journeys) {
        const last = state[stateKey(site.id, journey.id)]?.lastRunAt;
        // Resume where we left off after a restart instead of re-running everything at once.
        const due = last ? Date.parse(last) + journey.intervalMs : now;
        this.nextRun.set(stateKey(site.id, journey.id), Math.max(now, due));
      }
    }
    await this.tick();
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  nextRunAt(siteId: string, journeyId: string): number | undefined {
    return this.nextRun.get(stateKey(siteId, journeyId));
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    const now = Date.now();
    const due: { site: ResolvedSite; journey: ResolvedJourney }[] = [];
    for (const site of this.engine.sites) {
      for (const journey of site.journeys) {
        const key = stateKey(site.id, journey.id);
        if ((this.nextRun.get(key) ?? 0) <= now) {
          due.push({ site, journey });
          this.nextRun.set(key, now + journey.intervalMs);
        }
      }
    }
    if (!due.length) return;
    this.busy = true;
    try {
      await this.engine.run(due);
    } catch (e) {
      // Never let one bad batch (disk full, browser cannot start) stop the monitor for good.
      this.onError?.(`Scheduled checks failed: ${(e as Error).message}`);
    } finally {
      this.busy = false;
    }
  }
}
