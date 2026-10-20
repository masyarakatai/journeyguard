import { mkdir, readdir, readFile, rm, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import type { ResolvedJourney, ResolvedSite, RunResult, RunStatus } from './types.js';

export interface JourneyState {
  status: RunStatus;
  since: string;
  lastRunAt: string;
  lastRunId: string;
  /** The last alert that actually reached at least one channel. */
  alerted?: 'failure' | 'recovery';
  /** When the outage that was alerted on started, for the downtime in the recovery message. */
  failingSince?: string;
}

/**
 * Plain-file storage: one folder per run with run.json plus screenshots.
 * Easy to back up, inspect and delete, and needs no database server.
 */
export class Store {
  constructor(readonly dataDir: string) {}

  runsDir(siteId: string, journeyId: string): string {
    return path.join(this.dataDir, 'runs', siteId, journeyId);
  }

  artifactDir = (site: ResolvedSite, journey: ResolvedJourney, runId: string): string =>
    path.join(this.runsDir(site.id, journey.id), runId);

  async saveRun(run: RunResult, keep: number): Promise<void> {
    const dir = path.join(this.runsDir(run.siteId, run.journeyId), run.id);
    await mkdir(dir, { recursive: true });
    await writeJsonAtomic(path.join(dir, 'run.json'), run);
    await this.prune(run.siteId, run.journeyId, keep);
  }

  private async runIds(siteId: string, journeyId: string): Promise<string[]> {
    try {
      const entries = await readdir(this.runsDir(siteId, journeyId), { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort().reverse();
    } catch {
      return [];
    }
  }

  private async prune(siteId: string, journeyId: string, keep: number): Promise<void> {
    const ids = await this.runIds(siteId, journeyId);
    for (const id of ids.slice(Math.max(keep, 1))) {
      await rm(path.join(this.runsDir(siteId, journeyId), id), { recursive: true, force: true });
    }
  }

  async listRuns(siteId: string, journeyId: string, limit = 50): Promise<RunResult[]> {
    const ids = (await this.runIds(siteId, journeyId)).slice(0, limit);
    const runs: RunResult[] = [];
    for (const id of ids) {
      try {
        runs.push(JSON.parse(await readFile(path.join(this.runsDir(siteId, journeyId), id, 'run.json'), 'utf8')) as RunResult);
      } catch {
        // A run still being written or a stray folder; skip it.
      }
    }
    return runs;
  }

  async latestRun(siteId: string, journeyId: string): Promise<RunResult | undefined> {
    return (await this.listRuns(siteId, journeyId, 1))[0];
  }

  /** Resolves a stored artifact path, refusing anything outside the data directory. */
  artifactPath(siteId: string, journeyId: string, runId: string, file: string): string | undefined {
    const safe = [siteId, journeyId, runId, file].every((p) => /^[A-Za-z0-9._-]+$/.test(p) && !p.includes('..'));
    if (!safe) return undefined;
    return path.join(this.runsDir(siteId, journeyId), runId, file);
  }

  private get statePath(): string {
    return path.join(this.dataDir, 'state.json');
  }

  async readState(): Promise<Record<string, JourneyState>> {
    try {
      return JSON.parse(await readFile(this.statePath, 'utf8')) as Record<string, JourneyState>;
    } catch {
      return {};
    }
  }

  async writeState(state: Record<string, JourneyState>): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    await writeJsonAtomic(this.statePath, state);
  }
}

async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, file);
}

export function stateKey(siteId: string, journeyId: string): string {
  return `${siteId}/${journeyId}`;
}
