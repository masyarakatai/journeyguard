import type { Language, RunResult } from '../types.js';
import { localizeError, STATUS_ICON, statusLabel, t } from '../i18n.js';
import { escapeHtml, formatDuration } from '../util.js';

export type AlertKind = 'failure' | 'recovery' | 'test' | 'monitor' | 'monitor-recovered';

export interface AlertMessage {
  kind: AlertKind;
  title: string;
  /** Plain text body (Slack, email text part, webhooks). */
  text: string;
  /** Minimal HTML for Telegram (b, i, a, code tags only). */
  telegramHtml: string;
  /** Full HTML for email. */
  emailHtml: string;
  link?: string;
  /** Absolute path of the failure screenshot, attached where the channel supports files. */
  screenshotPath?: string;
  run: RunResult;
}

export function buildMessage(
  run: RunResult,
  kind: AlertKind,
  lang: Language,
  opts: { downForMs?: number; publicUrl?: string; screenshotPath?: string } = {},
): AlertMessage {
  const icon = kind === 'recovery' || kind === 'monitor-recovered' ? '✅' : kind === 'test' ? '🔔' : kind === 'monitor' ? '⚠️' : '❌';
  const what = (kind === 'recovery' ? t(lang, 'journeyRecovered') : kind === 'test' ? '{journey} test alert' : t(lang, 'journeyFailed')).replace('{journey}', run.journeyName);
  const title =
    kind === 'monitor'
      ? `${icon} ${t(lang, 'monitorDown')}`
      : kind === 'monitor-recovered'
        ? `${icon} ${t(lang, 'monitorUp')}`
        : `${icon} ${run.siteName}: ${what}`;
  if (kind === 'monitor' || kind === 'monitor-recovered') {
    const detail = kind === 'monitor' ? `${t(lang, 'monitorDownDetail')}\n${run.monitorError ?? ''}` : t(lang, 'monitorUpDetail');
    return {
      kind,
      title,
      text: `${title}\n\n${detail}`,
      telegramHtml: `<b>${escapeHtml(title)}</b>\n\n${escapeHtml(detail)}`,
      emailHtml: `<!doctype html><html><body style="font-family:system-ui,sans-serif"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(detail).replace(/\n/g, '<br>')}</p></body></html>`,
      run,
    };
  }

  const stageLines = run.stages.map((s) => `${STATUS_ICON[s.status]} ${s.name}: ${statusLabel(lang, s.status)}`);
  const failed = run.stages.find((s) => s.status === 'failed');
  const hint = run.hints[0];
  const link = opts.publicUrl
    ? `${opts.publicUrl.replace(/\/$/, '')}/#${encodeURIComponent(`${run.siteId}/${run.journeyId}`)}`
    : undefined;

  const lines = [title, run.siteUrl, '', ...stageLines];
  if (failed) lines.push('', `${t(lang, 'failedAt')}: ${failed.name}`, `${t(lang, 'error')}: ${localizeError(failed.error ?? '', lang)}`);
  if (hint && kind !== 'recovery') lines.push('', `${t(lang, 'likelyCause')}: ${hint.title}`, hint.detail);
  if (kind === 'recovery' && opts.downForMs) lines.push('', `Downtime: ${formatDuration(opts.downForMs)}`);
  if (link) lines.push('', link);

  const tg = [
    `<b>${escapeHtml(title)}</b>`,
    escapeHtml(run.siteUrl),
    '',
    ...stageLines.map(escapeHtml),
  ];
  if (failed) tg.push('', `<b>${escapeHtml(t(lang, 'failedAt'))}:</b> ${escapeHtml(failed.name)}`, `<code>${escapeHtml(localizeError(failed.error ?? '', lang))}</code>`);
  if (hint && kind !== 'recovery') tg.push('', `<b>${escapeHtml(t(lang, 'likelyCause'))}:</b> ${escapeHtml(hint.title)}`, `<i>${escapeHtml(hint.detail)}</i>`);
  if (kind === 'recovery' && opts.downForMs) tg.push('', `Downtime: ${formatDuration(opts.downForMs)}`);
  if (link) tg.push('', `<a href="${escapeHtml(link)}">Dashboard</a>`);

  const color = kind === 'recovery' ? '#15803d' : kind === 'test' ? '#2563eb' : '#b91c1c';
  const emailHtml = `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;max-width:640px">
<h2 style="color:${color};margin:0 0 4px">${escapeHtml(title)}</h2>
<p style="margin:0 0 16px;color:#555"><a href="${escapeHtml(run.siteUrl)}">${escapeHtml(run.siteUrl)}</a></p>
<table style="border-collapse:collapse;width:100%">${run.stages
    .map(
      (s) =>
        `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">${STATUS_ICON[s.status]} ${escapeHtml(s.name)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${escapeHtml(statusLabel(lang, s.status))}</td></tr>`,
    )
    .join('')}</table>
${failed ? `<p><b>${escapeHtml(t(lang, 'failedAt'))}:</b> ${escapeHtml(failed.name)}<br><code>${escapeHtml(localizeError(failed.error ?? '', lang))}</code></p>` : ''}
${hint && kind !== 'recovery' ? `<p style="background:#fff7ed;border-left:4px solid #f59e0b;padding:10px 12px"><b>${escapeHtml(hint.title)}</b><br>${escapeHtml(hint.detail)}</p>` : ''}
${opts.screenshotPath && kind === 'failure' ? '<p><img src="cid:failure-screenshot" alt="Screenshot" style="max-width:100%;border:1px solid #ddd"></p>' : ''}
${link ? `<p><a href="${escapeHtml(link)}">Open dashboard</a></p>` : ''}
<p style="color:#888;font-size:12px">JourneyGuard</p></body></html>`;

  return {
    kind,
    title,
    text: lines.join('\n'),
    telegramHtml: tg.join('\n'),
    emailHtml,
    link,
    screenshotPath: kind === 'failure' ? opts.screenshotPath : undefined,
    run,
  };
}
