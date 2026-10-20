import type { Locator, Page, Response } from 'playwright';
import type { SelectorInput, Step, StepContext } from './types.js';
import { STEP_ACTIONS } from './types.js';
import { SafetyError } from './safety.js';
import { dismissOverlays } from './overlays.js';
import { formatDuration, resolveUrl, truncate } from './util.js';

export class StepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StepError';
  }
}

/** Thrown when a stage cannot be verified safely (e.g. a CAPTCHA). Reported as "not tested". */
export class NotTestedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotTestedError';
  }
}

export function stepAction(step: Step): string {
  if ('custom' in step) return 'custom';
  return Object.keys(step).find((k) => (STEP_ACTIONS as readonly string[]).includes(k)) ?? 'unknown';
}

function selectorLabel(sel: SelectorInput | undefined): string {
  if (sel === undefined) return '';
  return Array.isArray(sel) ? sel.join(' | ') : sel;
}

/** Default human-readable name for a step when the user did not give one. */
export function describeStep(step: Step): string {
  if (step.name) return step.name;
  if ('goto' in step) return `Open ${step.goto}`;
  if ('click' in step) {
    const c = step.click;
    if (typeof c === 'object' && !Array.isArray(c)) return `Click ${c.text ? `"${c.text}"` : selectorLabel(c.selector)}`;
    return `Click ${selectorLabel(c)}`;
  }
  if ('fill' in step) return `Fill ${selectorLabel(step.fill.selector)}`;
  if ('select' in step) return `Select "${step.select.value}" in ${selectorLabel(step.select.selector)}`;
  if ('check' in step) return `Tick ${selectorLabel(step.check)}`;
  if ('press' in step) return `Press ${step.press.key}`;
  if ('expectVisible' in step) return `See ${selectorLabel(step.expectVisible)}`;
  if ('expectHidden' in step) return `Not see ${selectorLabel(step.expectHidden)}`;
  if ('expectText' in step) {
    const t = step.expectText;
    return `See text "${typeof t === 'string' ? t : t.text}"`;
  }
  if ('expectNoText' in step) return `No text "${step.expectNoText}"`;
  if ('expectUrl' in step) return `URL matches ${step.expectUrl}`;
  if ('waitFor' in step) return typeof step.waitFor === 'number' ? `Wait ${step.waitFor}ms` : `Wait for ${selectorLabel(step.waitFor)}`;
  if ('screenshot' in step) return `Screenshot ${step.screenshot}`;
  return 'Custom check';
}

/** Builds a locator that matches the first of several fallback selectors. */
export function locate(page: Page, sel: SelectorInput): Locator {
  const list = Array.isArray(sel) ? sel : [sel];
  if (list.length === 0) throw new StepError('Empty selector list');
  let loc = page.locator(list[0]!);
  for (const s of list.slice(1)) loc = loc.or(page.locator(s));
  return loc.first();
}

async function waitVisible(loc: Locator, sel: string, timeout: number): Promise<void> {
  try {
    await loc.waitFor({ state: 'visible', timeout });
  } catch (e) {
    if ((e as Error).name === 'TimeoutError') {
      throw new StepError(`Element not visible after ${formatDuration(timeout)}: ${truncate(sel, 160)}`);
    }
    throw e;
  }
}

type GuardWindow = Window & {
  __journeyguardGuard?: {
    blocked: string[];
    check: (el: Element) => string | undefined;
    checkEnter: (el: Element) => string | undefined;
    checkActive: () => string | undefined;
  };
};

/** Asks the in-page guard whether an element is an order/payment control. */
async function dangerOf(loc: Locator, enter = false): Promise<string | undefined> {
  return loc
    .evaluate((el, isEnter) => {
      const g = (window as GuardWindow).__journeyguardGuard;
      return g ? (isEnter ? g.checkEnter(el) : g.check(el)) ?? null : null;
    }, enter)
    .then((r) => r ?? undefined)
    .catch(() => undefined);
}

/** Throws if the in-page guard blocked an order/payment action in any frame since the last check. */
export async function assertNotBlocked(page: Page): Promise<void> {
  for (const frame of page.frames()) {
    // Lazy or still-loading iframes (videos, maps) have no document yet: never wait on them.
    if (frame.isDetached() || !frame.url() || frame.url() === 'about:blank' && frame !== page.mainFrame()) continue;
    const read = frame
      .evaluate(() => {
        const g = (window as GuardWindow).__journeyguardGuard;
        if (!g || !g.blocked.length) return null;
        const first = g.blocked[0]!;
        g.blocked.length = 0;
        return first;
      })
      .catch(() => null);
    const hit = await Promise.race([read, new Promise<null>((r) => setTimeout(() => r(null), 1_500))]);
    if (hit) throw new SafetyError(hit);
  }
}

