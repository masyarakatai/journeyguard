import { readFile } from 'node:fs/promises';
import type { ResolvedSite, RunResult, Settings } from './types.js';
import type { Store } from './store.js';
import { LOGO_SVG, page, renderSites, summaryPills, type JourneyView } from './render.js';
import { t } from './i18n.js';
import { escapeHtml as h } from './util.js';

export async function buildViews(
  sites: ResolvedSite[],
  store: Store,
  nextRunAt?: (siteId: string, journeyId: string) => number | undefined,
): Promise<JourneyView[]> {
  const views: JourneyView[] = [];
  for (const site of sites) {
    for (const journey of site.journeys) {
      const runs = await store.listRuns(site.id, journey.id, 60);
      views.push({
        siteId: site.id,
        siteName: site.name,
        siteUrl: site.url,
        journeyId: journey.id,
        journeyName: journey.name,
        intervalMs: journey.intervalMs,
        latest: runs[0],
        history: runs.map((r) => ({ id: r.id, status: r.status, startedAt: r.startedAt })),
        nextRunAt: nextRunAt?.(site.id, journey.id),
      });
    }
  }
  return views;
}

/** Views built straight from fresh results, for one-off runs that are not saved. */
export function viewsFromRuns(runs: RunResult[]): JourneyView[] {
  return runs.map((r) => ({
    siteId: r.siteId,
    siteName: r.siteName,
    siteUrl: r.siteUrl,
    journeyId: r.journeyId,
    journeyName: r.journeyName,
    intervalMs: 0,
    latest: r,
    history: [{ id: r.id, status: r.status, startedAt: r.startedAt }],
  }));
}

/** A single self-contained HTML file (screenshots embedded) that can be emailed to a client. */
export async function renderReport(views: JourneyView[], settings: Settings, artifactPath: (run: RunResult, file: string) => string): Promise<string> {
  const lang = settings.language;
  const images = new Map<string, string>();
  for (const v of views) {
    const run = v.latest;
    if (!run?.evidence?.screenshot) continue;
    try {
      const data = await readFile(artifactPath(run, run.evidence.screenshot));
      images.set(`${run.siteId}/${run.journeyId}/${run.id}`, `data:image/png;base64,${data.toString('base64')}`);
    } catch {
      // Screenshot pruned or never captured.
    }
  }
  const problems = views.filter((v) => v.latest && v.latest.status !== 'passed').length;
  const brand = settings.report.brandName;
  const brandHtml = brand
    ? settings.report.brandUrl
      ? `<a href="${h(settings.report.brandUrl)}">${h(brand)}</a>`
      : h(brand)
    : `${LOGO_SVG}<span>JourneyGuard</span>`;

  const body = `<div class="wrap">
<header class="top"><div class="brand">${brandHtml}</div><span class="spacer"></span><div class="summary">${summaryPills(views, lang)}</div></header>
<h1 class="headline">${h(t(lang, 'report'))}: ${problems ? `${problems} ${h(t(lang, problems === 1 ? 'problemFound' : 'problemsFound'))}` : h(t(lang, 'noProblems'))}</h1>
<div class="report-meta"><span>${h(t(lang, 'generated'))}: ${h(new Date().toLocaleString(lang === 'el' ? 'el-GR' : lang === 'es' ? 'es-ES' : 'en-GB'))}</span></div>
${renderSites(views, { lang, artifactSrc: (run, file) => (file === run.evidence?.screenshot ? images.get(`${run.siteId}/${run.journeyId}/${run.id}`) : undefined) })}
${settings.report.poweredBy ? `<footer class="foot">${h(t(lang, 'poweredBy'))} · <a href="https://github.com/nxdpro/journeyguard">github.com/nxdpro/journeyguard</a></footer>` : ''}
</div>`;
  return page({ title: `${brand ?? 'JourneyGuard'} · ${t(lang, 'report')}`, lang, body });
}
