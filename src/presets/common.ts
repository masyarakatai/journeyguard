import tls from 'node:tls';
import type { Step, StepContext } from '../types.js';
import { StepError } from '../steps.js';

/**
 * Text that means the page is broken even when the server answers 200 OK. These phrases also appear
 * in blog posts and help articles, so they only count when the page looks like an error page:
 * short, or the phrase is in the title or main heading.
 */
export const FATAL_PAGE_TEXT: { pattern: RegExp; label: string }[] = [
  { pattern: /there has been a critical error on (this|your) website/i, label: 'WordPress critical error' },
  { pattern: /υπήρξε ένα κρίσιμο σφάλμα/i, label: 'WordPress critical error' },
  { pattern: /error establishing a database connection/i, label: 'Database connection error' },
  { pattern: /σφάλμα (κατά τη )?σύνδεσης? (με|στη) (τη )?βάση δεδομένων/i, label: 'Database connection error' },
  { pattern: /briefly unavailable for scheduled maintenance/i, label: 'Stuck in WordPress maintenance mode' },
  { pattern: /\b(502 bad gateway|503 service (temporarily )?unavailable|504 gateway time-?out)\b/i, label: 'Server gateway error' },
  { pattern: /this store is unavailable/i, label: 'Store unavailable' },
];

/** PHP prints errors before the page when display_errors is on: "Fatal error: … in /x.php on line 12". */
const PHP_ERROR = /(^|\n)\s*(?:php )?(fatal|parse) error:.{0,400}?(?:\bon line \d+|\.php:\d+)/i;
/**
 * Markup only the error machinery itself prints, wherever it lands on the page (a checkout template
 * can die halfway down, after the header and menu). An article quoting an error escapes the tags.
 */
const ERROR_MARKUP: { pattern: RegExp; label: string }[] = [
  { pattern: /<b>\s*(?:fatal|parse) error\s*<\/b>\s*:/i, label: 'PHP fatal error' },
  { pattern: /<body[^>]*\bid=["']error-page["']|<div class=["']wp-die-message["']/i, label: 'WordPress error page' },
];

/** Error pages from WordPress, PHP, nginx or Cloudflare are a few hundred characters long. */
const ERROR_PAGE_MAX_CHARS = 1_500;

export async function pageText(ctx: StepContext): Promise<string> {
  return ctx.page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
}

/** Lower case without accents, so Greek matches with or without τόνους ("ρομπότ" = "ρομποτ"). */
export function plain(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/ς/g, 'σ');
}

/**
 * Anti-spam and anti-bot answers ("confirm you are not a robot", "reCAPTCHA verification failed",
 * "Επιβεβαιώστε ότι δεν είστε ρομπότ"). Matched against plain() text.
 */
export const ANTI_BOT_TEXT =
  /not a robot|are you a (?:robot|human)|verify (?:that )?you are (?:a )?human|human verification|captcha|bot (?:detected|protection)|(?:marked|flagged|detected) as spam|spam (?:protection|filter|detected)|ρομποτ|επαληθευση (?:ασφαλειασ|οτι ειστε ανθρωποσ)/g;

/** Returns the error label when the current page is an error page, otherwise undefined. */
export function errorPageLabel(text: string, title = '', heading = '', html = ''): string | undefined {
  const trimmed = text.trim();
  if (PHP_ERROR.test(trimmed.slice(0, 800))) return 'PHP fatal error';
  const marked = ERROR_MARKUP.find((m) => m.pattern.test(html));
  if (marked) return marked.label;
  const short = trimmed.length < ERROR_PAGE_MAX_CHARS;
  const hit = FATAL_PAGE_TEXT.find((f) => f.pattern.test(`${title}\n${heading}`) || (short && f.pattern.test(trimmed)));
  return hit?.label;
}

export function noFatalErrors(): Step {
  return {
    name: 'No error page',
    custom: async (ctx) => {
      const text = await pageText(ctx);
      const title = await ctx.page.title().catch(() => '');
      const heading = await ctx.page.locator('h1').first().innerText({ timeout: 1_000 }).catch(() => '');
      const html = await Promise.race([ctx.page.content().catch(() => ''), new Promise<string>((r) => setTimeout(() => r(''), 3_000))]);
      const label = errorPageLabel(text, title, heading, html);
      if (label) throw new StepError(`Page shows an error: ${label}`);
    },
  };
}

export function recordLoadTime(key: string): Step {
  return {
    name: 'Measure load time',
    optional: true,
    custom: async (ctx) => {
      const ms = await ctx.page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
        return nav ? Math.round(nav.loadEventEnd > 0 ? nav.loadEventEnd : nav.domContentLoadedEventEnd) : -1;
      });
      if (ms >= 0) ctx.info[key] = ms;
      if (ms > 8_000) ctx.warn(`Slow page: ${(ms / 1000).toFixed(1)}s to load`);
    },
  };
}

/** Flags broken first-party CSS/JS that silently breaks buttons and layouts. */
export function noBrokenAssets(): Step {
  return {
    name: 'Scripts and styles load',
    optional: true,
    custom: async (ctx) => {
      const origin = new URL(ctx.baseUrl).origin;
      const broken = ctx
        .failedRequests()
        .filter((r) => (r.resourceType === 'script' || r.resourceType === 'stylesheet') && r.url.startsWith(origin));
      if (broken.length) {
        throw new StepError(`${broken.length} script/style file(s) failed to load, e.g. ${broken[0]!.url} (${broken[0]!.status ?? broken[0]!.failure})`);
      }
    },
  };
}

