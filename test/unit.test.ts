import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration, interpolateEnv, parseDuration, redact, slugify } from '../src/util.js';
import { ConfigError, normalizeConfig } from '../src/config.js';
import { isDangerousTarget, normalizeLabel, orderRequestReason, type ClickTarget } from '../src/safety.js';
import { detectFromHtml, findContactPath, hasContactForm, suggestJourneys } from '../src/detect.js';
import { errorPageLabel } from '../src/presets/common.js';
import { localizeError } from '../src/i18n.js';
import { label } from '../src/presets/options.js';
import { transition } from '../src/alerts/index.js';
import { buildMessage } from '../src/alerts/message.js';
import { diagnose } from '../src/diagnose.js';
import { resolveSites } from '../src/resolve.js';
import type { RunResult } from '../src/types.js';

const target = (text: string, extra: Partial<ClickTarget> = {}): ClickTarget => ({
  tag: 'button',
  type: 'submit',
  role: '',
  texts: [text],
  id: '',
  name: '',
  className: '',
  innerId: '',
  submitCapable: true,
  ...extra,
});

function fakeRun(overrides: Partial<RunResult> = {}): RunResult {
  return {
    id: 'r1',
    siteId: 'shop',
    siteName: 'Shop',
    siteUrl: 'https://shop.example',
    journeyId: 'checkout',
    journeyName: 'Checkout',
    status: 'failed',
    startedAt: new Date().toISOString(),
    durationMs: 1200,
    attempts: 1,
    stages: [
      { name: 'Website', status: 'passed', durationMs: 10, steps: [] },
      { name: 'Checkout', status: 'failed', durationMs: 10, steps: [], error: 'HTTP 500 on https://shop.example/checkout/' },
    ],
    failedStage: 'Checkout',
    evidence: { consoleErrors: [], failedRequests: [], textSample: 'There has been a critical error on this website.' },
    hints: [],
    info: {},
    ...overrides,
  };
}

test('parseDuration understands common units', () => {
  assert.equal(parseDuration('500ms'), 500);
  assert.equal(parseDuration('30s'), 30_000);
  assert.equal(parseDuration('15m'), 900_000);
  assert.equal(parseDuration('24h'), 86_400_000);
  assert.equal(parseDuration(250), 250);
  assert.throws(() => parseDuration('soon'));
  assert.equal(formatDuration(1500), '1.5s');
});

test('slugify transliterates Greek', () => {
  assert.equal(slugify('Κατάστημα Καφέ'), 'katastima-kafe');
  assert.equal(slugify('Shop checkout (WooCommerce)'), 'shop-checkout-woocommerce');
  assert.equal(slugify('!!!'), 'item');
});

test('interpolateEnv replaces variables and defaults', () => {
  assert.equal(interpolateEnv('a ${X} b ${Y:-fallback}', { X: '1' }), 'a 1 b fallback');
});

test('redact hides secrets in URLs', () => {
  assert.equal(redact('https://api.telegram.org/bot123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ/sendMessage'), 'https://api.telegram.org/bot***/sendMessage');
  assert.equal(redact('smtp://user:secret@mail.example.com'), 'smtp://user:***@mail.example.com');
  assert.match(redact('https://discord.com/api/webhooks/123/abcDEF'), /webhooks\/123\/\*\*\*/);
});

test('normalizeConfig applies defaults and interpolates env', () => {
  const config = normalizeConfig(
    { sites: [{ name: 'Shop', url: 'https://shop.example', journeys: [{ preset: 'woocommerce' }] }], alerts: [{ type: 'telegram', botToken: '${TG}', chatId: '1' }] },
    { TG: 'token' },
  );
  assert.equal(config.settings.safeMode, true);
  assert.equal(config.settings.retries, 1);
  assert.equal(config.alerts[0]!.botToken, 'token');
});

