/**
 * Safe mode: JourneyGuard must never place a real order or charge a card by accident.
 *
 * Two layers:
 * 1. Before a click, the step layer asks the page whether the target is an order/payment control
 *    and refuses with a clear message.
 * 2. A guard installed in every frame (context.addInitScript) intercepts clicks, form submissions
 *    and programmatic submit() calls at the moment they happen. This also catches pressing Enter
 *    in a checkout field (implicit submission), buttons whose label changes while waiting, and
 *    clicks on a child <span> or icon inside a pay button.
 *
 * The matching logic below is written as self-contained functions so the exact same code runs in
 * Node (unit tests) and in the page (via Function.prototype.toString).
 */

export interface ClickTarget {
  tag: string;
  type: string;
  role: string;
  /** Every label source of the control: innerText, textContent, value, aria-label, title, alt… */
  texts: string[];
  id: string;
  name: string;
  className: string;
  /** id of the element actually clicked when it differs from the control (e.g. a span in a button). */
  innerId: string;
  /**
   * Anything that can trigger an action. Only choice and text-entry controls (radios, checkboxes,
   * selects, text fields and their labels) are excluded: they select an option, they never submit.
   */
  submitCapable: boolean;
}

export interface PatternSet {
  ids: string[];
  classes: string[];
  text: string[];
}

/** Regex sources. Text patterns are matched against normalised labels: lowercase, no accents, ς→σ. */
export const PATTERNS: PatternSet = {
  ids: ['^place_order$', '^checkout-pay-button$', '^submit-order$', '^complete-order$', '^button-confirm$'],
  classes: ['wc-block-components-checkout-place-order-button', '(^|\\s)place-order(\\s|$)'],
  text: [
    '\\bplace (?:my |your |the )?order\\b',
    '\\bcomplete (?:my |your |the )?(?:order|purchase|payment|checkout)\\b',
    '\\bsubmit (?:my |your |the )?(?:order|payment)\\b',
    '\\bconfirm (?:my |your |the )?(?:order|purchase|payment)\\b',
    '\\bconfirm (?:and |& )?pay\\b',
    '\\bpay now\\b',
    '\\bpay for (?:this |your |the )?order\\b',
    '\\bobligation to pay\\b',
    '^pay$',
    '^pay\\s+(?:with\\s+\\S+\\s+)?(?:[€$£]|eur\\b|usd\\b|gbp\\b)?\\s?\\d',
    'ολοκληρωση (?:τησ )?(?:παραγγελιασ|αγορασ|πληρωμησ)',
    'υποβολη (?:τησ )?παραγγελιασ',
    'επιβεβαιωση (?:τησ )?(?:παραγγελιασ|αγορασ|πληρωμησ)',
    'καταχωρηση (?:τησ )?παραγγελιασ',
    'πληρωμη τωρα',
    'υποχρεωση πληρωμησ',
    '^πληρωμη$',
    '^πληρωστε(?:\\s|$)',
    '^πληρωμη\\s+(?:[€$£]|eur\\b)?\\s?\\d',
  ],
};

/** Lowercase, strip accents/diacritics, unify final sigma, collapse whitespace. */
export function normalizeLabel(s: string): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ς/g, 'σ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Returns a description of why the target is an order/payment control, or undefined if it is safe. */
export function classifyTarget(t: ClickTarget, P: PatternSet, norm: (s: string) => string): string | undefined {
  const test = (src: string, value: string) => !!value && new RegExp(src, 'i').test(value);
  for (const src of P.ids) {
    if (test(src, t.id) || test(src, t.name) || test(src, t.innerId)) return `element #${t.id || t.name || t.innerId}`;
  }
  for (const src of P.classes) {
    if (test(src, t.className)) return `element .${t.className.trim().split(/\s+/)[0]}`;
  }
  if (!t.submitCapable) return undefined;
  for (const raw of t.texts) {
    // The decisive words sit at the start of a button label; long labels add prices or legal text.
    const label = norm(raw).slice(0, 120);
    if (!label) continue;
    for (const src of P.text) {
      if (new RegExp(src, 'i').test(label)) return `button "${raw.replace(/\s+/g, ' ').trim().slice(0, 60)}"`;
    }
  }
  return undefined;
}

