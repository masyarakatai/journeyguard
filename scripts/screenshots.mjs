// Regenerates the README images from the demo shop: `npm run build && node scripts/screenshots.mjs`
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { normalizeConfig } from '../dist/src/config.js';
import { resolveSites } from '../dist/src/resolve.js';
import { Engine } from '../dist/src/engine.js';
import { createServer, listen } from '../dist/src/server.js';
import { renderReport, buildViews } from '../dist/src/report.js';
import { startDemoShop } from '../dist/src/demo/shop.js';
import { buildMessage } from '../dist/src/alerts/message.js';

const out = path.resolve('docs/assets');
await mkdir(out, { recursive: true });
const lang = process.env.JG_LANG === 'el' ? 'el' : 'en';

// Optional: map a friendly hostname to 127.0.0.1 in /etc/hosts and set JG_DEMO_URL=http://aegean-coffee.example
const demoUrl = process.env.JG_DEMO_URL;
const shop = await startDemoShop(demoUrl ? Number(new URL(demoUrl).port || 80) : 0, 'none');
const siteUrl = demoUrl ?? shop.url;
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'jg-shots-'));
const config = normalizeConfig({
  settings: { dataDir, timeout: '8s', retries: 0, language: lang },
  sites: [
    {
      name: 'Aegean Coffee Co.',
      url: siteUrl,
      journeys: [
        { preset: 'woocommerce' },
        { preset: 'contact-form', options: { path: '/contact/' } },
        { preset: 'website', options: { ssl: false, pages: ['/shop/'] } },
      ],
    },
  ],
});
const sites = resolveSites(config);
const engine = new Engine(config, sites, {}, { save: true, alert: false });
const [site] = sites;
const [woo, contact, web] = site.journeys;

// Build some history so the dashboard looks lived-in.
for (let i = 0; i < 6; i++) await engine.run([{ site, journey: woo }, { site, journey: contact }, { site, journey: web }]);
shop.setMode('checkout');
const [failedRun] = await engine.run([{ site, journey: woo }]);
shop.setMode('contact');
await engine.run([{ site, journey: contact }]);
shop.setMode('none');

const server = createServer({ config, sites });
const port = await listen(server, '127.0.0.1', 0);
const browser = await chromium.launch({ executablePath: process.env.JOURNEYGUARD_CHROMIUM_PATH || undefined });
const suffix = lang === 'el' ? '-el' : '';

// The README hero: the top of the dashboard, with the failing checkout and its diagnosis.
const desktop = await browser.newPage({ viewport: { width: 1280, height: 700 }, deviceScaleFactor: 2 });
await desktop.goto(`http://127.0.0.1:${port}/`);
await desktop.screenshot({ path: path.join(out, `dashboard${suffix}.png`), fullPage: false });

const dark = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, colorScheme: 'dark' });
await dark.goto(`http://127.0.0.1:${port}/`);
await dark.screenshot({ path: path.join(out, `dashboard-dark${suffix}.png`), fullPage: false });

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await mobile.goto(`http://127.0.0.1:${port}/`);
await mobile.screenshot({ path: path.join(out, `dashboard-mobile${suffix}.png`), fullPage: false });

const html = await renderReport(await buildViews(sites, engine.store), config.settings, (run, f) => engine.store.artifactPath(run.siteId, run.journeyId, run.id, f));
const reportFile = path.join(dataDir, 'report.html');
await writeFile(reportFile, html);
const report = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2 });
await report.goto(`file://${reportFile}`);
await report.screenshot({ path: path.join(out, `report${suffix}.png`), fullPage: false });

// The e-mail alert an owner receives, on a phone.
const shot = engine.store.artifactPath(failedRun.siteId, failedRun.journeyId, failedRun.id, 'failure.png');
const message = buildMessage(failedRun, 'failure', lang, { screenshotPath: shot, publicUrl: 'https://monitor.example.com' });
const alertFile = path.join(dataDir, 'alert.html');
await writeFile(alertFile, message.emailHtml.replace('cid:failure-screenshot', `file://${shot}`).replace('<body style="', '<body style="margin:16px;'));
const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await phone.goto(`file://${alertFile}`);
await phone.screenshot({ path: path.join(out, `alert${suffix}.png`), fullPage: false });

await browser.close();
server.close();
await shop.close();
console.log(`Screenshots written to ${out}`);
