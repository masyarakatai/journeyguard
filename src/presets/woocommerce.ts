import type { StepContext } from '../types.js';
import { gotoUrl, locate, NotTestedError, safeClick, StepError } from '../steps.js';
import { resolveUrl } from '../util.js';
import { detectGateways, hrefOf, noFatalErrors, pageText, plain, pollJson, recordLoadTime } from './common.js';
import { label, optBool, optStr, optStrings, type PresetBuilder } from './options.js';

interface StoreProduct {
  name: string;
  permalink: string;
  type: string;
  is_purchasable?: boolean;
  is_in_stock?: boolean;
  prices?: { price?: string };
}

const PRODUCT_LINKS = [
  'ul.products li.product a.woocommerce-LoopProduct-link',
  '.wc-block-grid__product a',
  '.wc-block-product a',
  'ul.products li.product a[href]',
];
const ADD_TO_CART = [
  'form.cart button.single_add_to_cart_button',
  'button.single_add_to_cart_button',
  'button[name="add-to-cart"]',
  '.wc-block-components-product-add-to-cart-button',
];
const CART_LINKS = ['.woocommerce-message a.wc-forward', 'a.added_to_cart', 'a.wc-forward', 'a.cart-contents'];
const CART_ITEMS = ['.woocommerce-cart-form .cart_item', 'tr.cart_item', '.wc-block-cart-items__row', '.wc-block-cart-item'];
const CHECKOUT_LINKS = ['a.checkout-button', '.wc-proceed-to-checkout a', 'a.wc-block-cart__submit-button', '.wc-block-cart__submit-container a'];
const CHECKOUT_FORM = ['form.woocommerce-checkout', 'form.checkout', '.wc-block-checkout'];
const EMAIL_FIELD = ['#billing_email', '.wc-block-checkout #email', 'form.checkout input[type="email"]'];
const PAYMENT_METHODS = ['#payment .wc_payment_methods', '.wc-block-checkout__payment-method', '#payment'];
/** One entry per gateway: classic list items, block radio options, or a single block method's own fields. */
const PAYMENT_METHOD_ITEMS = [
  '#payment li.wc_payment_method',
  '.wc-block-checkout__payment-method input[type=radio]',
  '.wc-block-checkout__payment-method .wc-block-components-radio-control-accordion-option',
  '.wc-block-checkout__payment-method .wc-block-components-payment-method-label',
  '.wc-block-checkout__payment-method iframe',
].join(', ');
const PLACE_ORDER = ['#place_order', '.wc-block-components-checkout-place-order-button'];
const EMPTY_CART = ['.cart-empty', '.wc-empty-cart-message', '.wc-block-cart__empty-cart__title', '.wc-block-checkout-empty', '.wc-block-checkout-empty__title'];

async function findProductUrl(ctx: StepContext, shopPath: string): Promise<string> {
  // 1) The WooCommerce Store API lists products without depending on the theme's markup.
  const api = resolveUrl(ctx.baseUrl, '/wp-json/wc/store/v1/products?per_page=20');
  const res = await ctx.page.request.get(api, { failOnStatusCode: false, timeout: ctx.timeoutMs, headers: ctx.siteHeaders }).catch(() => undefined);
  if (res?.ok()) {
    const list = (await res.json().catch(() => [])) as StoreProduct[];
    if (Array.isArray(list)) {
      const buyable = list.filter((p) => p.is_purchasable !== false && p.is_in_stock !== false);
      // A free product skips payment at checkout, so prefer one with a price.
      const paid = (p: StoreProduct) => Number(p.prices?.price ?? 1) > 0;
      const pick =
        buyable.find((p) => p.type === 'simple' && paid(p)) ??
        buyable.find((p) => p.type === 'variable' && paid(p)) ??
        buyable.find((p) => p.type === 'simple') ??
        buyable.find((p) => p.type === 'variable');
      if (pick) {
        ctx.info.product = pick.name;
        return pick.permalink;
      }
      if (list.length > 0) throw new StepError('No product is in stock and purchasable');
    }
  }
  // 2) Fall back to the shop page and the first product link.
  await gotoUrl(ctx, shopPath, ctx.timeoutMs);
  const link = locate(ctx.page, PRODUCT_LINKS);
  try {
    await link.waitFor({ state: 'attached', timeout: ctx.timeoutMs });
  } catch {
    throw new StepError(`No products found on ${shopPath}`);
  }
  const href = await link.getAttribute('href');
  if (!href) throw new StepError('Product link has no address');
  return new URL(href, ctx.page.url()).toString();
}

