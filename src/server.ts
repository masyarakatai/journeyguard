import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Config, ResolvedSite } from './types.js';
import type { Engine } from './engine.js';
import type { Scheduler } from './scheduler.js';
import { Store } from './store.js';
import { buildViews, renderReport } from './report.js';
import { LOGO_SVG, page, renderSites, summaryPills, type JourneyView } from './render.js';
import { t } from './i18n.js';
import { VERSION } from './version.js';
import { escapeHtml } from './util.js';

export interface ServerDeps {
  config: Config;
  sites: ResolvedSite[];
  engine?: Engine;
  scheduler?: Scheduler;
}

const CLIENT_SCRIPT = `
(function () {
  var app = document.getElementById('app');
  function openIds() {
    return Array.prototype.map.call(app.querySelectorAll('details[open]'), function (d) {
      return d.closest('.journey').id + '|' + d.querySelector('summary').textContent;
    });
  }
  function refresh() {
    var keep = openIds();
    fetch('?partial=1', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.text() : null; }).then(function (html) {
      if (!html) return;
      app.innerHTML = html;
      app.querySelectorAll('details').forEach(function (d) {
        var key = d.closest('.journey').id + '|' + d.querySelector('summary').textContent;
        if (keep.indexOf(key) >= 0) d.open = true;
      });
    }).catch(function () {});
  }
  app.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-run]');
    if (!btn) return;
    var label = btn.textContent; btn.disabled = true; btn.textContent = btn.getAttribute('data-running');
    fetch('api/run/' + btn.getAttribute('data-run'), { method: 'POST', credentials: 'same-origin', headers: { 'X-JourneyGuard-Action': 'run' } })
      .then(function (r) {
        if (r.status === 409) { btn.textContent = btn.getAttribute('data-queued') || '…'; setTimeout(refresh, 5000); return; }
        refresh();
      })
      .catch(function () { btn.disabled = false; btn.textContent = label; });
  });
  setInterval(refresh, 20000);
})();`;

// Only this exact script may run on the dashboard.
const SCRIPT_HASH = createHash('sha256').update(CLIENT_SCRIPT).digest('base64');