export function getCertificate(host: string, port = 443, timeoutMs = 10_000): Promise<tls.PeerCertificate> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      if (!cert || !cert.valid_to) reject(new Error('no certificate presented'));
      else resolve(cert);
    });
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('timeout'));
    });
    socket.on('error', reject);
  });
}

export function sslCertificateStep(minDays: number): Step {
  return {
    name: 'Certificate is valid',
    custom: async (ctx) => {
      const url = new URL(ctx.baseUrl);
      if (url.protocol !== 'https:') {
        ctx.warn('Site is not served over HTTPS');
        return;
      }
      let cert: tls.PeerCertificate;
      try {
        cert = await getCertificate(url.hostname, Number(url.port) || 443);
      } catch (e) {
        ctx.warn(`Could not read the certificate directly (${(e as Error).message}); the browser check still passed`);
        return;
      }
      const days = Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86_400_000);
      ctx.info.sslDaysLeft = days;
      ctx.info.sslIssuer = String(cert.issuer?.O ?? cert.issuer?.CN ?? 'unknown');
      if (days < 0) throw new StepError(`SSL certificate expired ${-days} day(s) ago`);
      if (days < minDays) throw new StepError(`SSL certificate expires in ${days} day(s)`);
      if (days < 30) ctx.warn(`SSL certificate expires in ${days} days`);
    },
  };
}

/** Polls a JSON endpoint with the browser's cookies until `ok` returns true. */
export async function pollJson(
  ctx: StepContext,
  url: string,
  ok: (body: unknown) => boolean,
  timeoutMs: number,
): Promise<{ status: number; body: unknown } | undefined> {
  const deadline = Date.now() + timeoutMs;
  let last: { status: number; body: unknown } | undefined;
  while (Date.now() < deadline) {
    const res = await ctx.page.request
      .get(url, { failOnStatusCode: false, timeout: Math.max(1_000, deadline - Date.now()), headers: ctx.siteHeaders })
      .catch(() => undefined);
    if (res) {
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = undefined;
      }
      last = { status: res.status(), body };
      if (res.status() === 404) return last;
      if (res.ok() && ok(body)) return last;
    }
    await ctx.page.waitForTimeout(400);
  }
  return last;
}

export async function hrefOf(ctx: StepContext, selectors: string[]): Promise<string | undefined> {
  for (const sel of selectors) {
    const loc = ctx.page.locator(sel).first();
    if ((await loc.count()) > 0) {
      const href = await loc.getAttribute('href').catch(() => null);
      if (href && !href.startsWith('#') && !href.startsWith('javascript:')) return new URL(href, ctx.page.url()).toString();
    }
  }
  return undefined;
}

/** Common payment providers, detected from iframes and scripts on the checkout page. */
export const GATEWAY_SIGNATURES: { name: string; pattern: RegExp }[] = [
  { name: 'Stripe', pattern: /js\.stripe\.com|__privateStripeFrame|payment_method_stripe/i },
  { name: 'PayPal', pattern: /paypal\.com\/sdk|paypalobjects\.com|paypal-button|payment_method_(?:ppcp|paypal)/i },
  { name: 'Viva', pattern: /vivapayments\.com|viva\.com\/web|viva_?wallet/i },
  { name: 'JCC', pattern: /jccsecure\.com|jcc\.com\.cy|payment_method_jcc/i },
  { name: 'Everypay', pattern: /everypay/i },
  { name: 'Cardlink', pattern: /cardlink/i },
  { name: 'Nexi / Alpha Bank', pattern: /\bnexi|alpha_?bank/i },
  { name: 'Piraeus Bank', pattern: /piraeus|winbank/i },
  { name: 'Eurobank / Worldline', pattern: /eurobank|worldline/i },
  { name: 'IRIS', pattern: /payment_method_iris|iris_?pay/i },
  { name: 'Revolut', pattern: /revolut/i },
  { name: 'Klarna', pattern: /klarna/i },
  { name: 'Square', pattern: /squarecdn\.com|squareup\.com/i },
  { name: 'Adyen', pattern: /adyen/i },
  { name: 'Braintree', pattern: /braintreegateway\.com|payment_method_braintree/i },
  { name: 'Shopify Payments', pattern: /checkout\.pci\.shopifyinc\.com|card-fields/i },
];

export async function detectGateways(ctx: StepContext): Promise<string[]> {
  const sources = await ctx.page
    .evaluate(() =>
      [
        ...Array.from(document.querySelectorAll('iframe')).map((f) => `${f.src} ${f.name} ${f.className}`),
        ...Array.from(document.querySelectorAll('script[src]')).map((s) => (s as HTMLScriptElement).src),
        ...Array.from(document.querySelectorAll('[class*="paypal"],[id*="paypal"]')).map(() => 'paypal-button'),
        // Redirect gateways (most Greek and Cypriot banks) load no script: their method id names them.
        ...Array.from(document.querySelectorAll('#payment li.wc_payment_method')).map((li) => li.className),
        ...Array.from(document.querySelectorAll('.wc-block-checkout__payment-method input[type=radio]')).map((r) => `payment_method_${(r as HTMLInputElement).value}`),
      ].join('\n'),
    )
    .catch(() => '');
  return GATEWAY_SIGNATURES.filter((g) => g.pattern.test(sources)).map((g) => g.name);
}
