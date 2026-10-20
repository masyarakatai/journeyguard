import http from 'node:http';

/**
 * A tiny shop that mimics WooCommerce markup, used by `journeyguard demo` and the test suite.
 * Break modes simulate the silent failures JourneyGuard exists to catch.
 */
export const BREAK_MODES = [
  'none',
  'checkout',
  'add-to-cart',
  'payment',
  'cart-session',
  'contact',
  'down',
  'flaky-checkout',
  // Not outages, but situations that must not raise false alarms:
  'redirect-to-cart',
  'contact-spam',
  'contact-invalid',
  'contact-robot',
  'free-order',
  'cookie-banner',
  'firewall',
] as const;
export type BreakMode = (typeof BREAK_MODES)[number];

interface Product {
  id: number;
  slug: string;
  name: string;
  price: string;
  inStock: boolean;
}

const PRODUCTS: Product[] = [
  { id: 11, slug: 'espresso-blend', name: 'Espresso Blend 250g', price: '€8.90', inStock: true },
  { id: 12, slug: 'greek-coffee', name: 'Greek Coffee 200g', price: '€5.40', inStock: true },
  { id: 13, slug: 'ceramic-mug', name: 'Ceramic Mug', price: '€12.00', inStock: true },
];

const STYLE = `
*{box-sizing:border-box}body{margin:0;font:16px/1.5 Georgia,'Times New Roman',serif;color:#2b2118;background:#faf6f0}
header{display:flex;gap:24px;align-items:center;padding:18px 32px;background:#2b2118;color:#faf6f0}
header a{color:#faf6f0;text-decoration:none}header .logo{font-weight:bold;font-size:20px;flex:1}
main{max-width:960px;margin:0 auto;padding:32px}
ul.products{list-style:none;padding:0;display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
li.product{background:#fff;border:1px solid #eadfce;border-radius:10px;padding:16px}
li.product a{color:inherit;text-decoration:none}.thumb{height:120px;border-radius:8px;background:linear-gradient(135deg,#c89f6d,#6f4a2c);margin-bottom:10px}
.price{color:#8a5a2b;font-weight:bold}
button,.button,input[type=submit]{background:#8a5a2b;color:#fff;border:0;border-radius:6px;padding:10px 18px;font:inherit;cursor:pointer;text-decoration:none;display:inline-block}
.woocommerce-message{background:#e7f4e4;border-left:4px solid #3c8a2e;padding:12px 16px;margin-bottom:20px}
table{width:100%;border-collapse:collapse;background:#fff}td,th{padding:10px;border-bottom:1px solid #eadfce;text-align:left}
form.checkout label,.wpcf7 label{display:block;margin:10px 0 4px}form.checkout input,.wpcf7 input[type=text],.wpcf7 input[type=email],.wpcf7 textarea{width:100%;padding:8px;border:1px solid #cdbfa9;border-radius:6px;font:inherit}
#payment{background:#f1e8db;border-radius:8px;padding:16px;margin-top:20px}#payment ul{list-style:none;padding:0}
.wpcf7-response-output{margin-top:14px;padding:10px;border:2px solid transparent}.wpcf7 form.sent .wpcf7-response-output{border-color:#46b450}.wpcf7 form.failed .wpcf7-response-output{border-color:#dc3232}
.hero{background:#fff;border:1px solid #eadfce;border-radius:12px;padding:28px;margin-bottom:28px}
`;

/**
 * A GDPR banner like many Greek shops have: it covers the whole
 * page until the visitor chooses, so "add to cart" cannot be clicked before that.
 */
const CONSENT_BANNER = `<div id="cookie-consent" class="consent-banner" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999">
<div style="position:absolute;left:0;right:0;bottom:0;background:#fff;padding:20px 32px;display:flex;gap:12px;align-items:center">
<p style="flex:1;margin:0">Χρησιμοποιούμε cookies για να βελτιώσουμε την εμπειρία σας.</p>
<button type="button" data-choice="all">Αποδοχή όλων</button><button type="button" data-choice="necessary">Μόνο τα απαραίτητα</button></div></div>
<script>(function(){var b=document.getElementById('cookie-consent');if(document.cookie.indexOf('demo_consent=')>=0)return;
b.style.display='block';
b.addEventListener('click',function(e){var c=e.target.getAttribute('data-choice');if(!c)return;document.cookie='demo_consent='+c+';path=/';b.remove();});})();</script>`;