test('normalizeConfig reports every problem at once', () => {
  try {
    normalizeConfig({
      settings: { interval: 'often' },
      alerts: [{ type: 'discord' }],
      sites: [{ name: 'X', url: 'ftp://nope', journeys: [{ preset: 'magic' }, { name: 'Custom', steps: [{ goto: '/', click: 'a' }] }] }],
    });
    assert.fail('expected ConfigError');
  } catch (e) {
    assert.ok(e instanceof ConfigError);
    const text = e.problems.join('\n');
    assert.match(text, /settings\.interval/);
    assert.match(text, /webhookUrl/);
    assert.match(text, /http:\/\/ or https:\/\//);
    assert.match(text, /unknown preset "magic"/);
    assert.match(text, /exactly one action/);
  }
});

test('safe mode fails closed and the dashboard password can come from the environment', () => {
  const base = { sites: [{ name: 'S', url: 'https://s.example', journeys: [{ preset: 'website' }] }] };
  assert.equal(normalizeConfig({ ...base, settings: { safeMode: '${UNSET_VAR}' } }, {}).settings.safeMode, true);
  assert.equal(normalizeConfig({ ...base, settings: { safeMode: false } }, {}).settings.safeMode, false);
  assert.throws(() => normalizeConfig({ ...base, settings: { safeMode: 0 } }, {}), ConfigError);
  assert.equal(normalizeConfig(base, { JOURNEYGUARD_PASSWORD: 'a-strong-secret' }).settings.dashboard.password, 'a-strong-secret');
  assert.throws(() => normalizeConfig({ ...base, settings: { report: { brandUrl: 'javascript:alert(1)' } } }, {}), ConfigError);
});

test('journey ids are stable and duplicates are rejected', () => {
  const mk = (journeys: unknown[]) =>
    resolveSites(normalizeConfig({ sites: [{ name: 'Shop', url: 'https://s.example', journeys }] }, {}))[0]!.journeys.map((j) => j.id);
  assert.deepEqual(mk([{ preset: 'contact-form', options: { path: '/contact/' } }, { preset: 'contact-form', options: { path: '/wholesale/' } }]), [
    'contact-form-contact',
    'contact-form-wholesale',
  ]);
  // Disabling the first journey must not hand its id (and history) to the second.
  assert.deepEqual(mk([{ preset: 'contact-form', options: { path: '/contact/' }, enabled: false }, { preset: 'contact-form', options: { path: '/wholesale/' } }]), [
    'contact-form-wholesale',
  ]);
  assert.throws(() => mk([{ preset: 'woocommerce' }, { preset: 'woocommerce' }]), ConfigError);
});

test('flat custom journeys become one stage per step; presets keep their interval', () => {
  const config = normalizeConfig({
    sites: [
      {
        name: 'App',
        url: 'https://app.example',
        journeys: [
          { name: 'Login', steps: [{ goto: '/login' }, { fill: { selector: '#email', value: 'a@b.c' } }, { name: 'Dashboard shows', expectText: 'Welcome' }] },
          { preset: 'contact-form' },
        ],
      },
    ],
  });
  const [site] = resolveSites(config);
  assert.deepEqual(site!.journeys[0]!.stages.map((s) => s.name), ['Open /login', 'Fill #email', 'Dashboard shows']);
  assert.equal(site!.journeys[1]!.intervalMs, 86_400_000);
});

test('safe mode recognises order and payment buttons (EN + EL)', () => {
  for (const label of [
    'Place order',
    'Pay now',
    'Pay €24.90',
    'Pay EUR 24.90',
    'Pay',
    'Confirm Order',
    'Complete checkout',
    'Submit payment',
    'Order with obligation to pay',
    'Ολοκλήρωση παραγγελίας',
    'ΟΛΟΚΛΗΡΩΣΗ ΠΑΡΑΓΓΕΛΙΑΣ',
    'Καταχώρηση παραγγελίας',
    'Πληρωμή τώρα',
    'ΠΛΗΡΩΜΗ',
    'Πληρώστε 25,00 €',
    `Place order · Total €24.90 · By placing your order you agree to our terms and conditions and privacy policy ${'.'.repeat(80)}`,
  ]) {
    assert.ok(isDangerousTarget(target(label)), label);
  }
  assert.ok(isDangerousTarget(target('Continue', { id: 'place_order' })));
  assert.ok(isDangerousTarget(target('', { tag: 'span', innerId: 'place_order', submitCapable: false })), 'span inside #place_order');
  assert.ok(isDangerousTarget(target('', { className: 'wc-block-components-checkout-place-order-button' })));
  assert.ok(isDangerousTarget(target('Confirm Order', { id: 'button-confirm' })), 'OpenCart confirm');
});

test('safe mode does not refuse harmless controls', () => {
  for (const label of ['Add to cart', 'Proceed to checkout', 'Προσθήκη στο καλάθι', 'Payment options', 'Pay later with Klarna info', 'Send', 'Apply coupon']) {
    assert.equal(isDangerousTarget(target(label)), undefined, label);
  }
  // Selecting a payment method (a radio or its label) is never an order.
  assert.equal(isDangerousTarget(target('Pay now', { tag: 'input', type: 'radio', submitCapable: false })), undefined);
  // Only the start of a long label counts, so a container's text further down is ignored.
  assert.equal(isDangerousTarget(target(`Order summary ${'x'.repeat(200)} Place order`)), undefined);
});

test('order requests are recognised on common platforms', () => {
  assert.equal(orderRequestReason('POST', 'https://s.example/?wc-ajax=checkout'), 'WooCommerce checkout');
  assert.equal(orderRequestReason('POST', 'https://s.example/wp-json/wc/store/v1/checkout'), 'WooCommerce checkout');
  assert.equal(orderRequestReason('POST', 'https://s.example/checkouts/unstable/graphql?operationName=SubmitForCompletion'), 'Shopify checkout');
  assert.equal(orderRequestReason('POST', 'https://s.example/index.php?route=checkout/confirm'), 'OpenCart checkout');
  assert.equal(orderRequestReason('POST', 'https://api.stripe.com/v1/payment_intents/pi_123/confirm'), 'Stripe payment');
  assert.equal(orderRequestReason('GET', 'https://s.example/?wc-ajax=checkout'), undefined);
  assert.equal(orderRequestReason('POST', 'https://s.example/?wc-ajax=add_to_cart'), undefined);
  assert.equal(orderRequestReason('POST', 'https://s.example/wp-json/wc/store/v1/cart/add-item'), undefined);
});

test('normalizeLabel strips accents, case and final sigma', () => {
  assert.equal(normalizeLabel('  ΟΛΟΚΛΉΡΩΣΗ   Παραγγελίας '), 'ολοκληρωση παραγγελιασ');
});

test('error phrases only count on actual error pages', () => {
  const blog = `Welcome to our hosting blog. ${'Lorem ipsum dolor sit amet. '.repeat(80)} How to fix a 502 Bad Gateway error. "Error establishing a database connection": 5 quick fixes.`;
  assert.equal(errorPageLabel(blog, 'Fast WordPress hosting', 'Fast WordPress hosting'), undefined);
  assert.equal(errorPageLabel('There has been a critical error on this website. Learn more about troubleshooting WordPress.'), 'WordPress critical error');
  assert.equal(errorPageLabel(`${'x '.repeat(1000)}`, 'Database Error', 'Error establishing a database connection'), 'Database connection error');
  assert.equal(errorPageLabel(`Fatal error: Uncaught Error: Call to undefined function foo() in /var/www/wp-content/plugins/x/x.php on line 12\n${'page '.repeat(500)}`), 'PHP fatal error');
  // A checkout template that dies halfway down the page, after the header and menu.
  const midPage = `<header>${'menu '.repeat(400)}</header><br />\n<b>Fatal error</b>:  Uncaught TypeError: x in /var/www/a.php:3`;
  assert.equal(errorPageLabel('menu '.repeat(400) + 'Fatal error: Uncaught TypeError', '', '', midPage), 'PHP fatal error');
  assert.equal(errorPageLabel('Το ιστότοπο αντιμετωπίζει τεχνικές δυσκολίες.', '', '', '<body id="error-page"><div class="wp-die-message">x</div>'), 'WordPress error page');
  // Quoting an error in an article escapes the markup.
  assert.equal(errorPageLabel('how to fix', 'Blog', 'Blog', '<p>&lt;b&gt;Fatal error&lt;/b&gt;: in x.php</p>'), undefined);
});

test('detectFromHtml identifies platforms', () => {
  assert.equal(detectFromHtml('<body class="woocommerce-js"><link href="/wp-content/x.css">').platform, 'woocommerce');
  assert.equal(detectFromHtml('<script src="https://cdn.shopify.com/s/x.js"></script>').platform, 'shopify');
  assert.equal(detectFromHtml('<meta name="generator" content="WordPress 6.8">').platform, 'wordpress');
  assert.equal(detectFromHtml('<html></html>').platform, 'unknown');
  // An agency page that only talks about shops is not a shop.
  const agency = '<link href="/wp-content/themes/x/style.css"><p>We build WooCommerce and Shopify stores. Woocommerce experts.</p>';
  assert.equal(detectFromHtml(agency).platform, 'wordpress');
  assert.equal(detectFromHtml('<script src="/wp-content/plugins/woocommerce/assets/js/frontend/cart.js"></script>').platform, 'woocommerce');
  const cf = detectFromHtml('<script src="https://www.google.com/recaptcha/api.js"></script>', new Headers({ 'cf-ray': 'abc' }));
  assert.equal(cf.captcha, 'reCAPTCHA');
  assert.equal(cf.cdn, 'Cloudflare');
});

test('hasContactForm ignores search, comment and email-less forms', () => {
  assert.equal(hasContactForm('<form class="wpcf7-form"><input type="email" name="your-email"><textarea></textarea></form>'), true);
  assert.equal(hasContactForm('<form role="search"><input type="text" name="s"></form>'), false);
  assert.equal(hasContactForm('<form id="commentform" action="/wp-comments-post.php"><textarea></textarea><input type="email"></form>'), false);
  assert.equal(hasContactForm('<p>Call us on 25 000000</p>'), false);
});

test('findContactPath finds Greek and English contact links', () => {
  assert.equal(findContactPath('<a href="/about">About</a><a href="/epikoinonia/">Επικοινωνία</a>', 'https://x.gr/'), '/epikoinonia/');
  assert.equal(findContactPath('<a href="https://other.com/contact">Contact</a>', 'https://x.gr/'), undefined);
  assert.deepEqual(suggestJourneys('woocommerce', '/contact').map((j) => j.preset), ['website', 'woocommerce', 'contact-form']);
});

test('alerts follow delivered alerts, not just the last status', () => {
  const failed = fakeRun();
  const passed = fakeRun({ status: 'passed' });
  const state = (alerted?: 'failure' | 'recovery') => ({ status: 'failed' as const, since: '', lastRunAt: '', lastRunId: '', alerted });
  assert.equal(transition(undefined, failed), 'failure');
  assert.equal(transition(state(undefined), failed), 'failure', 'a failure alert that never got through is retried');
  assert.equal(transition(state('failure'), failed), undefined, 'no repeat while still failing');
  assert.equal(transition(state('failure'), passed), 'recovery');
  assert.equal(transition(state('recovery'), passed), undefined);
  assert.equal(transition(state('recovery'), failed), 'failure');
  assert.equal(transition(state('failure'), fakeRun({ status: 'warning' })), 'recovery', 'a slow but working page is a recovery');
  assert.equal(transition(state('failure'), fakeRun({ status: 'warning', inconclusive: true })), undefined, 'a CAPTCHA is not a recovery');
  assert.equal(transition(state(undefined), fakeRun({ monitorError: 'browser crashed' })), undefined, 'monitor errors never alert');
});

test('diagnosis explains a WordPress critical error in both languages', () => {
  const en = diagnose(fakeRun(), 'en');
  assert.equal(en[0]!.id, 'wp-critical');
  assert.ok(!en.some((h) => h.id === 'server-error'), 'generic 5xx hint is suppressed by the specific one');
  const el = diagnose(fakeRun(), 'el');
  assert.match(el[0]!.title, /σφάλμα/i);
  assert.deepEqual(diagnose(fakeRun({ status: 'passed' })), []);
});

test('alert messages carry the failed stage and the likely cause', () => {
  const run = fakeRun();
  run.hints = diagnose(run, 'en');
  const msg = buildMessage(run, 'failure', 'en', { publicUrl: 'https://monitor.example/' });
  assert.match(msg.title, /❌ Shop: Checkout journey failed/);
  assert.match(msg.text, /Failed at: Checkout/);
  assert.match(msg.text, /Likely cause: PHP\/WordPress fatal error/);
  assert.match(msg.text, /https:\/\/monitor\.example\/#shop%2Fcheckout/);
  assert.match(msg.telegramHtml, /<b>/);
  assert.doesNotMatch(msg.telegramHtml, /<script/);
  const recovery = buildMessage(fakeRun({ status: 'passed' }), 'recovery', 'el', { downForMs: 600_000 });
  assert.match(recovery.title, /λειτουργεί ξανά/);
  assert.match(recovery.text, /Downtime: 10m/);
});

test('Greek reports translate common step errors and keep unknown ones', () => {
  assert.equal(localizeError('HTTP 500 on https://shop.gr/checkout/', 'el'), 'HTTP 500 στη σελίδα https://shop.gr/checkout/');
  assert.equal(localizeError('Expected payment method is missing: Viva (offered: Αντικαταβολή)', 'el'), 'Λείπει ο τρόπος πληρωμής: Viva (διαθέσιμοι: Αντικαταβολή)');
  assert.equal(localizeError('HTTP 500 on https://shop.gr/', 'en'), 'HTTP 500 on https://shop.gr/');
  assert.equal(localizeError('Something new', 'el'), 'Something new');
});

test('Spanish translates diagnosis, dashboard labels and common step errors', () => {
  const es = diagnose(fakeRun(), 'es');
  assert.match(es[0]!.title, /PHP\/WordPress|fatal/i);
  assert.match(es[0]!.detail, /plugin|tema/i);
  assert.equal(label('es', 'checkout'), 'Proceso de compra');
  assert.equal(localizeError('HTTP 500 on https://shop.es/checkout/', 'es'), 'HTTP 500 en la página https://shop.es/checkout/');
  assert.equal(localizeError('Something new', 'es'), 'Something new');
  const alert = buildMessage(Object.assign(fakeRun(), { hints: es }), 'failure', 'es');
  assert.match(alert.title, /ha fallado/);
  assert.match(alert.text, /Causa probable/);
});
