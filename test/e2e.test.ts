import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeConfig } from '../src/config.js';
import { resolveSites } from '../src/resolve.js';
import { Engine } from '../src/engine.js';
import { createServer, listen } from '../src/server.js';
import { buildViews, renderReport } from '../src/report.js';
import { startDemoShop, type BreakMode, type DemoShop } from '../src/demo/shop.js';
import { main } from '../src/cli.js';
import type { Config, JourneyConfig, RunResult } from '../src/types.js';

let shop: DemoShop;
let dataDir: string;

before(async () => {
  shop = await startDemoShop();
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'jg-test-'));
});

after(async () => {
  await shop.close();
  await rm(dataDir, { recursive: true, force: true });
});

function makeConfig(journeys: JourneyConfig[], extra: Record<string, unknown> = {}): Config {
  return normalizeConfig({
    settings: { dataDir, timeout: '4s', retries: 0, ...extra },
    sites: [{ name: 'Demo', url: shop.url, journeys }],
  });
}

async function runWith(mode: BreakMode, journeys: JourneyConfig[], extra: Record<string, unknown> = {}): Promise<RunResult[]> {
  shop.setMode(mode);
  const config = makeConfig(journeys, extra);
  const engine = new Engine(config, resolveSites(config), {}, { save: true, alert: false });
  return engine.runAll();
}

const stageStatus = (run: RunResult) => Object.fromEntries(run.stages.map((s) => [s.name, s.status]));
const stageReason = (run: RunResult, name: string) => run.stages.find((s) => s.name === name)?.reason ?? '';

describe('WooCommerce preset against the demo shop', () => {
  test('healthy shop passes and never places the order', async () => {
    const [run] = await runWith('none', [{ preset: 'woocommerce' }]);
    assert.equal(run!.status, 'passed', JSON.stringify(run!.stages, null, 2));
    assert.deepEqual(stageStatus(run!), {
      Website: 'passed',
      Products: 'passed',
      'Add to cart': 'passed',
      Checkout: 'passed',
      Payment: 'passed',
      'Place order': 'not_tested',
    });
    assert.equal(run!.info.cartItems, 1);
    assert.match(String(run!.info.paymentMethods), /Cash on delivery/);
  });

  test('checkout crash is caught with a screenshot and a WordPress hint', async () => {
    const [run] = await runWith('checkout', [{ preset: 'woocommerce' }]);
    assert.equal(run!.status, 'failed');
    assert.equal(run!.failedStage, 'Checkout');
    assert.equal(stageStatus(run!).Payment, 'not_tested');
    assert.equal(run!.hints[0]!.id, 'wp-critical');
    assert.equal(run!.evidence?.screenshot, 'failure.png');
    const png = await readFile(path.join(dataDir, 'runs', run!.siteId, run!.journeyId, run!.id, 'failure.png'));
    assert.ok(png.length > 1000);
  });

  test('broken add-to-cart button is detected', async () => {
    const [run] = await runWith('add-to-cart', [{ preset: 'woocommerce' }]);
    assert.equal(run!.failedStage, 'Add to cart');
    const ids = run!.hints.map((h) => h.id);
    assert.ok(ids.includes('add-to-cart'), ids.join());
    assert.ok(ids.includes('js-error'), ids.join());
  });

  test('a card gateway that disappears is caught even while cash on delivery remains', async () => {
    const [ok] = await runWith('none', [{ preset: 'woocommerce', options: { expectPayments: ['Stripe', 'cash on delivery'] } }]);
    assert.equal(ok!.status, 'passed', JSON.stringify(ok!.stages, null, 2));
    assert.match(String(ok!.info.gateways), /Stripe/);
    const [missing] = await runWith('none', [{ preset: 'woocommerce', options: { expectPayments: ['Viva'] } }]);
    assert.equal(missing!.failedStage, 'Payment');
    assert.equal(missing!.hints[0]!.id, 'payment-missing');
  });

  test('missing payment methods are detected', async () => {
    const [run] = await runWith('payment', [{ preset: 'woocommerce' }]);
    assert.equal(run!.failedStage, 'Payment');
    assert.equal(run!.hints[0]!.id, 'no-payment-methods');
  });

  test('a cookie banner covering the shop is closed with "necessary only"', async () => {
    const [shopRun, formRun] = await runWith('cookie-banner', [
      { preset: 'woocommerce' },
      { preset: 'contact-form', options: { path: '/contact/' } },
    ]);
    assert.equal(shopRun!.status, 'passed', JSON.stringify(shopRun!.stages, null, 2));
    assert.equal(formRun!.status, 'passed', JSON.stringify(formRun!.stages, null, 2));
  });

  test('a free order skips the payment check instead of raising a false alarm', async () => {
    const [run] = await runWith('free-order', [{ preset: 'woocommerce' }]);
    assert.equal(run!.status, 'warning', JSON.stringify(run!.stages, null, 2));
    assert.equal(run!.info.freeOrder, true);
    assert.match(stageReason(run!, 'Payment'), /cart total is zero/);
  });

  test('a cart lost on the way to checkout is detected', async () => {
    const [run] = await runWith('cart-session', [{ preset: 'woocommerce' }]);
    assert.equal(run!.failedStage, 'Checkout');
    assert.equal(run!.hints[0]!.id, 'cart-session');
  });
});

