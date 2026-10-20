import type { Page } from 'playwright';

/**
 * Cookie-consent banners and newsletter pop-ups cover "add to cart" and "send" on many shops. A
 * customer closes them in a second; the monitor has to do the same or every click times out.
 * Consent is always refused ("necessary only"), so the monitor never switches on tracking.
 */
const CONSENT_REJECT = [
  '#CybotCookiebotDialogBodyButtonDecline',
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll',
  '#onetrust-reject-all-handler',
  '.cky-btn-reject',
  '.cmplz-btn.cmplz-deny',
  '#cookie_action_close_header_reject',
  '.cli_action_button[data-cli_action="reject"]',
  '#cn-refuse-cookie',
  '.moove-gdpr-infobar-reject-btn',
  '.iubenda-cs-reject-btn',
  '#didomi-notice-disagree-button',
  '[data-testid="uc-deny-all-button"]',
  '#shopify-pc__banner__btn-decline',
];
/** Close buttons of common pop-up and newsletter plugins (Popup Maker, Elementor, Klaviyo, Mailchimp, Magnific). */
const POPUP_CLOSE = [
  '.pum-active .pum-close',
  '.elementor-popup-modal .dialog-close-button',
  '.klaviyo-close-form',
  '.mc-closeModal',
  '.mfp-ready .mfp-close',
  '.sgpb-popup-close-button-1',
];

/**
 * Looks for one thing to dismiss: a known reject or close button, or, inside an element that is
 * clearly a cookie banner, a button labelled "reject" / "necessary only" in English or Greek.
 * Marks it so Playwright can click it like a person would.
 */
function findDismissible(selectors: string[]): string | null {
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none' && st.opacity !== '0';
  };
  document.querySelectorAll('[data-journeyguard-dismiss]').forEach((el) => el.removeAttribute('data-journeyguard-dismiss'));
  const mark = (el: Element, why: string) => {
    el.setAttribute('data-journeyguard-dismiss', '');
    return why;
  };
  for (const sel of selectors) {
    const el = Array.from(document.querySelectorAll(sel)).find(visible);
    if (el) return mark(el, sel);
  }
  const plain = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/ς/g, 'σ').replace(/\s+/g, ' ').trim();
  const REJECT =
    /^(?:reject(?: all)?(?: cookies)?|decline(?: all)?|deny(?: all)?|refuse(?: all)?|only (?:necessary|essential|required)(?: cookies)?|(?:necessary|essential|required) (?:cookies )?only|use (?:only )?necessary cookies(?: only)?|continue without accepting|απορριψη(?: ολων)?|απορριπτω|μονο (?:τα )?(?:απαραιτητα|αναγκαια|βασικα)(?: cookies)?|συνεχεια χωρισ αποδοχη)$/;
  const banners = Array.from(document.querySelectorAll('[id*=cookie i], [class*=cookie i], [id*=consent i], [class*=consent i], [id*=gdpr i], [class*=gdpr i], [aria-label*=cookie i]')).filter(visible);
  for (const banner of banners) {
    const button = Array.from(banner.querySelectorAll('button, a, [role=button]')).find(
      (b) => visible(b) && REJECT.test(plain((b as HTMLElement).innerText || b.getAttribute('aria-label') || '')),
    );
    if (button) return mark(button, `cookie banner: ${plain((button as HTMLElement).innerText).slice(0, 40)}`);
  }
  return null;
}

/** Closes consent banners and pop-ups that are on screen now. Never throws; returns what it closed. */
export async function dismissOverlays(page: Page, budgetMs = 4_000): Promise<string[]> {
  const closed: string[] = [];
  const deadline = Date.now() + budgetMs;
  // A banner and a pop-up can be stacked, so look again after each click.
  for (let i = 0; i < 3 && Date.now() < deadline; i++) {
    const found = await page.evaluate(findDismissible, [...CONSENT_REJECT, ...POPUP_CLOSE]).catch(() => null);
    if (!found) break;
    const clicked = await page
      .locator('[data-journeyguard-dismiss]')
      .first()
      .click({ timeout: Math.max(500, Math.min(2_000, deadline - Date.now())) })
      .then(() => true)
      .catch(() => false);
    if (!clicked) break;
    closed.push(found);
    await page.waitForTimeout(250);
  }
  return closed;
}