function send(res: http.ServerResponse, status: number, body: string, type = 'text/html; charset=utf-8'): void {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'content-security-policy': `default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'sha256-${SCRIPT_HASH}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  });
  res.end(body);
}

const json = (res: http.ServerResponse, status: number, body: unknown) => send(res, status, JSON.stringify(body), 'application/json');

function authorized(req: http.IncomingMessage, password?: string): boolean {
  if (!password) return true;
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const given = Buffer.from(decoded.slice(decoded.indexOf(':') + 1));
  const expected = Buffer.from(password);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function createServer(deps: ServerDeps): http.Server {
  const { config, sites, engine, scheduler } = deps;
  const settings = config.settings;
  const store = engine?.store ?? new Store(settings.dataDir);
  const lang = settings.language;
  const views = () => buildViews(sites, store, scheduler ? (s, j) => scheduler.nextRunAt(s, j) : undefined);
  const findJourney = (siteId?: string, journeyId?: string) => {
    const site = sites.find((s) => s.id === siteId);
    const journey = site?.journeys.find((j) => j.id === journeyId);
    return site && journey ? { site, journey } : undefined;
  };
  const brand = escapeHtml(settings.report.brandName ?? 'JourneyGuard');
  const renderApp = (v: JourneyView[]) =>
    v.length
      ? renderSites(v, { lang, runButton: !!engine, artifactSrc: (run, file) => `artifacts/${run.siteId}/${run.journeyId}/${run.id}/${file}` })
      : `<div class="empty">${t(lang, 'noRuns')}</div>`;

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

      // Public probe for uptime monitors: no details, but 503 when JourneyGuard cannot actually check.
      if (url.pathname === '/healthz') {
        const ok = engine ? engine.healthy() : true;
        return json(res, ok ? 200 : 503, { ok });
      }

      if (!authorized(req, settings.dashboard.password)) {
        res.writeHead(401, { 'www-authenticate': 'Basic realm="JourneyGuard", charset="UTF-8"' });
        return res.end('Authentication required');
      }

      if (req.method === 'GET' && url.pathname === '/') {
        const v = await views();
        if (url.searchParams.has('partial')) return send(res, 200, renderApp(v));
        const footer = settings.report.poweredBy
          ? `<footer class="foot">JourneyGuard v${VERSION} · <a href="https://github.com/nxdpro/journeyguard">GitHub</a> · <a href="report">${t(lang, 'downloadReport')}</a> · by <a href="https://www.nxdpro.com">NXDPRO</a></footer>`
          : `<footer class="foot"><a href="report">${t(lang, 'downloadReport')}</a></footer>`;
        const body = `<div class="wrap"><header class="top"><div class="brand">${LOGO_SVG}<span>${brand}</span></div><span class="spacer"></span><div class="summary">${summaryPills(v, lang)}</div></header>${settings.safeMode ? '' : '<p class="pill s-failed">Safe mode is OFF: journeys may place real orders</p>'}<main id="app">${renderApp(v)}</main>${footer}</div>`;
        return send(res, 200, page({ title: 'JourneyGuard', lang, body, script: CLIENT_SCRIPT }));
      }

      if (req.method === 'GET' && url.pathname === '/report') {
        const html = await renderReport(await views(), settings, (run, file) => store.artifactPath(run.siteId, run.journeyId, run.id, file) ?? '');
        res.setHeader('content-disposition', `attachment; filename="journeyguard-report-${new Date().toISOString().slice(0, 10)}.html"`);
        return send(res, 200, html);
      }

      if (req.method === 'GET' && url.pathname === '/api/status') {
        return json(res, 200, { version: VERSION, generatedAt: new Date().toISOString(), journeys: await views() });
      }

      if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'runs' && parts.length === 4) {
        const target = findJourney(parts[2], parts[3]);
        if (!target) return json(res, 404, { error: 'not found' });
        return json(res, 200, await store.listRuns(target.site.id, target.journey.id, 100));
      }

      if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'run' && parts.length === 4) {
        // A custom header cannot be sent cross-site without a CORS preflight, which is never granted:
        // other websites cannot make a logged-in browser trigger checks (or contact-form submissions).
        const fetchSite = req.headers['sec-fetch-site'];
        if (req.headers['x-journeyguard-action'] !== 'run' || (fetchSite && fetchSite !== 'same-origin')) {
          return json(res, 403, { error: 'forbidden' });
        }
        const target = findJourney(parts[2], parts[3]);
        if (!engine || !target) return json(res, 404, { error: 'not found' });
        if (engine.isPending(target.site.id, target.journey.id)) return json(res, 409, { error: 'already running' });
        const [run] = await engine.run([target]);
        return json(res, 200, { status: run?.status ?? 'error', id: run?.id });
      }

      if (req.method === 'GET' && parts[0] === 'artifacts' && parts.length === 5 && parts[4]!.endsWith('.png')) {
        const file = store.artifactPath(parts[1]!, parts[2]!, parts[3]!, parts[4]!);
        if (!file) return send(res, 400, 'bad path', 'text/plain');
        try {
          const info = await stat(file);
          res.writeHead(200, { 'content-type': 'image/png', 'content-length': info.size, 'cache-control': 'private, max-age=86400' });
          createReadStream(file).pipe(res);
          return;
        } catch {
          return send(res, 404, 'not found', 'text/plain');
        }
      }

      send(res, 404, 'Not found', 'text/plain');
    } catch (e) {
      send(res, 500, `Error: ${(e as Error).message}`, 'text/plain');
    }
  });
}

export function listen(server: http.Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : port);
    });
  });
}