/** Turns Playwright's "<div …> intercepts pointer events" into an answer a site owner understands. */
function coveredError(e: unknown, label: string): unknown {
  const msg = (e as Error)?.message ?? '';
  const m = /(<[^>]{1,160}>)[^\n]*intercepts pointer events/.exec(msg);
  if (!m) return e;
  return new NotTestedError(
    `Something on the page covers the ${label}, so it could not be clicked (${truncate(m[1]!, 120)}). Usually a cookie banner or pop-up JourneyGuard could not close.`,
  );
}

/** Clicks a locator, refusing order/payment controls while safe mode is on. */
export async function safeClick(ctx: StepContext, loc: Locator, label: string, timeout: number): Promise<void> {
  await waitVisible(loc, label, timeout);
  const deadline = Date.now() + timeout;
  const left = () => Math.max(1_000, deadline - Date.now());
  // Close cookie banners and pop-ups that appeared since the page loaded, as a visitor would.
  await dismissOverlays(ctx.page);
  try {
    // A trial click never clicks, so it can wait for the control to be ready (and so show its
    // final label to the safety check) and be repeated after closing a late pop-up.
    try {
      await loc.click({ trial: true, timeout: Math.min(left(), 8_000) });
    } catch (e) {
      if ((e as Error).name !== 'TimeoutError' && !/intercepts pointer events/.test((e as Error).message)) throw e;
      await dismissOverlays(ctx.page);
      await loc.click({ trial: true, timeout: left() });
    }
    if (ctx.safeMode) {
      const danger = await dangerOf(loc);
      if (danger) throw new SafetyError(danger);
    }
    await loc.click({ timeout: left() });
  } catch (e) {
    throw coveredError(e, label);
  }
  if (ctx.safeMode) await assertNotBlocked(ctx.page);
}

const SUBMIT_KEYS = /^(?:Enter|NumpadEnter|Space| |\r|\n)$/;

/** Recognises firewall/bot-protection block pages, which say nothing about what real visitors see. */
/** Statuses a web application firewall answers with when it challenges or blocks a visitor. */
const FIREWALL_STATUSES = new Set([403, 415, 429, 503]);

async function firewallName(response: Response, page: Page): Promise<string | undefined> {
  if (!FIREWALL_STATUSES.has(response.status())) return undefined;
  const headers = await response.allHeaders().catch(() => ({}) as Record<string, string>);
  if (headers['cf-mitigated']) return 'Cloudflare';
  if (headers['x-sucuri-block']) return 'Sucuri';
  const html = await Promise.race([page.content().catch(() => ''), new Promise<string>((r) => setTimeout(() => r(''), 3_000))]);
  // Only the block pages themselves count; a normal error page that loads a security plugin's assets does not.
  if (/\/cdn-cgi\/challenge-platform\/|<title>\s*(?:Attention Required! \| Cloudflare|Just a moment\.\.\.)\s*<\/title>/i.test(html)) return 'Cloudflare';
  if (/<title>\s*Sucuri WebSite Firewall/i.test(html)) return 'Sucuri';
  if (/Generated by Wordfence|access to this site has been limited by the site owner/i.test(html)) return 'Wordfence';
  if (/imunify360-webshield|<title>[^<]*Imunify360/i.test(html)) return 'Imunify360';
  if (response.status() === 429) return 'Rate limiting';
  return undefined;
}

export async function gotoUrl(ctx: StepContext, target: string, timeout: number): Promise<void> {
  const url = resolveUrl(ctx.baseUrl, target);
  let response;
  try {
    response = await ctx.page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  } catch (e) {
    const msg = (e as Error).message.split('\n')[0] ?? '';
    if ((e as Error).name === 'TimeoutError') throw new StepError(`Page did not load within ${formatDuration(timeout)}: ${url}`);
    throw new StepError(`Could not open ${url}: ${msg}`);
  }
  const status = response?.status();
  if (response && status !== undefined && status >= 400) {
    const firewall = await firewallName(response, ctx.page);
    if (firewall) {
      throw new NotTestedError(
        `${firewall} blocked the monitor (HTTP ${status}) on ${url}. Allow-list requests with the X-JourneyGuard header or the monitor's IP address.`,
      );
    }
    throw new StepError(`HTTP ${status} on ${url}`);
  }
  await ctx.page.waitForLoadState('load', { timeout: Math.min(timeout, 15_000) }).catch(() => undefined);
  await dismissOverlays(ctx.page);
}