function layout(title: string, body: string, bodyClass = 'woocommerce-js'): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} – Aegean Coffee Co.</title><meta name="generator" content="WordPress 6.8">
<link rel="stylesheet" href="/wp-content/plugins/woocommerce/assets/css/woocommerce.css"><style>${STYLE}</style></head>
<body class="${bodyClass}"><header><span class="logo">Aegean Coffee Co.</span><a href="/shop/">Shop</a><a href="/contact/">Contact</a><a class="cart-contents" href="/cart/">Cart</a></header>
<main>${body}</main></body></html>`;
}

function productList(): string {
  return `<ul class="products">${PRODUCTS.map(
    (p) =>
      `<li class="product"><a class="woocommerce-LoopProduct-link" href="/product/${p.slug}/"><div class="thumb"></div><h2>${p.name}</h2><span class="price">${p.price}</span></a></li>`,
  ).join('')}</ul>`;
}

const CRITICAL_ERROR = `<!doctype html><html lang="en-US"><head><meta charset="utf-8"><title>WordPress › Error</title>
<style>body{background:#f1f1f1;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}#error-page{background:#fff;color:#444;margin:2em auto;padding:1em 2em;max-width:700px;box-shadow:0 1px 1px rgba(0,0,0,.04);border:1px solid #ccd0d4}</style></head>
<body id="error-page"><div class="wp-die-message"><p>There has been a critical error on this website.</p><p><a href="https://wordpress.org/documentation/article/faq-troubleshooting/">Learn more about troubleshooting WordPress.</a></p></div></body></html>`;

function cartCount(req: http.IncomingMessage): number {
  const m = /(?:^|;\s*)demo_cart=(\d+)/.exec(req.headers.cookie ?? '');
  return m ? Number(m[1]) : 0;
}

export interface DemoShop {
  url: string;
  port: number;
  /** Orders received at /order/ — must stay 0 while safe mode is on. */
  orders: () => number;
  setMode: (mode: BreakMode) => void;
  mode: () => BreakMode;
  close: () => Promise<void>;
}

export function startDemoShop(port = 0, initial: BreakMode = 'none', host = '127.0.0.1'): Promise<DemoShop> {
  let mode: BreakMode = initial;
  let checkoutHits = 0;
  let orders = 0;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://demo');
    const path = url.pathname;
    const html = (status: number, body: string, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
      res.end(mode === 'cookie-banner' ? body.replace('</body>', `${CONSENT_BANNER}</body>`) : body);
    };
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (path === '/__demo/break') {
      const next = url.searchParams.get('mode') as BreakMode;
      if (BREAK_MODES.includes(next)) mode = next;
      return json(200, { mode });
    }
    if (mode === 'down') return html(503, '<h1>503 Service Unavailable</h1>');
    if (mode === 'firewall' && !path.startsWith('/__')) {
      return html(
        403,
        '<!doctype html><html><head><title>Attention Required! | Cloudflare</title></head><body><h1>Sorry, you have been blocked</h1><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script></body></html>',
        { server: 'cloudflare' },
      );
    }
    if (path.startsWith('/__fixtures/')) return html(200, '<!doctype html><title>fixture</title>');

    if (path === '/wp-content/plugins/woocommerce/assets/css/woocommerce.css') {
      res.writeHead(200, { 'content-type': 'text/css' });
      return res.end('/* demo */');
    }
    if (req.method === 'POST' && url.searchParams.has('add-to-cart')) {
      const p = PRODUCTS.find((x) => String(x.id) === url.searchParams.get('add-to-cart'));
      if (!p) return html(400, 'bad product');
      // "Redirect to the cart page after successful addition" is a common WooCommerce setting.
      const location = mode === 'redirect-to-cart' ? '/cart/?added=1' : `/product/${p.slug}/?added=1`;
      res.writeHead(302, { location, 'set-cookie': `demo_cart=${cartCount(req) + 1}; Path=/; SameSite=Lax` });
      return res.end();
    }

    if (path === '/product/aegean-tee/') {
      // A variable product whose selects are hidden by a swatch plugin and whose first size is sold out.
      const variations = [
        { attributes: { attribute_size: 'xs' }, is_in_stock: false, is_purchasable: true, variation_is_active: true, variation_is_visible: true },
        { attributes: { attribute_size: 'm' }, is_in_stock: true, is_purchasable: true, variation_is_active: true, variation_is_visible: true },
      ];
      return html(
        200,
        layout(
          'Aegean Tee',
          `<div class="product"><h1 class="product_title">Aegean Tee</h1><p class="price">€19.00</p>
<form class="variations_form cart" method="post" action="/?add-to-cart=11" data-product_variations='${JSON.stringify(variations)}'>
<table class="variations"><tr><td><select name="attribute_size" style="display:none"><option value="">Choose</option><option value="xs">XS</option><option value="m">M</option></select>
<span class="swatch">XS</span> <span class="swatch">M</span></td></tr></table>
<button type="submit" class="single_add_to_cart_button button disabled wc-variation-selection-needed">Add to cart</button></form>
<script>var f=document.querySelector('.variations_form'),b=f.querySelector('button'),v=JSON.parse(f.dataset.product_variations);
f.querySelector('select').addEventListener('change',function(e){var m=v.find(function(x){return x.attributes.attribute_size===e.target.value&&x.is_in_stock});
b.classList.toggle('disabled',!m);b.classList.toggle('wc-variation-selection-needed',!m);});
b.addEventListener('click',function(e){if(b.classList.contains('disabled'))e.preventDefault();});</script></div>`,
        ),
      );
    }

    if (path === '/') {
      return html(200, layout('Home', `<div class="hero"><h1>Freshly roasted in the Aegean</h1><p>Small-batch coffee, shipped across Greece and Cyprus.</p><a class="button" href="/shop/">Shop now</a></div>${productList()}`, 'home woocommerce-js'));
    }
    if (path === '/shop/') return html(200, layout('Shop', `<h1>Shop</h1>${productList()}`));
    if (path === '/wp-json/wc/store/v1/products') {
      return json(
        200,
        PRODUCTS.map((p) => ({
          id: p.id,
          name: p.name,
          permalink: `http://${req.headers.host}/product/${p.slug}/`,
          type: 'simple',
          is_purchasable: true,
          is_in_stock: p.inStock,
          prices: { price: mode === 'free-order' ? '0' : p.price.replace(/\D/g, '') },
        })),
      );
    }
    if (path === '/wp-json/wc/store/v1/cart') return json(200, { items_count: cartCount(req), items: [], needs_payment: mode !== 'free-order' });

    const productMatch = /^\/product\/([a-z0-9-]+)\/$/.exec(path);
    if (productMatch) {
      const p = PRODUCTS.find((x) => x.slug === productMatch[1]);
      if (!p) return html(404, layout('Not found', '<h1>Page not found</h1>'));
      const notice = url.searchParams.has('added')
        ? `<div class="woocommerce-message" role="alert"><a href="/cart/" class="button wc-forward">View cart</a> “${p.name}” has been added to your cart.</div>`
        : '';
      const brokenButton = mode === 'add-to-cart';
      const form = `<form class="cart" method="post" action="/?add-to-cart=${p.id}"><input type="number" name="quantity" value="1" min="1">
<button type="${brokenButton ? 'button' : 'submit'}" name="add-to-cart" value="${p.id}" class="single_add_to_cart_button button alt">Add to cart</button></form>
${brokenButton ? `<script>document.querySelector('.single_add_to_cart_button').addEventListener('click',function(){ wc_add_to_cart_variation_params.ajax_url; });</script>` : ''}`;
      return html(200, layout(p.name, `${notice}<div class="product"><div class="thumb" style="height:240px"></div><h1 class="product_title">${p.name}</h1><p class="price">${p.price}</p>${form}</div>`));
    }

    if (path === '/cart/') {
      const n = cartCount(req);
      if (!n) return html(200, layout('Cart', '<h1>Cart</h1><p class="cart-empty woocommerce-info">Your cart is currently empty.</p><a class="button" href="/shop/">Return to shop</a>'));
      const added = url.searchParams.has('added')
        ? '<div class="woocommerce-message" role="alert"><a href="/shop/" class="button wc-forward">Continue shopping</a> Product has been added to your cart.</div>'
        : '';
      return html(
        200,
        layout(
          'Cart',
          `${added}<h1>Cart</h1><form class="woocommerce-cart-form"><table><tr><th>Product</th><th>Qty</th><th>Total</th></tr><tr class="cart_item"><td>${PRODUCTS[0]!.name}</td><td>${n}</td><td>${PRODUCTS[0]!.price}</td></tr></table></form>
<div class="wc-proceed-to-checkout" style="margin-top:20px"><a href="/checkout/" class="checkout-button button alt wc-forward">Proceed to checkout</a></div>`,
        ),
      );
    }

    if (path === '/checkout/') {
      if (mode === 'checkout') return html(500, CRITICAL_ERROR);
      // Fails every other visit, like an overloaded server.
      if (mode === 'flaky-checkout' && checkoutHits++ % 2 === 0) return html(500, CRITICAL_ERROR);
      if (mode === 'cart-session' || !cartCount(req)) {
        return html(200, layout('Cart', '<h1>Cart</h1><p class="cart-empty woocommerce-info">Your cart is currently empty.</p>'));
      }
      // WooCommerce leaves out the payment methods when the order total is zero.
      const methods =
        mode === 'free-order'
          ? ''
          : mode === 'payment'
          ? '<ul class="wc_payment_methods payment_methods methods"><li class="woocommerce-notice woocommerce-notice--info woocommerce-info">Sorry, it seems that there are no available payment methods. Please contact us if you require assistance.</li></ul>'
          : `<ul class="wc_payment_methods payment_methods methods"><li class="wc_payment_method payment_method_stripe"><input type="radio" name="payment_method" value="stripe" checked> <label>Credit / debit card</label></li>
<li class="wc_payment_method payment_method_cod"><input type="radio" name="payment_method" value="cod"> <label>Cash on delivery</label></li></ul>`;
      return html(
        200,
        layout(
          'Checkout',
          `<h1>Checkout</h1><form name="checkout" method="post" class="checkout woocommerce-checkout" action="/order/">
<label for="billing_first_name">First name</label><input id="billing_first_name" name="billing_first_name">
<label for="billing_email">Email address</label><input id="billing_email" name="billing_email" type="email">
<div id="payment" class="woocommerce-checkout-payment">${methods}<button type="submit" class="button alt" name="woocommerce_checkout_place_order" id="place_order" value="Place order">Place order</button></div></form>`,
        ),
      );
    }

    if (path === '/order/') {
      orders++;
      return html(200, layout('Order received', '<h1>Order received</h1><p>Thank you. Your order has been received.</p>'));
    }
    if (url.searchParams.get('wc-ajax') === 'checkout' && req.method === 'POST') {
      orders++;
      return json(200, { result: 'success', redirect: '/order/' });
    }
    if (path === '/spa-checkout/') {
      // A single-page-app checkout: a React-style div button, a web component with shadow DOM,
      // and a "Pay now" payment-method choice that must stay clickable.
      return html(
        200,
        layout(
          'Checkout',
          `<h1>Checkout</h1>
<label class="method"><input type="radio" name="pm" value="klarna"> Pay now</label>
<div class="pay-div" style="cursor:pointer;background:#8a5a2b;color:#fff;padding:10px;display:inline-block">Pay now</div>
<pay-button></pay-button><p id="result"></p>
<script>
function order(){fetch('/order/',{method:'POST'}).then(function(){document.getElementById('result').textContent='Order placed';});}
document.querySelector('.pay-div').addEventListener('click',order);
customElements.define('pay-button',class extends HTMLElement{connectedCallback(){var r=this.attachShadow({mode:'open'});r.innerHTML='<button style="padding:10px">Complete order</button>';r.querySelector('button').addEventListener('click',order);}});
</script>`,
        ),
      );
    }
    if (path === '/ajax-checkout/') {
      // A theme whose final button has an innocent label and places the order over AJAX.
      return html(
        200,
        layout(
          'Checkout',
          `<h1>Checkout</h1><button type="button" id="go" class="button">Continue</button><p id="result"></p>
<script>document.getElementById('go').addEventListener('click',function(){fetch('/?wc-ajax=checkout',{method:'POST',body:'billing_email=a%40b.c'}).then(function(r){return r.json()}).then(function(){document.getElementById('result').textContent='Order placed';}).catch(function(){document.getElementById('result').textContent='Request failed';});});</script>`,
        ),
      );
    }
    if (path === '/greek-checkout/') {
      // A Greek theme that uppercases its button label and wraps it in a span (safe-mode test page).
      return html(
        200,
        layout(
          'Ταμείο',
          `<h1>Ταμείο</h1><form method="post" action="/order/"><label>Email <input id="email" name="email" type="email"></label>
<button type="submit" class="confirm" style="text-transform:uppercase"><span class="lbl">Ολοκλήρωση παραγγελίας</span></button></form>`,
        ),
      );
    }

    if (path === '/contact/') {
      // A hidden newsletter popup and a visible newsletter bar come before the real form, and an
      // invisible reCAPTCHA v3 badge sits on the page, as on many WordPress sites.
      return html(
        200,
        layout(
          'Contact',
          `<form class="newsletter-popup" style="display:none"><input type="email" name="EMAIL"><button>Subscribe</button></form>
<form class="newsletter-bar"><input type="email" name="EMAIL" placeholder="Newsletter"><button>Subscribe</button></form>
<div class="grecaptcha-badge"><iframe src="/__fixtures/recaptcha/api2/anchor?k=x&size=invisible" width="256" height="60"></iframe></div>
<h1>Contact us</h1><div class="wpcf7"><form class="wpcf7-form init" action="/contact/submit" method="post" novalidate>
<label>Your name <input type="text" name="your-name" required></label>
<label>Your email <input type="email" name="your-email" required></label>
<label>Subject <input type="text" name="your-subject"></label>
<label>Your message <textarea name="your-message" rows="4"></textarea></label>
<label><input type="checkbox" name="acceptance" required> I agree to the privacy policy</label>
<input type="submit" value="Send" class="wpcf7-submit"><div class="wpcf7-response-output" aria-hidden="true"></div></form></div>
<script>document.querySelector('.wpcf7-form').addEventListener('submit',function(e){e.preventDefault();var f=e.target;
fetch('/contact/submit',{method:'POST',body:new URLSearchParams(new FormData(f))}).then(function(r){return r.json()}).then(function(d){
if(d.status==='robot'){f.insertAdjacentHTML('beforeend','<p class="form-alert">'+d.message+'</p>');return;}
f.className='wpcf7-form '+({mail_sent:'sent',spam:'spam',validation_failed:'invalid'}[d.status]||'failed');var o=f.querySelector('.wpcf7-response-output');o.textContent=d.message;o.removeAttribute('aria-hidden');});});</script>`,
        ),
      );
    }
    if (path === '/contact/submit' && req.method === 'POST') {
      if (mode === 'contact') return json(200, { status: 'mail_failed', message: 'There was an error trying to send your message. Please try again later.' });
      // Contact Form 7 uses the same wording for spam as for a mail failure; only the status differs.
      if (mode === 'contact-spam') return json(200, { status: 'spam', message: 'There was an error trying to send your message. Please try again later.' });
      if (mode === 'contact-invalid') return json(200, { status: 'validation_failed', message: 'One or more fields have an error. Please check and try again.' });
      // A hand-built form whose bot check (e.g. reCAPTCHA v3 score) turned the monitor away.
      if (mode === 'contact-robot') return json(200, { status: 'robot', message: 'Επιβεβαιώστε ότι δεν είστε ρομπότ και δοκιμάστε ξανά.' });
      return json(200, { status: 'mail_sent', message: 'Thank you for your message. It has been sent.' });
    }

    html(404, layout('Not found', '<h1>Page not found</h1>'));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const actual = typeof addr === 'object' && addr ? addr.port : port;
      resolve({
        url: `http://${host}:${actual}`,
        port: actual,
        orders: () => orders,
        setMode: (m) => {
          mode = m;
        },
        mode: () => mode,
        close: () =>
          new Promise<void>((r) => {
            server.closeAllConnections();
            server.close(() => r());
          }),
      });
    });
  });
}
