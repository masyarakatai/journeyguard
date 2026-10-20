import { gotoUrl, locate, NotTestedError, safeClick, StepError } from '../steps.js';
import { resolveUrl } from '../util.js';
import { detectGateways, noFatalErrors, pageText, pollJson, recordLoadTime } from './common.js';
import { label, optBool, optStr, type PresetBuilder } from './options.js';

interface ShopifyProduct {
  title: string;
  handle: string;
  variants: { id: number; available?: boolean }[];
}

const PRODUCT_FORM = ['form[action*="/cart/add"]', 'product-form form'];
const ADD_TO_CART = ['form[action*="/cart/add"] button[type="submit"]', 'form[action*="/cart/add"] [name="add"]', 'button[name="add"]'];
const EMAIL_FIELD = ['input#email', 'input[name="email"]', 'input[autocomplete="email"]', 'input[type="email"]'];
const PAYMENT_SECTION = [
  'iframe.card-fields-iframe',
  'iframe[src*="checkout.pci.shopifyinc.com"]',
  '[data-payment-subform]',
  'section[aria-label="Payment"]',
  '#payment-method',
  'div[role="radiogroup"][aria-label*="payment" i]',
];

export const shopifyPreset: PresetBuilder = (options, { lang }) => {
  const handleOption = optStr(options, 'productHandle');

  return {
    name: label(lang, 'shopifyJourney'),
    stages: [
      {
        name: label(lang, 'website'),
        steps: [
          { name: 'Storefront opens', goto: '/' },
          {
            name: 'Store is open to the public',
            custom: async (ctx) => {
              if (new URL(ctx.page.url()).pathname.startsWith('/password')) {
                throw new StepError('The store is password-protected, so customers cannot see it');
              }
            },
          },
          noFatalErrors(),
          recordLoadTime('homepageLoadMs'),
        ],
      },
      {
        name: label(lang, 'products'),
        steps: [
          {
            name: 'Find a product in stock',
            custom: async (ctx) => {
              let handle = handleOption;
              if (!handle) {
                const res = await ctx.page.request.get(resolveUrl(ctx.baseUrl, '/products.json?limit=50'), {
                  failOnStatusCode: false,
                  timeout: ctx.timeoutMs,
                  headers: ctx.siteHeaders,
                });
                if (!res.ok()) throw new StepError(`Could not list products (/products.json returned HTTP ${res.status()})`);
                const { products = [] } = (await res.json().catch(() => ({}))) as { products?: ShopifyProduct[] };
                const pick = products.find((p) => p.variants?.some((v) => v.available !== false));
                if (!pick) throw new StepError(products.length ? 'No product is available for sale' : 'The store has no published products');
                handle = pick.handle;
                ctx.info.product = pick.title;
              }
              ctx.info.productUrl = resolveUrl(ctx.baseUrl, `/products/${handle}`);
              await gotoUrl(ctx, String(ctx.info.productUrl), ctx.timeoutMs);
            },
          },
          noFatalErrors(),
          { name: 'Product form visible', expectVisible: PRODUCT_FORM },
        ],
      },
      {
        name: label(lang, 'addToCart'),
        steps: [
          { name: 'Click add to cart', custom: (ctx) => safeClick(ctx, locate(ctx.page, ADD_TO_CART), 'add to cart button', ctx.timeoutMs) },
          {
            name: 'Cart contains the product',
            custom: async (ctx) => {
              const result = await pollJson(
                ctx,
                resolveUrl(ctx.baseUrl, '/cart.js'),
                (b) => Number((b as { item_count?: number })?.item_count) > 0,
                ctx.timeoutMs,
              );
              const count = Number((result?.body as { item_count?: number })?.item_count ?? 0);
              if (count < 1) throw new StepError('Clicked "add to cart" but the cart is still empty');
              ctx.info.cartItems = count;
            },
          },
        ],
      },
      {
        name: label(lang, 'checkout'),
        steps: [
          { name: 'Checkout opens', goto: '/checkout' },
          {
            name: 'Not blocked by a bot challenge',
            custom: async (ctx) => {
              const url = ctx.page.url();
              const text = await pageText(ctx);
              if (/\/challenge|\/checkpoint/.test(url) || /verify (that )?you are (a )?human/i.test(text)) {
                throw new NotTestedError('Shopify showed a bot challenge on checkout; the monitor could not continue');
              }
              if (!/\/checkouts?\//.test(url)) throw new StepError(`Expected the checkout, but landed on ${url}`);
            },
          },
          { name: 'Contact email field visible', expectVisible: EMAIL_FIELD },
        ],
      },
      optBool(options, 'payment', true)
        ? {
            name: label(lang, 'payment'),
            steps: [
              {
                name: 'Payment section visible',
                // Shopify's checkout markup changes often, so a miss is a warning, not an outage.
                optional: true,
                custom: async (ctx) => {
                  try {
                    await locate(ctx.page, PAYMENT_SECTION).waitFor({ state: 'visible', timeout: ctx.timeoutMs });
                  } catch {
                    throw new StepError('Payment section not detected; please confirm manually');
                  }
                  const gateways = await detectGateways(ctx);
                  if (gateways.length) ctx.info.gateways = gateways.join(', ');
                },
              },
            ],
          }
        : { name: label(lang, 'payment'), steps: [], notTestedReason: label(lang, 'paymentDisabled') },
      { name: label(lang, 'placeOrder'), steps: [], notTestedReason: label(lang, 'safeMode') },
    ],
  };
};
