import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ConfigError, DEFAULT_SETTINGS, loadConfig, normalizeConfig } from './config.js';
import { resolveSites } from './resolve.js';
import { Engine } from './engine.js';
import { Scheduler } from './scheduler.js';
import { createServer, listen } from './server.js';
import { renderReport, viewsFromRuns } from './report.js';
import { detect } from './detect.js';
import { runSetup } from './setup.js';
import { buildMessage, dispatch } from './alerts/index.js';
import { startDemoShop, BREAK_MODES, type BreakMode } from './demo/shop.js';
import { Store } from './store.js';
import { infoList } from './render.js';
import { localizeError } from './i18n.js';
import type { Config, Language, RunResult } from './types.js';
import { formatDuration, slugify } from './util.js';
import { VERSION } from './version.js';

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: number) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = c(1);
const dim = c(2);
const red = c(31);
const green = c(32);
const yellow = c(33);
const cyan = c(36);

const HELP = `${bold('JourneyGuard')} v${VERSION} — monitors the journeys that make you money.

${bold('Usage')}
  journeyguard init [url]          Guided setup: detects the platform, sets up alerts, writes journeyguard.yml and .env
  journeyguard run                 Run every journey once (exit code 1 on failure)
  journeyguard start               Run on a schedule and serve the dashboard
  journeyguard serve               Serve the dashboard only
  journeyguard check <url>         Check any site once, no setup: detects the platform and runs the fitting journeys
  journeyguard detect <url>        Show what JourneyGuard detects on a site
  journeyguard validate            Check the configuration file
  journeyguard test-alerts         Send a test message to every alert channel
  journeyguard demo                Try it on a built-in demo shop (no setup)

${bold('Options')}
  -c, --config <file>   Config file (default: journeyguard.yml or $JOURNEYGUARD_CONFIG)
  --site <name>         Only this site
  --report <file>       Also write a self-contained HTML report
  --json                Print results as JSON
  --no-save             Do not store results (CI smoke tests)
  --no-alerts           Do not send alerts
  --headed              Show the browser window
  --port <n>            Dashboard port (start/serve/demo)
  --host <addr>         Dashboard host (start/serve/demo)
  --lang <en|el|es>     check: language of the results (default: el for .gr/.cy sites, otherwise en)
  --send-test-message   check: really send the contact form (by default it is only filled in)
  --allow-no-password   Allow serving the dashboard on a public address without a password
  --break <mode>        Demo failure: ${BREAK_MODES.filter((m) => m !== 'none').join(', ')}
  -y, --yes             init: no questions, use defaults
  -h, --help            Show help
  -v, --version         Show version
`;

function printRun(run: RunResult, dataDir?: string, lang: Language = 'en'): void {
  const tag = run.status === 'failed' ? red(bold('FAILED')) : run.status === 'warning' ? yellow(bold('WARNING')) : green(bold('PASSED'));
  console.log(`\n${bold(run.siteName)} › ${run.journeyName}  ${tag}  ${dim(formatDuration(run.durationMs))}${run.attempts > 1 ? dim(` (${run.attempts} attempts)`) : ''}`);
  for (const s of run.stages) {
    if (s.status === 'passed') console.log(`  ${green('✔')} ${s.name}`);
    else if (s.status === 'failed') console.log(`  ${red('✖')} ${s.name} ${dim('—')} ${red(localizeError(s.error ?? '', lang))}`);
    else if (s.status === 'warning') console.log(`  ${yellow('!')} ${s.name} ${dim('—')} ${yellow(localizeError(s.reason ?? '', lang))}`);
    else console.log(`  ${dim('○')} ${dim(`${s.name} — ${lang === 'el' ? 'δεν ελέγχθηκε' : lang === 'es' ? 'no comprobado' : 'not tested'}${s.reason ? ` (${localizeError(s.reason, lang)})` : ''}`)}`);
  }
  for (const hint of run.hints) {
    const color = hint.severity === 'critical' ? red : hint.severity === 'warning' ? yellow : cyan;
    console.log(`  ${color('→')} ${bold(hint.title)}\n    ${dim(hint.detail)}`);
  }
  const info = infoList(run.info, lang);
  if (info.length) console.log(`  ${dim(info.map(([k, v]) => `${k}: ${v}`).join(' · '))}`);
  if (run.evidence?.screenshot && dataDir) {
    const shot = path.join(dataDir, 'runs', run.siteId, run.journeyId, run.id, run.evidence.screenshot);
    const rel = path.relative(process.cwd(), shot);
    console.log(`  ${dim('Screenshot:')} ${rel.startsWith('..') ? shot : rel}`);
  }
}

