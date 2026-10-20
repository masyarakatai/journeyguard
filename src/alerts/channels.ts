import { readFile } from 'node:fs/promises';
import nodemailer from 'nodemailer';
import type { AlertConfig } from '../types.js';
import type { AlertMessage } from './message.js';
import { truncate } from '../util.js';

async function screenshotBlob(msg: AlertMessage): Promise<Blob | undefined> {
  if (!msg.screenshotPath) return undefined;
  try {
    return new Blob([new Uint8Array(await readFile(msg.screenshotPath))], { type: 'image/png' });
  } catch {
    return undefined;
  }
}

async function check(res: Response, channel: string): Promise<void> {
  if (!res.ok) throw new Error(`${channel} responded HTTP ${res.status}: ${truncate(await res.text().catch(() => ''), 200)}`);
}

export async function sendTelegram(cfg: AlertConfig, msg: AlertMessage): Promise<void> {
  const base = `https://api.telegram.org/bot${cfg.botToken}`;
  await check(
    await fetch(`${base}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.chatId, text: truncate(msg.telegramHtml, 4000), parse_mode: 'HTML', disable_web_page_preview: true }),
    }),
    'Telegram',
  );
  // The text alert has been delivered; the screenshot is a bonus, so its failure must not make
  // the whole alert count as failed (that would resend the text on the next run).
  const photo = await screenshotBlob(msg);
  if (photo) {
    const form = new FormData();
    form.set('chat_id', String(cfg.chatId));
    form.set('photo', photo, 'failure.png');
    await fetch(`${base}/sendPhoto`, { method: 'POST', body: form }).catch(() => undefined);
  }
}

export async function sendDiscord(cfg: AlertConfig, msg: AlertMessage): Promise<void> {
  const color = msg.kind === 'recovery' ? 0x15803d : msg.kind === 'test' ? 0x2563eb : 0xb91c1c;
  const photo = await screenshotBlob(msg);
  const payload = {
    username: 'JourneyGuard',
    embeds: [
      {
        title: truncate(msg.title, 250),
        url: msg.link ?? msg.run.siteUrl,
        description: truncate(msg.text.split('\n').slice(2).join('\n'), 4000),
        color,
        image: photo ? { url: 'attachment://failure.png' } : undefined,
        timestamp: msg.run.startedAt,
      },
    ],
  };
  if (photo) {
    const form = new FormData();
    form.set('payload_json', JSON.stringify(payload));
    form.set('files[0]', photo, 'failure.png');
    const res = await fetch(cfg.webhookUrl!, { method: 'POST', body: form }).catch(() => undefined);
    if (res?.ok) return;
    // Fall back to a text-only alert if the upload was rejected (e.g. size limits).
    payload.embeds[0]!.image = undefined;
  }
  await check(
    await fetch(cfg.webhookUrl!, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }),
    'Discord',
  );
}

export async function sendSlack(cfg: AlertConfig, msg: AlertMessage): Promise<void> {
  await check(
    await fetch(cfg.webhookUrl!, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: truncate(msg.text, 3000) }),
    }),
    'Slack',
  );
}

export async function sendWebhook(cfg: AlertConfig, msg: AlertMessage): Promise<void> {
  const { run } = msg;
  await check(
    await fetch(cfg.url!, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'JourneyGuard' },
      body: JSON.stringify({
        event: msg.kind,
        title: msg.title,
        text: msg.text,
        link: msg.link,
        site: { id: run.siteId, name: run.siteName, url: run.siteUrl },
        journey: { id: run.journeyId, name: run.journeyName },
        status: run.status,
        failedStage: run.failedStage,
        stages: run.stages.map((s) => ({ name: s.name, status: s.status, error: s.error, reason: s.reason })),
        hints: run.hints,
        startedAt: run.startedAt,
        runId: run.id,
      }),
    }),
    'Webhook',
  );
}

export async function sendEmail(cfg: AlertConfig, msg: AlertMessage): Promise<void> {
  const transport = nodemailer.createTransport(cfg.smtp!);
  const attachments = msg.screenshotPath
    ? [{ filename: 'failure.png', path: msg.screenshotPath, cid: 'failure-screenshot' }]
    : [];
  await transport.sendMail({
    from: cfg.from,
    to: Array.isArray(cfg.to) ? cfg.to.join(', ') : cfg.to,
    subject: msg.title,
    text: msg.text,
    html: msg.emailHtml,
    attachments,
  });
}

export const CHANNELS: Record<AlertConfig['type'], (cfg: AlertConfig, msg: AlertMessage) => Promise<void>> = {
  telegram: sendTelegram,
  discord: sendDiscord,
  slack: sendSlack,
  webhook: sendWebhook,
  email: sendEmail,
};
