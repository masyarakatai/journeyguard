import type { JourneyConfig } from './types.js';
import { VERSION } from './version.js';

export type Platform = 'woocommerce' | 'shopify' | 'wordpress' | 'prestashop' | 'magento' | 'opencart' | 'wix' | 'squarespace' | 'unknown';

export interface Detection {
  url: string;
  status: number;
  platform: Platform;
  signals: string[];
  contactPath?: string;
  captcha?: string;
  cdn?: string;
  journeys: JourneyConfig[];
}

const USER_AGENT = `Mozilla/5.0 (compatible; JourneyGuard/${VERSION}; +https://github.com/nxdpro/journeyguard)`;

async function get(url: string): Promise<{ status: number; url: string; text: string; headers: Headers } | undefined> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, 'x-journeyguard': '1' }, redirect: 'follow', signal: AbortSignal.timeout(20_000) });
    return { status: res.status, url: res.url, text: await res.text(), headers: res.headers };
  } catch {
    return undefined;
  }
}

export function detectFromHtml(html: string, headers: Headers = new Headers()): { platform: Platform; signals: string[]; captcha?: string; cdn?: string } {
  const signals: string[] = [];
  const test = (re: RegExp, label: string) => {
    const hit = re.test(html);
    if (hit) signals.push(label);
    return hit;
  };
  const header = (name: string) => headers.get(name) ?? '';

  let platform: Platform = 'unknown';
  // Only technical traces count: a page that merely mentions "WooCommerce" or "Shopify" in its
  // text (an agency's service list, a blog post) must not be mistaken for a shop.
  const shopify =
    test(/cdn\.shopify\.com\/(?:s|shopifycloud)\/|Shopify\.shop\s*=|Shopify\.theme\s*=|shopify-features/i, 'Shopify assets') ||
    /shopify/i.test(header('powered-by')) ||
    !!header('x-shopid');
  const woo = test(
    /\/wp-content\/plugins\/woocommerce\/|<body[^>]*class=["'][^"']*\bwoocommerce(?:-js|-no-js|-page)\b|wc_add_to_cart_params|["'\s]wc-block-components-/i,
    'WooCommerce assets',
  );
  const wp = test(/\/wp-content\/|\/wp-includes\/|<meta[^>]+generator[^>]+WordPress/i, 'WordPress paths');
  if (shopify) platform = 'shopify';
  else if (woo) platform = 'woocommerce';
  else if (test(/prestashop|var prestashop\s*=/i, 'PrestaShop')) platform = 'prestashop';
  else if (test(/Magento_|mage\/cookies|data-mage-init/i, 'Magento')) platform = 'magento';
  else if (test(/catalog\/view\/theme|index\.php\?route=common\/home/i, 'OpenCart')) platform = 'opencart';
  else if (test(/static\.wixstatic\.com|wix-bolt/i, 'Wix')) platform = 'wix';
  else if (test(/squarespace\.com|static1\.squarespace/i, 'Squarespace')) platform = 'squarespace';
  else if (wp) platform = 'wordpress';

  let captcha: string | undefined;
  if (/google\.com\/recaptcha|grecaptcha/i.test(html)) captcha = 'reCAPTCHA';
  else if (/hcaptcha\.com/i.test(html)) captcha = 'hCaptcha';
  else if (/challenges\.cloudflare\.com\/turnstile/i.test(html)) captcha = 'Cloudflare Turnstile';

  let cdn: string | undefined;
  if (header('cf-ray') || /cloudflare/i.test(header('server'))) cdn = 'Cloudflare';
  else if (/sucuri/i.test(header('x-sucuri-id') + header('server'))) cdn = 'Sucuri';

  return { platform, signals, captcha, cdn };
}

/** A server-rendered form with an email field or a message box (not a search or comment form). */
export function hasContactForm(html: string): boolean {
  const forms = html.match(/<form\b[\s\S]*?<\/form>/gi) ?? [];
  return forms.some(
    (f) =>
      !/id=["']commentform["']|wp-comments-post\.php|role=["']search["']|class=["'][^"']*search-form/i.test(f.slice(0, 400)) &&
      /type=["']?email|<textarea|name=["'][^"']*e-?mail/i.test(f),
  );
}

export function findContactPath(html: string, base: string): string | undefined {
  const origin = new URL(base).origin;
  const re = /<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const href = m[1]!;
    const text = m[2]!.replace(/<[^>]+>/g, ' ');
    if (/contact|epikoinon|επικοιν|kontakt/i.test(`${decodeURIComponent(href)} ${text}`)) {
      try {
        const u = new URL(href, base);
        if (u.origin === origin) return u.pathname;
      } catch {
        // ignore malformed links
      }
    }
  }
  return undefined;
}

export function suggestJourneys(platform: Platform, contactPath?: string): JourneyConfig[] {
  const journeys: JourneyConfig[] = [{ preset: 'website' }];
  if (platform === 'woocommerce') journeys.push({ preset: 'woocommerce' });
  if (platform === 'shopify') journeys.push({ preset: 'shopify' });
  if (contactPath) journeys.push({ preset: 'contact-form', options: { path: contactPath } });
  return journeys;
}

export async function detect(url: string): Promise<Detection> {
  const home = await get(url);
  if (!home) throw new Error(`Could not reach ${url}`);
  const found = detectFromHtml(home.text, home.headers);

  // Confirm WooCommerce through its public Store API when the markup is ambiguous.
  if (found.platform === 'wordpress') {
    const api = await get(new URL('/wp-json/wc/store/v1/products?per_page=1', home.url).toString());
    if (api && api.status === 200 && api.text.trim().startsWith('[')) {
      found.platform = 'woocommerce';
      found.signals.push('WooCommerce Store API');
    }
  }

  // Suggest a contact-form check only when the contact page really has a form to fill in.
  let contactPath = findContactPath(home.text, home.url);
  if (contactPath) {
    const page = await get(new URL(contactPath, home.url).toString());
    if (!page || page.status >= 400 || !hasContactForm(page.text)) contactPath = undefined;
  }
  return {
    url: home.url,
    status: home.status,
    ...found,
    contactPath,
    journeys: suggestJourneys(found.platform, contactPath),
  };
}