function configPath(arg?: string): string {
  return arg ?? process.env.JOURNEYGUARD_CONFIG ?? 'journeyguard.yml';
}

async function load(file: string, overrides: { headed?: boolean; port?: string; host?: string; skipAlerts?: boolean }): Promise<Config> {
  const config = await loadConfig(file, process.env, { skipAlerts: overrides.skipAlerts });
  if (overrides.headed) config.settings.browser.headless = false;
  if (overrides.port) config.settings.dashboard.port = Number(overrides.port);
  if (overrides.host) config.settings.dashboard.host = overrides.host;
  return config;
}

async function writeReport(file: string, runs: RunResult[], config: Config): Promise<void> {
  const store = new Store(config.settings.dataDir);
  const html = await renderReport(viewsFromRuns(runs), config.settings, (run, f) => store.artifactPath(run.siteId, run.journeyId, run.id, f) ?? '');
  await writeFile(file, html);
  console.log(`\n${dim('Report written to')} ${file}`);
}

async function cmdRun(values: Record<string, string | boolean | undefined>): Promise<number> {
  const config = await load(configPath(values.config as string), { headed: values.headed as boolean, skipAlerts: !!values['no-alerts'] });
  const sites = resolveSites(config, values.site as string | undefined);
  if (!sites.length) {
    console.error(red(`No site named "${String(values.site)}"`));
    return 2;
  }
  const save = !values['no-save'];
  const json = !!values.json;
  const engine = new Engine(config, sites, {
    onResult: (run) => {
      if (!json) printRun(run, save || values.report ? config.settings.dataDir : undefined, config.settings.language);
    },
    onAlert: (title, results) => {
      if (json) return;
      for (const r of results) console.log(`  ${r.ok ? green('✉') : red('✉')} ${dim(`${r.channel}: ${r.ok ? `sent "${title}"` : r.error}`)}`);
    },
    onError: (m) => console.error(red(m)),
  }, { save: save || !!values.report, alert: !values['no-alerts'] });

  if (!json) console.log(dim(`JourneyGuard v${VERSION} · ${sites.reduce((n, s) => n + s.journeys.length, 0)} journey(s)`));
  const runs = await engine.runAll();
  if (values.report) await writeReport(values.report as string, runs, config);
  if (json) console.log(JSON.stringify(runs, null, 2));
  return summarize(runs, json);
}

/** Prints the closing line and returns the exit code: 1 = a journey is broken, 2 = nothing could be checked. */
function summarize(runs: RunResult[], json: boolean): number {
  const failed = runs.filter((r) => r.status === 'failed').length;
  const unchecked = runs.filter((r) => r.monitorError);
  if (!json) {
    if (unchecked.length) {
      console.log(`\n${red(bold(`${unchecked.length} journey(s) could not be checked`))}: ${unchecked[0]!.monitorError}`);
      if (/executable doesn't exist/i.test(unchecked[0]!.monitorError ?? '')) {
        console.log(yellow('Chromium is not installed. Run: npx playwright install --with-deps chromium (on Linux it asks for sudo to add system libraries), or use the Docker image.'));
      }
    }
    const checked = runs.length - unchecked.length;
    console.log(`\n${failed ? red(bold(`${failed} journey(s) failing`)) : checked ? green(bold('All checked journeys working')) : red(bold('Nothing was checked'))} ${dim(`(${checked} checked)`)}`);
  }
  // 1 = a journey is broken, 2 = JourneyGuard could not check (never report "all good" then).
  return failed ? 1 : unchecked.length ? 2 : 0;
}