/**
 * Variable products: pick a variation that can actually be bought, using the data WooCommerce prints
 * on the form, and set the attribute selects directly (swatch plugins hide them, so a normal
 * selectOption would wait forever).
 */
async function chooseVariations(ctx: StepContext): Promise<void> {
  const form = ctx.page.locator('form.variations_form').first();
  if ((await form.count()) === 0) return;
  const result = await form.evaluate((el) => {
    type Variation = { attributes: Record<string, string>; is_in_stock?: boolean; is_purchasable?: boolean; variation_is_active?: boolean; variation_is_visible?: boolean };
    let variations: Variation[] | false = false;
    try {
      variations = JSON.parse(el.getAttribute('data-product_variations') || 'false') as Variation[] | false;
    } catch {
      variations = false;
    }
    const selects = Array.from(el.querySelectorAll('.variations select')) as HTMLSelectElement[];
    const choose = (attrs: Record<string, string>) => {
      for (const select of selects) {
        const wanted = attrs[select.name];
        const option = Array.from(select.options).find((o) => o.value && !o.disabled && (!wanted || o.value === wanted));
        if (!option) return false;
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    };
    if (Array.isArray(variations)) {
      const buyable = variations.filter((v) => v.is_in_stock !== false && v.is_purchasable !== false && v.variation_is_active !== false && v.variation_is_visible !== false);
      if (!buyable.length) return 'none';
      return choose(buyable[0]!.attributes) ? 'chosen' : 'unmatched';
    }
    // Large products load variations over AJAX: fall back to the first available option of each attribute.
    return choose({}) ? 'guessed' : 'unmatched';
  });
  if (result === 'none') throw new StepError('No product is in stock and purchasable (every variation of the product is sold out)');
  ctx.info.variationSelected = true;
  // WooCommerce enables the button once it has matched the variation.
  await ctx.page
    .locator('.single_add_to_cart_button:not(.disabled):not(.wc-variation-selection-needed)')
    .first()
    .waitFor({ state: 'visible', timeout: ctx.timeoutMs })
    .catch(() => {
      // Without the variation list, the first options may simply be a sold-out combination.
      if (result !== 'chosen') {
        throw new NotTestedError(
          'This product loads its options on demand, so JourneyGuard could not tell which combination is in stock. Set productUrl to a simple product or one with fewer options.',
        );
      }
      throw new StepError('The product options could not be selected: the add-to-cart button stayed disabled');
    });
}

/**
 * Where is the cart? Already on it (shops set to "redirect to the cart after adding"), the URL
 * WooCommerce publishes in wc_add_to_cart_params, a cart link that is not "continue shopping",
 * or the default /cart/.
 */
async function findCartUrl(ctx: StepContext): Promise<string> {
  if (await locate(ctx.page, CART_ITEMS).isVisible().catch(() => false)) return ctx.page.url();
  // Classic themes publish wc_add_to_cart_params.cart_url; block themes publish wcSettings.storePages.
  const fromParams = await ctx.page
    .evaluate(() => {
      const w = window as unknown as {
        wc_add_to_cart_params?: { cart_url?: string };
        wcSettings?: { storePages?: { cart?: { permalink?: string } } };
      };
      return w.wc_add_to_cart_params?.cart_url || w.wcSettings?.storePages?.cart?.permalink || undefined;
    })
    .catch(() => undefined);
  if (fromParams) return new URL(fromParams, ctx.page.url()).toString();
  const avoid = new Set([String(ctx.info.productUrl ?? ''), resolveUrl(ctx.baseUrl, '/shop/'), ctx.page.url()].map((u) => u.replace(/[?#].*$/, '')));
  for (const sel of CART_LINKS) {
    const href = await hrefOf(ctx, [sel]);
    if (href && !avoid.has(href.replace(/[?#].*$/, ''))) return href;
  }
  return resolveUrl(ctx.baseUrl, '/cart/');
}

export const woocommercePreset: PresetBuilder = (options, { lang }) => {
  const shopPath = optStr(options, 'shopPath') ?? '/shop/';
  const productUrl = optStr(options, 'productUrl');
  const cartPath = optStr(options, 'cartPath');
  const checkoutPath = optStr(options, 'checkoutPath');
  // Methods that must stay on offer, e.g. [Viva, Κάρτα]: most local shops also offer cash on
  // delivery, so "at least one method" would never notice a dead card gateway.
  const expectPayments = optStrings(options, 'expectPayments');

  return {
    name: label(lang, 'wooJourney'),
    stages: [
      {
        name: label(lang, 'website'),
        steps: [{ name: 'Homepage opens', goto: '/' }, noFatalErrors(), recordLoadTime('homepageLoadMs')],
      },
      {
        name: label(lang, 'products'),
        steps: [
          {
            name: 'Find a product in stock',
            custom: async (ctx) => {
              ctx.info.productUrl = productUrl ? resolveUrl(ctx.baseUrl, productUrl) : await findProductUrl(ctx, shopPath);
            },
          },
          { name: 'Product page opens', custom: (ctx) => gotoUrl(ctx, String(ctx.info.productUrl), ctx.timeoutMs) },
          noFatalErrors(),
          { name: 'Add-to-cart button visible', expectVisible: ADD_TO_CART },
        ],
      },
      {
        name: label(lang, 'addToCart'),
        steps: [
          { name: 'Choose product options', custom: chooseVariations },
          {
            name: 'Click add to cart',
            custom: async (ctx) => {
              await safeClick(ctx, locate(ctx.page, ADD_TO_CART), 'add to cart button', ctx.timeoutMs);
              await ctx.page.waitForLoadState('load', { timeout: ctx.timeoutMs }).catch(() => undefined);
            },
          },
          {
            name: 'Cart contains the product',
            custom: async (ctx) => {
              const api = resolveUrl(ctx.baseUrl, '/wp-json/wc/store/v1/cart');
              const result = await pollJson(ctx, api, (b) => Number((b as { items_count?: number })?.items_count) > 0, ctx.timeoutMs);
              if (result && result.status !== 404 && result.status < 400) {
                const cart = result.body as { items_count?: number; needs_payment?: boolean };
                const count = Number(cart?.items_count ?? 0);
                if (count < 1) throw new StepError('Clicked "add to cart" but the cart is still empty');
                ctx.info.cartItems = count;
                if (cart.needs_payment === false) ctx.info.freeOrder = true;
                return;
              }
              // Store API disabled: rely on the theme's success notice instead.
              const notice = locate(ctx.page, ['.woocommerce-message', 'a.added_to_cart', '.wc-block-components-notice-banner.is-success']);
              try {
                await notice.waitFor({ state: 'visible', timeout: ctx.timeoutMs });
              } catch {
                throw new StepError('No confirmation that the product was added to the cart');
              }
            },
          },
          {
            name: 'Cart page lists the product',
            custom: async (ctx) => {
              const cartUrl = cartPath ? resolveUrl(ctx.baseUrl, cartPath) : await findCartUrl(ctx);
              ctx.info.cartUrl = cartUrl;
              if (cartUrl !== ctx.page.url()) await gotoUrl(ctx, cartUrl, ctx.timeoutMs);
            },
          },
          noFatalErrors(),
          { name: 'Cart items visible', expectVisible: CART_ITEMS },
        ],
      },
      {
        name: label(lang, 'checkout'),
        steps: [
          {
            name: 'Checkout page opens',
            custom: async (ctx) => {
              const url = checkoutPath
                ? resolveUrl(ctx.baseUrl, checkoutPath)
                : ((await hrefOf(ctx, CHECKOUT_LINKS)) ?? resolveUrl(ctx.baseUrl, '/checkout/'));
              await gotoUrl(ctx, url, ctx.timeoutMs);
              // The block checkout renders asynchronously: wait for the form or the empty-cart state.
              const outcome = await Promise.race([
                locate(ctx.page, EMAIL_FIELD).waitFor({ state: 'visible', timeout: ctx.timeoutMs }).then(() => 'form', () => 'unknown'),
                locate(ctx.page, EMPTY_CART).waitFor({ state: 'visible', timeout: ctx.timeoutMs }).then(() => 'empty', () => 'unknown'),
              ]);
              if (outcome === 'empty') {
                throw new StepError('Checkout sent us back to an empty cart: the cart session was lost (often page caching on cart/checkout or a cookie problem)');
              }
            },
          },
          noFatalErrors(),
          { name: 'Checkout form visible', expectVisible: CHECKOUT_FORM },
          { name: 'Billing email field visible', expectVisible: EMAIL_FIELD },
        ],
      },
      optBool(options, 'payment', true)
        ? {
            name: label(lang, 'payment'),
            steps: [
              {
                name: 'Payment methods offered',
                custom: async (ctx) => {
                  // WooCommerce hides payment for a zero total, so an empty list there is expected.
                  if (ctx.info.freeOrder) {
                    throw new NotTestedError('The cart total is zero, so checkout asks for no payment. Set productUrl to a paid product to check the payment methods.');
                  }
                  const box = locate(ctx.page, PAYMENT_METHODS);
                  try {
                    await box.waitFor({ state: 'visible', timeout: ctx.timeoutMs });
                  } catch {
                    throw new StepError('Payment methods section did not appear on checkout');
                  }
                  // Classic and block checkouts both render a notice when no gateway is usable.
                  const text = await pageText(ctx);
                  if (
                    (await ctx.page.locator('.wc-block-checkout__no-payment-methods-notice').isVisible().catch(() => false)) ||
                    /no (available )?payment methods( available)?|δεν υπάρχουν διαθέσιμοι τρόποι πληρωμής/i.test(text)
                  ) {
                    throw new StepError('Checkout says there are no available payment methods');
                  }
                  // Block checkouts load payment methods asynchronously: give them the step timeout.
                  const deadline = Date.now() + ctx.timeoutMs;
                  // Count real methods only: the block's heading and loading placeholders are not one.
                  let methods = 0;
                  while (Date.now() < deadline) {
                    if (await ctx.page.locator('.wc-block-checkout__no-payment-methods-notice').isVisible().catch(() => false)) {
                      throw new StepError('Checkout says there are no available payment methods');
                    }
                    methods = await ctx.page.locator(PAYMENT_METHOD_ITEMS).count();
                    // A checkout offering only express payments (Apple Pay, Google Pay, PayPal buttons) is fine too.
                    if (methods === 0 && (await ctx.page.locator('.wc-block-components-express-payment').isVisible().catch(() => false))) methods = 1;
                    if (methods > 0) break;
                    await ctx.page.waitForTimeout(400);
                  }
                  if (methods === 0) throw new StepError('Checkout shows no payment method to choose');
                  const labels = await ctx.page
                    .locator('#payment .wc_payment_methods li label, .wc-block-checkout__payment-method .wc-block-components-radio-control__label')
                    .allInnerTexts()
                    .catch(() => []);
                  if (labels.length) ctx.info.paymentMethods = labels.map((l) => l.trim()).filter(Boolean).join(', ');
                  const gateways = await detectGateways(ctx);
                  if (gateways.length) ctx.info.gateways = gateways.join(', ');
                  if (expectPayments.length) {
                    const offered = plain(`${labels.join(' ')} ${gateways.join(' ')}`);
                    const missing = expectPayments.filter((m) => !offered.includes(plain(m)));
                    if (missing.length) {
                      throw new StepError(
                        `Expected payment method is missing: ${missing.join(', ')} (offered: ${String(ctx.info.paymentMethods ?? 'none')})`,
                      );
                    }
                  }
                },
              },
              { name: 'Place-order button present (not clicked)', expectVisible: PLACE_ORDER },
            ],
          }
        : { name: label(lang, 'payment'), steps: [], notTestedReason: label(lang, 'paymentDisabled') },
      { name: label(lang, 'placeOrder'), steps: [], notTestedReason: label(lang, 'safeMode') },
    ],
  };
};