describe('no false alarms on healthy but unusual shops', () => {
  test('shops that redirect to the cart after adding a product pass', async () => {
    const [run] = await runWith('redirect-to-cart', [{ preset: 'woocommerce' }]);
    assert.equal(run!.status, 'passed', JSON.stringify(run!.stages, null, 2));
  });

  test('variable products with hidden swatch selects and a sold-out first size pass', async () => {
    const [run] = await runWith('none', [{ preset: 'woocommerce', options: { productUrl: '/product/aegean-tee/' } }]);
    assert.equal(run!.status, 'passed', JSON.stringify(run!.stages, null, 2));
    assert.equal(run!.info.variationSelected, true);
  });

  test('a firewall block page is "not tested", not an outage', async () => {
    const [run] = await runWith('firewall', [{ preset: 'website', options: { ssl: false } }]);
    assert.equal(run!.status, 'warning');
    assert.equal(run!.inconclusive, true);
    assert.ok(run!.hints.some((h) => h.id === 'bot-protection'));
  });

  test('anti-spam and validation rejections are "not tested", not a mail outage', async () => {
    const [spam] = await runWith('contact-spam', [{ preset: 'contact-form', options: { path: '/contact/' } }]);
    assert.equal(spam!.status, 'warning', JSON.stringify(spam!.stages));
    assert.ok(spam!.hints.some((h) => h.id === 'spam'));
    assert.ok(!spam!.hints.some((h) => h.id === 'mail'));
    const [invalid] = await runWith('contact-invalid', [{ preset: 'contact-form', options: { path: '/contact/' } }]);
    assert.equal(invalid!.status, 'warning');
    assert.match(invalid!.stages[1]!.reason!, /rejected the test input/);
    // A custom form answering in Greek that the visitor looks like a robot: blocked, not broken.
    const [robot] = await runWith('contact-robot', [{ preset: 'contact-form', options: { path: '/contact/' } }]);
    assert.equal(robot!.status, 'warning', JSON.stringify(robot!.stages));
    assert.match(robot!.stages[1]!.reason!, /ρομπότ/);
    assert.ok(robot!.hints.some((h) => h.id === 'spam'));
    assert.ok(!robot!.hints.some((h) => h.id === 'mail'));
  });
});