async function cmdStart(values: Record<string, string | boolean | undefined>, withScheduler: boolean): Promise<number> {
  const config = await load(configPath(values.config as string), { headed: values.headed as boolean, port: values.port as string, host: values.host as string });
  const sites = resolveSites(config);
  const { host, port, password } = config.settings.dashboard;
  const publicHost = !['127.0.0.1', 'localhost', '::1'].includes(host);
  if (publicHost && !values['allow-no-password']) {
    // The dashboard shows screenshots of client sites and can trigger checks: never expose it open.
    if (!password) {
      console.error(red(`Refusing to serve the dashboard on ${host} without a password. Set JOURNEYGUARD_PASSWORD (or settings.dashboard.password), or bind to 127.0.0.1.`));
      return 2;
    }
    if (password.length < 10 || /^(change-?me|password|admin|journeyguard)$/i.test(password)) {
      console.error(red('The dashboard password is too weak for a public address: use at least 10 characters (e.g. openssl rand -hex 12).'));
      return 2;
    }
  }
  if (!config.settings.safeMode) console.warn(yellow(bold('Safe mode is OFF: journeys may place real orders and payments.')));
  let engine: Engine | undefined;
  let scheduler: Scheduler | undefined;
  if (withScheduler) {
    engine = new Engine(config, sites, {
      onResult: (run) => console.log(`${new Date().toISOString()} ${run.status.toUpperCase().padEnd(7)} ${run.siteName} › ${run.journeyName}${run.failedStage ? ` (at ${run.failedStage})` : ''}`),
      onAlert: (title, results) => results.forEach((r) => console.log(`${new Date().toISOString()} ALERT   ${r.channel}: ${r.ok ? title : `failed: ${r.error}`}`)),
      onError: (m) => console.error(`${new Date().toISOString()} ERROR   ${m}`),
    });
    scheduler = new Scheduler(engine, 15_000, (m) => console.error(`${new Date().toISOString()} ERROR   ${m}`));
  }
  const server = createServer({ config, sites, engine, scheduler });
  const actual = await listen(server, host, port);
  console.log(`${bold('JourneyGuard')} v${VERSION} dashboard on ${cyan(`http://${host === '0.0.0.0' ? 'localhost' : host}:${actual}`)}`);
  if (scheduler) {
    console.log(dim(`Watching ${sites.reduce((n, s) => n + s.journeys.length, 0)} journey(s) across ${sites.length} site(s)…`));
    await scheduler.start();
  }
  const stop = () => {
    scheduler?.stop();
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return new Promise<number>(() => undefined);
}

/** One-off check of any site with the journeys detection suggests: no config, no alerts, no messages sent. */
async function cmdCheck(url: string | undefined, values: Record<string, string | boolean | undefined>): Promise<number> {
  if (!url) {
    console.error('Usage: journeyguard check <url> [--lang el] [--report report.html] [--json]');
    return 2;
  }
  const json = !!values.json;
  const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  const d = await detect(target);
  const home = new URL(d.url);
  const lang = values.lang === 'el' || values.lang === 'en' || values.lang === 'es' ? values.lang : /\.(gr|cy)$/i.test(home.hostname) ? 'el' : 'en';
  const send = !!values['send-test-message'];
  const journeys = d.journeys.map((j) => (j.preset === 'contact-form' ? { ...j, options: { ...(j.options ?? {}), submit: send } } : j));
  const dataDir = process.env.JOURNEYGUARD_DATA_DIR ?? (await mkdtemp(path.join(os.tmpdir(), 'journeyguard-check-')));
  const config = normalizeConfig({
    settings: { dataDir, language: lang, browser: { headless: !values.headed } },
    sites: [{ name: home.hostname.replace(/^www\./, ''), url: home.origin, journeys }],
  });
  const sites = resolveSites(config);
  if (!json) {
    const found = [d.platform !== 'unknown' ? d.platform : undefined, d.contactPath ? `contact form at ${d.contactPath}` : undefined, d.cdn].filter(Boolean);
    console.log(`${bold('JourneyGuard')} v${VERSION} · checking ${cyan(home.origin)}${found.length ? dim(` (${found.join(' · ')})`) : ''}`);
    if (d.contactPath && !send) console.log(dim('The contact form is filled in but not sent; add --send-test-message to send one real test message.'));
  }
  const engine = new Engine(config, sites, { onResult: (run) => (json ? undefined : printRun(run, dataDir, lang)), onError: (m) => console.error(red(m)) }, { save: true, alert: false });
  const runs = await engine.runAll();
  if (values.report) await writeReport(values.report as string, runs, config);
  if (json) console.log(JSON.stringify({ detection: d, runs }, null, 2));
  return summarize(runs, json);
}

async function cmdDetect(url: string | undefined): Promise<number> {
  if (!url) {
    console.error('Usage: journeyguard detect <url>');
    return 2;
  }
  const d = await detect(url);
  console.log(`${bold(d.url)}  ${dim(`HTTP ${d.status}`)}`);
  console.log(`  Platform:  ${bold(d.platform)}${d.signals.length ? dim(` (${d.signals.join(', ')})`) : ''}`);
  if (d.contactPath) console.log(`  Contact:   ${d.contactPath}`);
  if (d.captcha) console.log(`  CAPTCHA:   ${d.captcha}`);
  if (d.cdn) console.log(`  CDN/WAF:   ${d.cdn}`);
  console.log(`  Suggested: ${d.journeys.map((j) => j.preset).join(', ')}`);
  return 0;
}

async function cmdInit(url: string | undefined, values: Record<string, string | boolean | undefined>): Promise<number> {
  const file = configPath(values.config as string);
  if (existsSync(file) && !values.force) {
    console.error(red(`${file} already exists (use --force to overwrite)`));
    return 2;
  }
  const interactive = !values.yes && !!process.stdin.isTTY && !!process.stdout.isTTY;
  try {
    await runSetup({
      configFile: file,
      url,
      interactive,
      // Without a terminal (CI, docker without -it) use defaults and just report what was written.
      prompter: interactive ? undefined : { ask: async (_q, fallback) => fallback ?? '', say: (m) => console.log(m), close: () => undefined },
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'ABORT_ERR') {
      console.log(`\n${yellow('Setup cancelled. Nothing was written.')}`);
      return 130;
    }
    throw e;
  }
  return 0;
}

async function cmdValidate(values: Record<string, string | boolean | undefined>): Promise<number> {
  const config = await loadConfig(configPath(values.config as string));
  const sites = resolveSites(config);
  console.log(`${green('✔')} ${config.path} is valid`);
  for (const s of sites) {
    console.log(`  ${bold(s.name)} ${dim(s.url)}`);
    for (const j of s.journeys) console.log(`    • ${j.name} ${dim(`every ${formatDuration(j.intervalMs)} · ${j.stages.length} stages`)}`);
  }
  if (!config.alerts.length) console.log(yellow('  No alerts configured: failures will only show on the dashboard.'));
  return 0;
}

async function cmdTestAlerts(values: Record<string, string | boolean | undefined>): Promise<number> {
  const config = await loadConfig(configPath(values.config as string));
  if (!config.alerts.length) {
    console.error(yellow('No alerts configured.'));
    return 2;
  }
  const site = config.sites[0]!;
  const fake: RunResult = {
    id: 'test',
    siteId: slugify(site.name),
    siteName: site.name,
    siteUrl: site.url,
    journeyId: 'test',
    journeyName: 'Alert test',
    status: 'passed',
    startedAt: new Date().toISOString(),
    durationMs: 0,
    attempts: 1,
    stages: [{ name: 'Alert channel', status: 'passed', durationMs: 0, steps: [] }],
    hints: [],
    info: {},
  };
  const results = await dispatch(config.alerts, buildMessage(fake, 'test', config.settings.language));
  for (const r of results) console.log(`${r.ok ? green('✔') : red('✖')} ${r.channel}${r.error ? `: ${r.error}` : ''}`);
  return results.every((r) => r.ok) ? 0 : 1;
}

async function cmdDemo(values: Record<string, string | boolean | undefined>): Promise<number> {
  const mode = (values.break as BreakMode | undefined) ?? 'checkout';
  if (!BREAK_MODES.includes(mode)) {
    console.error(`Unknown --break mode. Use one of: ${BREAK_MODES.join(', ')}`);
    return 2;
  }
  const shop = await startDemoShop(0, 'none');
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'journeyguard-demo-'));
  const config = normalizeConfig({
    settings: { dataDir, interval: '1h', timeout: '10s', retries: 0, browser: { headless: !values.headed }, dashboard: { ...DEFAULT_SETTINGS.dashboard, port: Number(values.port ?? 8080) } },
    sites: [
      {
        name: 'Aegean Coffee Co. (demo)',
        url: shop.url,
        journeys: [{ preset: 'woocommerce' }, { preset: 'contact-form', options: { path: '/contact/' } }, { preset: 'website', options: { ssl: false } }],
      },
    ],
  });
  const sites = resolveSites(config);
  const engine = new Engine(config, sites, { onResult: (run) => printRun(run, dataDir) }, { save: true, alert: false });

  console.log(`${bold('JourneyGuard demo')} · demo shop running at ${cyan(shop.url)}\n`);
  console.log(bold('1) The shop is healthy:'));
  await engine.runAll();
  console.log(`\n${bold(`2) Now we break it (--break ${mode}) — this is what an owner normally never notices:`)}`);
  shop.setMode(mode);
  await engine.runAll();

  const server = createServer({ config, sites, engine });
  // The demo only shows fake data, so it may listen on all interfaces (needed inside Docker).
  const demoHost = (values.host as string | undefined) ?? '127.0.0.1';
  const port = await listen(server, demoHost, config.settings.dashboard.port).catch(() => listen(server, demoHost, 0));
  console.log(`\n${bold('Dashboard:')} ${cyan(`http://localhost:${port}`)}   ${dim('(Ctrl+C to stop)')}`);
  console.log(dim(`Toggle failures live: ${shop.url}/__demo/break?mode=none|${BREAK_MODES.filter((m) => m !== 'none').join('|')}`));
  const stop = async () => {
    server.close();
    await shop.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return new Promise<number>(() => undefined);
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: 'string', short: 'c' },
      site: { type: 'string' },
      report: { type: 'string' },
      json: { type: 'boolean' },
      'no-save': { type: 'boolean' },
      'no-alerts': { type: 'boolean' },
      headed: { type: 'boolean' },
      port: { type: 'string' },
      host: { type: 'string' },
      break: { type: 'string' },
      force: { type: 'boolean' },
      'allow-no-password': { type: 'boolean' },
      lang: { type: 'string' },
      'send-test-message': { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
  if (values.version) {
    console.log(VERSION);
    return 0;
  }
  const [command, arg] = positionals;
  if (values.help || !command) {
    console.log(HELP);
    return command || values.help ? 0 : 1;
  }
  try {
    switch (command) {
      case 'run':
        return await cmdRun(values);
      case 'start':
      case 'watch':
        return await cmdStart(values, true);
      case 'serve':
        return await cmdStart(values, false);
      case 'check':
        return await cmdCheck(arg, values);
      case 'detect':
        return await cmdDetect(arg);
      case 'init':
        return await cmdInit(arg, values);
      case 'validate':
        return await cmdValidate(values);
      case 'test-alerts':
        return await cmdTestAlerts(values);
      case 'demo':
        return await cmdDemo(values);
      default:
        console.error(`Unknown command "${command}"\n`);
        console.log(HELP);
        return 2;
    }
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(red(e.message));
      return 2;
    }
    const message = (e as Error).message ?? String(e);
    if (/executable doesn't exist/i.test(message)) {
      console.error(red('Chromium is not installed. Run: npx playwright install --with-deps chromium (on Linux it asks for sudo to add system libraries), or use the Docker image.'));
      return 2;
    }
    if (/missing dependencies|install-deps|error while loading shared libraries/i.test(message)) {
      console.error(red('Chromium is installed but system libraries are missing. Run: npx playwright install-deps chromium (it asks for sudo)'));
      console.error(dim(message.split('\n').slice(0, 6).join('\n')));
      return 2;
    }
    throw e;
  }
}
