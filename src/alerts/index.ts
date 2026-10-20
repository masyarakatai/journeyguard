import path from 'node:path';
import type { AlertConfig, RunResult, Settings } from '../types.js';
import type { JourneyState } from '../store.js';
import { buildMessage, type AlertKind, type AlertMessage } from './message.js';
import { CHANNELS } from './channels.js';
import { redact } from '../util.js';

export { buildMessage } from './message.js';
export type { AlertKind, AlertMessage } from './message.js';

/**
 * Alert only when something changes: working → broken, or broken → working.
 * Decisions are based on the last alert that was actually delivered, so an alert that could not be
 * sent (e.g. Telegram was briefly down) is retried on the next run instead of being lost.
 * Warnings (slow pages, flaky runs) are shown on the dashboard but never page anyone, and a run that
 * could not verify the broken stage (CAPTCHA, bot challenge) never counts as a recovery.
 */
export function transition(prev: JourneyState | undefined, run: RunResult): 'failure' | 'recovery' | undefined {
  if (run.monitorError) return undefined;
  if (run.status === 'failed') return prev?.alerted === 'failure' ? undefined : 'failure';
  if (run.inconclusive) return undefined;
  return prev?.alerted === 'failure' ? 'recovery' : undefined;
}

export interface DispatchResult {
  channel: string;
  ok: boolean;
  error?: string;
}

/** Sends to every channel; a channel that fails is retried once after a short pause. */
export async function dispatch(alerts: AlertConfig[], msg: AlertMessage, retryDelayMs = 3_000): Promise<DispatchResult[]> {
  const send = async (a: AlertConfig): Promise<DispatchResult> => {
    const channel = a.name ?? a.type;
    try {
      await CHANNELS[a.type](a, msg);
      return { channel, ok: true };
    } catch {
      await new Promise((r) => setTimeout(r, retryDelayMs));
      try {
        await CHANNELS[a.type](a, msg);
        return { channel, ok: true };
      } catch (e) {
        return { channel, ok: false, error: redact(String((e as Error)?.message ?? e)) };
      }
    }
  };
  return Promise.all(alerts.map(send));
}

export function messageFor(run: RunResult, kind: AlertKind, settings: Settings, runDir: string, prev?: JourneyState): AlertMessage {
  const since = prev?.failingSince ?? prev?.since;
  const downForMs = kind === 'recovery' && since ? Date.parse(run.startedAt) - Date.parse(since) : undefined;
  return buildMessage(run, kind, settings.language, {
    downForMs,
    publicUrl: settings.dashboard.publicUrl,
    screenshotPath: run.evidence?.screenshot ? path.join(runDir, run.evidence.screenshot) : undefined,
  });
}