describe('contact form and website presets', () => {
  test('contact form passes when mail is sent (skipping newsletter boxes and invisible reCAPTCHA)', async () => {
    const [run] = await runWith('none', [{ preset: 'contact-form', options: { path: '/contact/' } }]);
    assert.equal(run!.status, 'passed', JSON.stringify(run!.stages, null, 2));
    assert.equal(run!.info.form, '/contact/submit', 'the real contact form was chosen');
    assert.equal(stageStatus(run!)['Email delivered'], 'not_tested');
  });

  test('contact form with submit: false checks the form without sending it', async () => {
    const [run] = await runWith('contact', [{ preset: 'contact-form', options: { path: '/contact/', submit: false } }]);
    assert.equal(run!.status, 'passed', 'nothing is sent, so the broken mail server is not touched');
    assert.match(run!.stages.at(-1)!.reason!, /submit: false/);
    assert.ok(!run!.stages[1]!.steps.some((st) => st.name === 'Send and see confirmation'));
  });

  test('contact form mail failure is detected', async () => {
    const [run] = await runWith('contact', [{ preset: 'contact-form', options: { path: '/contact/' } }]);
    assert.equal(run!.failedStage, 'Submit form');
    assert.match(run!.stages[1]!.error!, /could not send the message: There was an error trying to send your message/);
    assert.equal(run!.hints[0]!.id, 'mail');
  });

  test('a site that is down fails the website preset', async () => {
    const [run] = await runWith('down', [{ preset: 'website', options: { ssl: false } }]);
    assert.equal(run!.failedStage, 'Homepage');
    assert.ok(run!.hints.some((h) => h.id === 'server-error'));
  });
});