export function isDangerousTarget(t: ClickTarget): string | undefined {
  return classifyTarget(t, PATTERNS, normalizeLabel);
}

/** Can this element trigger an action? Runs in the page. */
export function isActionable(ctl: Element, tag: string, type: string, role: string): boolean {
  // Choice and text-entry controls only select or type: never an order.
  if (['select', 'option', 'textarea', 'label'].includes(tag)) return false;
  if (['radio', 'checkbox', 'menuitemradio', 'menuitemcheckbox', 'option', 'textbox'].includes(role)) return false;
  if (tag === 'input') return ['submit', 'image', 'button'].includes(type);
  if (tag === 'button' || tag === 'a' || role === 'button' || role === 'link' || role === 'menuitem' || tag.includes('-')) return true;
  if (ctl.hasAttribute('onclick') || ctl.hasAttribute('tabindex')) return true;
  // A plain div or span counts only when it looks clickable (React-style buttons), not a container.
  return getComputedStyle(ctl).cursor === 'pointer';
}

/** Reads the effective control behind a clicked element. Runs in the page. */
export function describeElement(input: unknown): ClickTarget | undefined {
  let el = input as Element | null;
  if (el && el.nodeType !== 1) el = (el as Node).parentElement;
  if (!el || !el.closest) return undefined;
  let ctl: Element | null = el.closest(
    'button, a, input[type=submit], input[type=image], input[type=button], [role=button], [role=link], [role=menuitem], [onclick]',
  );
  if (!ctl) {
    const label = el.closest('label') as HTMLLabelElement | null;
    if (label && label.control) ctl = label.control;
  }
  if (!ctl) {
    // Web components (Ionic, Shoelace, Lit…) render their buttons as custom elements.
    for (let node: Element | null = el, depth = 0; node && depth < 4; node = node.parentElement, depth++) {
      if (node.tagName.includes('-')) {
        ctl = node;
        break;
      }
    }
  }
  if (!ctl) ctl = el;
  const tag = ctl.tagName.toLowerCase();
  const type = (ctl.getAttribute('type') || '').toLowerCase();
  const role = (ctl.getAttribute('role') || '').toLowerCase();
  const labelledBy = (ctl.getAttribute('aria-labelledby') || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent || '')
    .join(' ');
  const alts = Array.from(ctl.querySelectorAll('img[alt]')).map((img) => (img as HTMLImageElement).alt);
  const html = ctl as HTMLElement & { value?: string };
  const texts = [
    html.innerText,
    html.textContent,
    typeof html.value === 'string' ? html.value : '',
    ctl.getAttribute('aria-label'),
    ctl.getAttribute('title'),
    ctl.getAttribute('alt'),
    labelledBy,
    ...alts,
  ].filter((x): x is string => !!x && !!x.trim());
  return {
    tag,
    type,
    role,
    texts,
    id: ctl.id || '',
    name: ctl.getAttribute('name') || '',
    className: typeof (ctl as HTMLElement).className === 'string' ? (ctl as HTMLElement).className : '',
    innerId: el !== ctl ? el.id || '' : '',
    submitCapable: isActionable(ctl, tag, type, role),
  };
}

/**
 * Script installed in every frame while safe mode is on. Exposes window.__journeyguardGuard with
 * check(el), checkEnter(el) and a list of blocked actions the runner reads after each step.
 */