export async function executeStep(step: Step, ctx: StepContext, timeout: number): Promise<void> {
  const { page } = ctx;

  if ('custom' in step) return step.custom({ ...ctx, timeoutMs: timeout });

  if ('goto' in step) return gotoUrl(ctx, step.goto, timeout);

  if ('click' in step) {
    const c = step.click;
    if (typeof c === 'object' && !Array.isArray(c)) {
      if (c.selector) return safeClick(ctx, locate(page, c.selector), selectorLabel(c.selector), timeout);
      if (c.text) {
        const loc = page
          .getByRole('button', { name: c.text })
          .or(page.getByRole('link', { name: c.text }))
          .or(page.getByText(c.text))
          .first();
        return safeClick(ctx, loc, `"${c.text}"`, timeout);
      }
      throw new StepError('click needs a selector or text');
    }
    return safeClick(ctx, locate(page, c), selectorLabel(c), timeout);
  }

  if ('fill' in step) {
    const loc = locate(page, step.fill.selector);
    await waitVisible(loc, selectorLabel(step.fill.selector), timeout);
    await loc.fill(String(step.fill.value), { timeout });
    return;
  }

  if ('select' in step) {
    const loc = locate(page, step.select.selector);
    await waitVisible(loc, selectorLabel(step.select.selector), timeout);
    await loc.selectOption(String(step.select.value), { timeout });
    return;
  }

  if ('check' in step) {
    const loc = locate(page, step.check);
    await waitVisible(loc, selectorLabel(step.check), timeout);
    await loc.check({ timeout });
    return;
  }

  if ('press' in step) {
    const key = step.press.key;
    const submits = SUBMIT_KEYS.test(key.split('+').pop() ?? key);
    if (step.press.selector) {
      const loc = locate(page, step.press.selector);
      await waitVisible(loc, selectorLabel(step.press.selector), timeout);
      if (ctx.safeMode && submits) {
        const danger = await dangerOf(loc, true);
        if (danger) throw new SafetyError(`pressing ${key} (it would submit ${danger})`);
      }
      await loc.press(key, { timeout });
    } else {
      if (ctx.safeMode && submits) {
        // The focused element, even when it lives inside a web component's shadow DOM.
        const danger = await page
          .evaluate(() => (window as GuardWindow).__journeyguardGuard?.checkActive() ?? null)
          .catch(() => null);
        if (danger) throw new SafetyError(`pressing ${key} (it would submit ${danger})`);
      }
      await page.keyboard.press(key);
    }
    if (ctx.safeMode) await assertNotBlocked(page);
    return;
  }

  if ('expectVisible' in step) {
    return waitVisible(locate(page, step.expectVisible), selectorLabel(step.expectVisible), timeout);
  }

  if ('expectHidden' in step) {
    try {
      await locate(page, step.expectHidden).waitFor({ state: 'hidden', timeout });
    } catch {
      throw new StepError(`Element is still visible: ${selectorLabel(step.expectHidden)}`);
    }
    return;
  }

  if ('expectText' in step) {
    const t = step.expectText;
    if (typeof t === 'string') {
      try {
        await page.getByText(t).first().waitFor({ state: 'visible', timeout });
      } catch {
        throw new StepError(`Text "${t}" did not appear within ${formatDuration(timeout)}`);
      }
      return;
    }
    const loc = locate(page, t.selector).filter({ hasText: t.text });
    try {
      await loc.first().waitFor({ state: 'visible', timeout });
    } catch {
      throw new StepError(`Text "${t.text}" did not appear in ${selectorLabel(t.selector)}`);
    }
    return;
  }

  if ('expectNoText' in step) {
    const body = (await page.locator('body').innerText({ timeout }).catch(() => '')).toLowerCase();
    if (body.includes(step.expectNoText.toLowerCase())) {
      throw new StepError(`Unexpected text on page: "${step.expectNoText}"`);
    }
    return;
  }

  if ('expectUrl' in step) {
    const pattern = step.expectUrl;
    const re = /^\/(.+)\/([gimsuy]*)$/.exec(pattern);
    const matcher = re ? new RegExp(re[1]!, re[2]) : null;
    try {
      await page.waitForURL((u) => (matcher ? matcher.test(u.toString()) : u.toString().includes(pattern)), {
        timeout,
        waitUntil: 'commit',
      });
    } catch {
      throw new StepError(`URL ${page.url()} does not match ${pattern}`);
    }
    return;
  }

  if ('waitFor' in step) {
    if (typeof step.waitFor === 'number') {
      await page.waitForTimeout(Math.min(step.waitFor, timeout));
      return;
    }
    return waitVisible(locate(page, step.waitFor), selectorLabel(step.waitFor), timeout);
  }

  if ('screenshot' in step) {
    await ctx.screenshot(step.screenshot);
    return;
  }

  throw new StepError(`Unknown step: ${JSON.stringify(step)}`);
}