describe('custom journeys and safety', () => {
  test('custom YAML-style steps work', async () => {
    const [run] = await runWith('none', [
      {
        name: 'Browse and add',
        stages: [
          { name: 'Shop', steps: [{ goto: '/shop/' }, { expectVisible: 'ul.products li.product' }] },
          { name: 'Product', steps: [{ click: { text: 'Greek Coffee 200g' } }, { expectUrl: '/product/greek-coffee/' }, { expectText: '€5.40' }] },
          { name: 'Cart', steps: [{ click: 'button.single_add_to_cart_button' }, { expectText: { selector: '.woocommerce-message', text: 'has been added' } }] },
        ],
      },
    ]);
    assert.equal(run!.status, 'passed', JSON.stringify(run!.stages, null, 2));
  });

  test('safe mode refuses to place an order', async () => {
    const [run] = await runWith('none', [
      {
        name: 'Reckless checkout',
        steps: [
          { goto: '/product/espresso-blend/' },
          { click: 'button.single_add_to_cart_button' },
          { goto: '/checkout/' },
          { click: '#place_order' },
        ],
      },
    ]);
    assert.equal(run!.status, 'failed');
    assert.match(run!.stages.at(-1)!.error!, /Safe mode blocked/);
    assert.ok(run!.hints.some((h) => h.id === 'safe-mode'));
  });

  test('safe mode blocks pressing Enter in a checkout field', async () => {
    const before = shop.orders();
    const [run] = await runWith('none', [
      {
        name: 'Enter in checkout',
        steps: [
          { goto: '/product/espresso-blend/' },
          { click: 'button.single_add_to_cart_button' },
          { goto: '/checkout/' },
          { fill: { selector: '#billing_email', value: 'monitor@example.com' } },
          { press: { selector: '#billing_email', key: 'Enter' } },
        ],
      },
    ]);
    assert.equal(run!.status, 'failed');
    assert.match(run!.stages.at(-1)!.error!, /Safe mode blocked pressing Enter/);
    assert.equal(shop.orders(), before, 'no order may reach the shop');
  });

  test('safe mode blocks an uppercased Greek button even when a child span is clicked', async () => {
    const before = shop.orders();
    const [run] = await runWith('none', [
      { name: 'Greek confirm', steps: [{ goto: '/greek-checkout/' }, { fill: { selector: '#email', value: 'a@b.c' } }, { click: '.lbl' }] },
    ]);
    assert.equal(run!.status, 'failed');
    assert.match(run!.stages.at(-1)!.error!, /Safe mode blocked/);
    assert.equal(shop.orders(), before);
  });

  test('the in-page guard stops a page script that submits the order form', async () => {
    const before = shop.orders();
    shop.setMode('none');
    // Simulate a theme script calling form.submit() on the order form.
    const config = makeConfig([{ name: 'probe', steps: [{ goto: '/greek-checkout/' }] }]);
    const [site] = resolveSites(config);
    site!.journeys[0]!.stages.push({
      name: 'Script',
      steps: [{ custom: async (ctx) => { await ctx.page.evaluate(() => (document.querySelector('form') as HTMLFormElement).submit()); } }],
    });
    const engine = new Engine(config, [site!], {}, { save: false, alert: false });
    const [scripted] = await engine.runAll();
    assert.equal(scripted!.status, 'failed');
    assert.match(scripted!.stages.at(-1)!.error!, /Safe mode blocked/);
    assert.equal(shop.orders(), before);
  });

  test('safe mode covers div buttons and web components, but not choosing a payment method', async () => {
    const before = shop.orders();
    const [div] = await runWith('none', [{ name: 'Div', steps: [{ goto: '/spa-checkout/' }, { click: '.pay-div' }, { waitFor: 500 }] }]);
    assert.equal(div!.status, 'failed');
    assert.match(div!.stages.find((st) => st.status === 'failed')!.error!, /Safe mode blocked/);
    const [shadow] = await runWith('none', [{ name: 'Shadow', steps: [{ goto: '/spa-checkout/' }, { click: 'pay-button' }, { waitFor: 500 }] }]);
    assert.equal(shadow!.status, 'failed');
    assert.match(shadow!.stages.find((st) => st.status === 'failed')!.error!, /Safe mode blocked/);
    const [choice] = await runWith('none', [{ name: 'Choice', steps: [{ goto: '/spa-checkout/' }, { click: 'label.method' }, { expectVisible: 'input[value=klarna]:checked' }] }]);
    assert.equal(choice!.status, 'passed', JSON.stringify(choice!.stages));
    assert.equal(shop.orders(), before);
  });

  test('safe mode blocks order requests at the network level, whatever the button says', async () => {
    const before = shop.orders();
    const [run] = await runWith('none', [
      { name: 'AJAX checkout', steps: [{ goto: '/ajax-checkout/' }, { click: '#go' }, { waitFor: 1000 }, { expectText: 'Order placed' }] },
    ]);
    assert.equal(run!.status, 'failed');
    assert.match(run!.stages.find((s) => s.status === 'failed')!.error!, /Safe mode blocked an order request \(WooCommerce checkout\)/);
    assert.equal(shop.orders(), before);
  });

  test('extra headers are sent to the monitored site only, never to third parties', async () => {
    const seen: Record<string, string | undefined> = {};
    const third = http.createServer((req, res) => {
      seen.third = req.headers['x-journeyguard'] as string | undefined;
      seen.thirdSecret = req.headers['x-monitor-token'] as string | undefined;
      res.writeHead(200, { 'content-type': 'image/gif', 'access-control-allow-origin': '*' });
      res.end();
    });
    const thirdPort = await listen(third, '127.0.0.1', 0);
    const own = http.createServer((req, res) => {
      if (req.url === '/') {
        seen.own = req.headers['x-journeyguard'] as string | undefined;
        seen.ownSecret = req.headers['x-monitor-token'] as string | undefined;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<html><body><h1>Hi</h1><img src="http://localhost:${thirdPort}/pixel.gif"></body></html>`);
    });
    const ownPort = await listen(own, '127.0.0.1', 0);
    try {
      const config = normalizeConfig({
        settings: { dataDir, timeout: '4s', retries: 0 },
        sites: [{ name: 'Headers', url: `http://127.0.0.1:${ownPort}`, headers: { 'X-Monitor-Token': 12345 }, journeys: [{ name: 'Home', steps: [{ goto: '/' }, { waitFor: 500 }] }] }],
      });
      const [run] = await new Engine(config, resolveSites(config), {}, { save: false, alert: false }).runAll();
      assert.equal(run!.status, 'passed', JSON.stringify(run!.stages));
      assert.equal(seen.own, '1');
      assert.equal(seen.ownSecret, '12345', 'numeric YAML header values are sent as text');
      assert.equal(seen.third, undefined);
      assert.equal(seen.thirdSecret, undefined);
    } finally {
      own.close();
      third.close();
    }
  });

  test('a failure that passes on retry is marked as flaky', async () => {
    const [run] = await runWith('flaky-checkout', [{ preset: 'woocommerce' }], { retries: 1 });
    assert.equal(run!.attempts, 2);
    assert.equal(run!.status, 'warning');
    assert.equal(run!.info.flaky, true);
    assert.ok(run!.hints.some((h) => h.id === 'flaky'));
  });
});