export function guardScript(): string {
  return `(() => {
  if (window.__journeyguardGuard) return;
  const P = ${JSON.stringify(PATTERNS)};
  const norm = ${normalizeLabel.toString()};
  const classify = ${classifyTarget.toString()};
  const isActionable = ${isActionable.toString()};
  const describe = ${describeElement.toString()};
  const blocked = [];
  const check = (el) => { try { const t = describe(el); return t ? classify(t, P, norm) : undefined; } catch (e) { return undefined; } };
  const formDanger = (form) => {
    if (!form || !form.querySelectorAll) return undefined;
    for (const c of form.querySelectorAll('button, input[type=submit], input[type=image], [role=button]')) { const w = check(c); if (w) return w; }
    return undefined;
  };
  const checkEnter = (el) => {
    if (!el) return undefined;
    const own = check(el);
    if (own) return own;
    const form = el.form || (el.closest && el.closest('form'));
    return formDanger(form);
  };
  const block = (e, why) => { e.preventDefault(); e.stopImmediatePropagation(); blocked.push(why); };
  // Inside shadow DOM the event target is retargeted to the host: use the real innermost element.
  const realTarget = (e) => (e.composedPath && e.composedPath()[0]) || e.target;
  const deepActive = () => { let a = document.activeElement; while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement; return a; };
  const onClick = (e) => { const why = check(realTarget(e)); if (why) block(e, why); };
  const onSubmit = (e) => {
    const why = (e.submitter && check(e.submitter)) || formDanger(e.target);
    if (why) block(e, why);
  };
  const arm = () => { window.addEventListener('click', onClick, true); window.addEventListener('submit', onSubmit, true); };
  arm();
  // document.open() wipes listeners; put ours straight back.
  const open = Document.prototype.open;
  Document.prototype.open = function (...args) { const r = open.apply(this, args); arm(); return r; };
  for (const name of ['submit', 'requestSubmit']) {
    const original = HTMLFormElement.prototype[name];
    if (typeof original !== 'function') continue;
    HTMLFormElement.prototype[name] = function (...args) {
      const why = (args[0] && check(args[0])) || formDanger(this);
      if (why) { blocked.push(why); return undefined; }
      return original.apply(this, args);
    };
  }
  const checkActive = () => checkEnter(deepActive());
  Object.defineProperty(window, '__journeyguardGuard', { value: { blocked, check, checkEnter, checkActive }, enumerable: false });
})();`;
}

/**
 * Network backstop: requests that complete an order or charge a card on common platforms.
 * Matched against "METHOD URL BODY" for every non-GET request while safe mode is on, so even a
 * button with an innocent label ("Continue") cannot place an order.
 */
const ORDER_REQUESTS: { pattern: RegExp; label: string }[] = [
  { pattern: /[?&]wc-ajax=checkout\b/i, label: 'WooCommerce checkout' },
  { pattern: /\/wp-json\/wc\/store(?:\/v\d+)?\/checkout\b/i, label: 'WooCommerce checkout' },
  { pattern: /[?&]rest_route=\/wc\/store(?:\/v\d+)?\/checkout\b/i, label: 'WooCommerce checkout' },
  { pattern: /admin-ajax\.php.*(?:^|[\s&])action=woocommerce_checkout\b/is, label: 'WooCommerce checkout' },
  { pattern: /SubmitForCompletion|SubmitForReceipt/, label: 'Shopify checkout' },
  { pattern: /\/checkouts\/[^?\s]*\/(?:processing|complete)\b/i, label: 'Shopify checkout' },
  { pattern: /[?&]route=checkout\/confirm/i, label: 'OpenCart checkout' },
  { pattern: /[?&]route=extension\/(?:opencart\/)?payment\/[^&\s]*[./]confirm/i, label: 'OpenCart payment' },
  { pattern: /\/module\/[^/\s]+\/validation\b|[?&]controller=validation\b/i, label: 'PrestaShop payment' },
  { pattern: /\/V1\/(?:guest-carts|carts)\/[^/\s]+\/payment-information\b/i, label: 'Magento order' },
  { pattern: /api\.stripe\.com\/v1\/payment_intents\/[^/\s]+\/confirm\b/i, label: 'Stripe payment' },
  { pattern: /paypal\.com\/v\d\/checkout\/orders\/[^/\s]+\/(?:capture|authorize)\b/i, label: 'PayPal payment' },
];

export function orderRequestReason(method: string, url: string, body = ''): string | undefined {
  if (/^(GET|HEAD|OPTIONS)$/i.test(method)) return undefined;
  const subject = `${method} ${url} ${body.slice(0, 4_000)}`;
  return ORDER_REQUESTS.find((r) => r.pattern.test(subject))?.label;
}

export class SafetyError extends Error {
  constructor(what: string) {
    super(
      `Safe mode blocked ${what}: it looks like it would place a real order or take a payment. ` +
        'JourneyGuard stops at the payment step by default. Use a store in payment test mode and set settings.safeMode: false to go further.',
    );
    this.name = 'SafetyError';
  }
}
