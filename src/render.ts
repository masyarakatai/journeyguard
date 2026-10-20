import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Language, RunResult, StageStatus } from './types.js';
import { localizeError, statusLabel, t } from './i18n.js';
import { escapeHtml as h, formatDuration } from './util.js';

const CSS = readFileSync(fileURLToPath(new URL('./dashboard/styles.css', import.meta.url)), 'utf8');

export const LOGO_SVG = `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2 4 6.5v8.7c0 7.4 5.1 13.6 12 15.3 6.9-1.7 12-7.9 12-15.3V6.5L16 2Z" fill="var(--accent)"/><path d="M9.5 19.5h4l2-6 2 9 2-5h3" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export interface JourneyView {
  siteId: string;
  siteName: string;
  siteUrl: string;
  journeyId: string;
  journeyName: string;
  intervalMs: number;
  latest?: RunResult;
  history: { status: RunResult['status']; startedAt: string; id: string }[];
  nextRunAt?: number;
}

export interface RenderOptions {
  lang: Language;
  /** Returns the image src for a run artifact (URL for the dashboard, data: URI for reports). */
  artifactSrc: (run: RunResult, file: string) => string | undefined;
  runButton?: boolean;
}

const INFO_LABELS: Record<string, [string, string, (v: string | number | boolean) => string]> = {
  homepageLoadMs: ['Homepage load', 'Φόρτωση αρχικής', (v) => formatDuration(Number(v))],
  product: ['Product', 'Προϊόν', String],
  cartItems: ['Items in cart', 'Τεμάχια στο καλάθι', String],
  paymentMethods: ['Payment methods', 'Τρόποι πληρωμής', String],
  gateways: ['Payment providers', 'Πάροχοι πληρωμών', String],
  form: ['Form', 'Φόρμα', String],
  fieldsFilled: ['Form fields filled', 'Πεδία φόρμας', String],
  sslDaysLeft: ['SSL expires in (days)', 'Λήξη SSL σε (ημέρες)', String],
  sslIssuer: ['SSL issuer', 'Εκδότης SSL', String],
  flaky: ['Passed on retry', 'Πέρασε στη 2η προσπάθεια', () => '✓'],
  variationSelected: ['Product options chosen', 'Επιλογές προϊόντος', () => '✓'],
  freeOrder: ['Free order (no payment step)', 'Δωρεάν παραγγελία (χωρίς πληρωμή)', () => '✓'],
};

/** Human-readable observations, hiding internal values such as URLs used between stages. */
export function infoList(info: Record<string, string | number | boolean>, lang: Language = 'en'): [string, string][] {
  return Object.entries(info)
    .filter(([k]) => !['productUrl', 'cartUrl'].includes(k))
    .map(([k, v]) => {
      const label = INFO_LABELS[k];
      return label ? [label[lang === 'el' ? 1 : 0], label[2](v)] : [k, String(v)];
    });
}

function pill(status: StageStatus | 'none', lang: Language): string {
  const label = status === 'none' ? '—' : statusLabel(lang, status);
  return `<span class="pill s-${status}">${h(label)}</span>`;
}

function timeAgo(iso: string, lang: Language): string {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  const [n, unit] =
    s < 60 ? [s, lang === 'el' ? 'δευτ.' : 's'] : s < 3600 ? [Math.round(s / 60), lang === 'el' ? 'λεπ.' : 'm'] : s < 86_400 ? [Math.round(s / 3600), lang === 'el' ? 'ώρ.' : 'h'] : [Math.round(s / 86_400), lang === 'el' ? 'ημ.' : 'd'];
  return lang === 'el' ? `πριν ${n} ${unit}` : `${n}${unit} ago`;
}

function renderEvidence(run: RunResult, opts: RenderOptions): string {
  const ev = run.evidence;
  if (!ev) return '';
  const img = ev.screenshot ? opts.artifactSrc(run, ev.screenshot) : undefined;
  const parts: string[] = [];
  if (img) parts.push(`<div><div class="small muted">${h(t(opts.lang, 'screenshot'))}</div>${img.startsWith('data:') ? '' : `<a href="${h(img)}" target="_blank" rel="noopener">`}<img class="shot" loading="lazy" src="${h(img)}" alt="Screenshot">${img.startsWith('data:') ? '' : '</a>'}</div>`);
  if (ev.url) parts.push(`<div class="small"><b>URL:</b> <code>${h(ev.url)}</code>${ev.httpStatus ? ` · HTTP ${ev.httpStatus}` : ''}</div>`);
  if (ev.consoleErrors.length) {
    parts.push(`<div><b class="small">${h(t(opts.lang, 'consoleErrors'))}</b><ul>${ev.consoleErrors.slice(-8).map((e) => `<li><code>${h(e)}</code></li>`).join('')}</ul></div>`);
  }
  if (ev.failedRequests.length) {
    parts.push(
      `<div><b class="small">${h(t(opts.lang, 'failedRequests'))}</b><ul>${ev.failedRequests
        .slice(-10)
        .map((r) => `<li><code>${h(r.method)} ${h(r.url)} → ${h(r.status ?? r.failure ?? '')}</code></li>`)
        .join('')}</ul></div>`,
    );
  }
  if (!parts.length) return '';
  return `<details${run.status === 'failed' ? ' open' : ''}><summary>${h(t(opts.lang, 'evidence'))}</summary><div class="evidence">${parts.join('')}</div></details>`;
}

export function renderJourney(v: JourneyView, opts: RenderOptions): string {
  const run = v.latest;
  const status: StageStatus | 'none' = run?.status ?? 'none';
  const head = `<div class="journey-head"><h3>${h(v.journeyName)}</h3>${pill(status, opts.lang)}<span class="spacer"></span>${
    run ? `<span class="small muted" title="${h(run.startedAt)}">${h(t(opts.lang, 'lastRun'))}: ${h(timeAgo(run.startedAt, opts.lang))} · ${h(formatDuration(run.durationMs))}</span>` : ''
  }${opts.runButton ? `<button class="btn" data-run="${h(v.siteId)}/${h(v.journeyId)}" data-running="${h(t(opts.lang, 'running'))}" data-queued="${h(t(opts.lang, 'queued'))}">${h(t(opts.lang, 'runNow'))}</button>` : ''}</div>`;

  if (!run) return `<div class="journey" id="${h(v.siteId)}/${h(v.journeyId)}">${head}<p class="small muted">${h(t(opts.lang, 'noRuns'))}</p></div>`;

  const stages = `<div class="stages">${run.stages
    .map(
      (s) =>
        `<div class="stage st-${s.status}" title="${h(localizeError(s.error ?? s.reason ?? '', opts.lang))}"><div class="name">${h(s.name)}</div><div class="status">${h(statusLabel(opts.lang, s.status))}</div></div>`,
    )
    .join('')}</div>`;

  const failed = run.stages.find((s) => s.status === 'failed');
  let problem = '';
  if (failed) {
    problem = `<div class="alert-box"><h4>${h(t(opts.lang, 'failedAt'))}: ${h(failed.name)}</h4><div class="err">${h(localizeError(failed.error ?? '', opts.lang))}</div>${run.hints
      .map((x) => `<div class="hint ${x.severity}"><b>${h(x.title)}</b>${h(x.detail)}</div>`)
      .join('')}</div>`;
  } else if (run.hints.length) {
    problem = run.hints.map((x) => `<div class="hint ${x.severity}"><b>${h(x.title)}</b>${h(x.detail)}</div>`).join('');
  }
  const notes = run.stages.filter((s) => s.status !== 'failed' && s.reason).map((s) => `<li><b>${h(s.name)}:</b> ${h(localizeError(s.reason!, opts.lang))}</li>`);
  const notesHtml = notes.length ? `<details><summary>${h(t(opts.lang, 'discovered'))}</summary><ul class="small">${notes.join('')}</ul></details>` : '';

  const infoEntries = infoList(run.info, opts.lang);
  const info = infoEntries.length
    ? `<div class="kv">${infoEntries.map(([k, val]) => `<span>${h(k)}: <b>${h(val)}</b></span>`).join('')}</div>`
    : '';

  const history = v.history.length
    ? `<div class="history" aria-label="${h(t(opts.lang, 'history'))}">${v.history
        .slice(0, 60)
        .reverse()
        .map((r) => `<span class="${r.status}" title="${h(r.startedAt)} · ${h(r.status)}"></span>`)
        .join('')}</div>`
    : '';

  return `<div class="journey" id="${h(v.siteId)}/${h(v.journeyId)}">${head}${stages}${problem}${info}${history}${renderEvidence(run, opts)}${notesHtml}</div>`;
}

export function renderSites(views: JourneyView[], opts: RenderOptions): string {
  const bySite = new Map<string, JourneyView[]>();
  for (const v of views) bySite.set(v.siteId, [...(bySite.get(v.siteId) ?? []), v]);
  return [...bySite.values()]
    .map((list) => {
      const first = list[0]!;
      return `<section class="site"><div class="site-head"><h2>${h(first.siteName)}</h2><a class="small" href="${h(first.siteUrl)}" rel="noopener" target="_blank">${h(first.siteUrl)}</a></div>${list
        .map((v) => renderJourney(v, opts))
        .join('')}</section>`;
    })
    .join('');
}

export function summaryPills(views: JourneyView[], lang: Language): string {
  const count = (s: string) => views.filter((v) => (v.latest?.status ?? 'none') === s).length;
  return [
    count('failed') ? `<span class="pill s-failed">${count('failed')} ${h(statusLabel(lang, 'failed'))}</span>` : '',
    count('warning') ? `<span class="pill s-warning">${count('warning')} ${h(statusLabel(lang, 'warning'))}</span>` : '',
    `<span class="pill s-passed">${count('passed')} ${h(statusLabel(lang, 'passed'))}</span>`,
  ].join('');
}

export function page(opts: { title: string; lang: Language; body: string; head?: string; script?: string }): string {
  return `<!doctype html>
<html lang="${opts.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${h(opts.title)}</title>
<style>${CSS}</style>
${opts.head ?? ''}
</head>
<body>
${opts.body}
${opts.script ? `<script>${opts.script}</script>` : ''}
</body>
</html>`;
}