describe('dashboard server, report and webhook alerts', () => {
  test('server renders status, protects artifacts and supports a password', async () => {
    shop.setMode('checkout');
    const config = makeConfig([{ preset: 'woocommerce' }]);
    config.settings.dashboard.password = 's3cret';
    const sites = resolveSites(config);
    const engine = new Engine(config, sites, {}, { save: true, alert: false });
    await engine.runAll();
    const server = createServer({ config, sites, engine });
    const port = await listen(server, '127.0.0.1', 0);
    const base = `http://127.0.0.1:${port}`;
    const auth = { authorization: `Basic ${Buffer.from('admin:s3cret').toString('base64')}` };
    try {
      assert.equal((await fetch(`${base}/healthz`)).status, 200);
      assert.equal((await fetch(`${base}/`)).status, 401);
      const html = await (await fetch(`${base}/`, { headers: auth })).text();
      assert.match(html, /Failed at: Checkout/);
      const status = (await (await fetch(`${base}/api/status`, { headers: auth })).json()) as { journeys: { latest?: RunResult }[] };
      const latest = status.journeys[0]!.latest!;
      assert.equal(latest.status, 'failed');
      const png = await fetch(`${base}/artifacts/${latest.siteId}/${latest.journeyId}/${latest.id}/failure.png`, { headers: auth });
      assert.equal(png.headers.get('content-type'), 'image/png');
      const sneaky = await fetch(`${base}/artifacts/..%2F..%2F/x/y/state.png`, { headers: auth });
      assert.notEqual(sneaky.status, 200);
      assert.equal((await fetch(`${base}/api/runs/..%2F..%2Fother/x`, { headers: auth })).status, 404);
      // Cross-site pages cannot trigger checks: the custom header is required.
      const csrf = await fetch(`${base}/api/run/${latest.siteId}/${latest.journeyId}`, { method: 'POST', headers: auth });
      assert.equal(csrf.status, 403);
      const health = (await (await fetch(`${base}/healthz`)).json()) as Record<string, unknown>;
      assert.deepEqual(health, { ok: true });
      const report = await renderReport(await buildViews(sites, engine.store), config.settings, (run, f) => engine.store.artifactPath(run.siteId, run.journeyId, run.id, f)!);
      assert.match(report, /data:image\/png;base64,/);
    } finally {
      server.close();
    }
  });

  test('a page with a lazy iframe (video, map) does not stall the run', async () => {
    const page = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body><h1>Shop</h1><div style="height:5000px"></div><iframe loading="lazy" src="/frame" width="400" height="300"></iframe></body></html>');
    });
    const port = await listen(page, '127.0.0.1', 0);
    try {
      const config = normalizeConfig({
        settings: { dataDir, timeout: '4s', retries: 0 },
        sites: [{ name: 'Lazy', url: `http://127.0.0.1:${port}`, journeys: [{ name: 'Home', steps: [{ goto: '/' }, { expectText: 'Shop' }] }] }],
      });
      const t0 = Date.now();
      const [run] = await new Engine(config, resolveSites(config), {}, { save: false, alert: false }).runAll();
      assert.equal(run!.status, 'passed', JSON.stringify(run!.stages));
      assert.ok(Date.now() - t0 < 20_000, 'finished promptly');
    } finally {
      page.close();
    }
  });

  test('when the browser cannot start: no outage alert, a monitor alert after 3 tries, then "checking again"', async () => {
    const received: { event: string; title: string }[] = [];
    const hook = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push(JSON.parse(body));
        res.end('ok');
      });
    });
    const port = await listen(hook, '127.0.0.1', 0);
    const dir = await mkdtemp(path.join(os.tmpdir(), 'jg-monitor-'));
    try {
      shop.setMode('none');
      const config = normalizeConfig({
        settings: { dataDir: dir, timeout: '4s', retries: 0, browser: { executablePath: '/bin/false' } },
        alerts: [{ type: 'webhook', url: `http://127.0.0.1:${port}/hook` }],
        sites: [
          {
            name: 'Demo',
            url: shop.url,
            journeys: [{ name: 'A', steps: [{ goto: '/' }] }, { name: 'B', steps: [{ goto: '/shop/' }] }, { name: 'C', steps: [{ goto: '/cart/' }] }],
          },
        ],
      });
      const engine = new Engine(config, resolveSites(config));
      const runs = await engine.runAll();
      assert.ok(runs.every((r) => r.monitorError), 'every run is marked as a monitor error');
      assert.equal(engine.healthy(), false);
      assert.deepEqual(received.map((r) => r.event), ['monitor'], 'one monitor alert, no outage alerts');
      config.settings.browser.executablePath = undefined;
      await engine.runAll();
      assert.equal(engine.healthy(), true);
      assert.deepEqual(received.map((r) => r.event), ['monitor', 'monitor-recovered']);
    } finally {
      hook.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('`journeyguard run` exits 2 (not 0) when nothing could be checked', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'jg-cli-'));
    try {
      const file = path.join(dir, 'journeyguard.yml');
      await writeFile(
        file,
        `settings:\n  browser:\n    executablePath: /bin/false\nsites:\n  - name: Demo\n    url: ${shop.url}\n    journeys:\n      - name: Home\n        steps:\n          - goto: /\n`,
      );
      const log = console.log;
      console.log = () => undefined;
      try {
        assert.equal(await main(['run', '--config', file, '--no-save']), 2);
      } finally {
        console.log = log;
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('webhook alert is sent on failure and on recovery', async () => {
    const received: { event: string; failedStage?: string }[] = [];
    const hook = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push(JSON.parse(body));
        res.end('ok');
      });
    });
    const port = await listen(hook, '127.0.0.1', 0);
    const alertDir = await mkdtemp(path.join(os.tmpdir(), 'jg-alert-'));
    try {
      const config = normalizeConfig({
        settings: { dataDir: alertDir, timeout: '4s', retries: 0 },
        alerts: [{ type: 'webhook', url: `http://127.0.0.1:${port}/hook` }],
        sites: [{ name: 'Demo', url: shop.url, journeys: [{ preset: 'woocommerce' }] }],
      });
      const engine = new Engine(config, resolveSites(config));
      shop.setMode('payment');
      await engine.runAll();
      await engine.runAll(); // still failing: no second alert
      shop.setMode('none');
      await engine.runAll();
      assert.deepEqual(received.map((r) => r.event), ['failure', 'recovery']);
      assert.equal(received[0]!.failedStage, 'Payment');
    } finally {
      hook.close();
      await rm(alertDir, { recursive: true, force: true });
    }
  });
});
