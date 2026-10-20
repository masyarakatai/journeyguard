# Presets

Presets are ready-made journeys that discover what they need (products, cart and checkout links, form fields) so most sites need no selectors. Run `journeyguard detect https://your-site.com` to see which presets fit.

## `website`

| Stage | Checks |
|---|---|
| Homepage | Loads with status < 400; no WordPress critical error, database error, maintenance mode, PHP fatal error or gateway error page; records load time; flags first-party scripts/styles that fail to load |
| Key pages | Each path in `pages` opens without an error page |
| SSL certificate | Valid for at least `sslMinDays` days; warns under 30 days |

Options: `pages: [/about/, /contact/]`, `ssl: true`, `sslMinDays: 14`.

## `woocommerce`

| Stage | Checks |
|---|---|
| Website | Homepage loads without an error page |
| Products | Picks an in-stock, purchasable product with a price from the Store API (`/wp-json/wc/store/v1/products`), preferring simple products, falling back to the first product on the shop page; the product page shows an add-to-cart button |
| Add to cart | Chooses product options when needed, clicks add to cart, confirms the cart really contains it (Store API, or the theme's success notice), opens the cart page and sees the item |
| Checkout | Opens checkout and detects the classic "your cart is empty" bounce caused by caching; the checkout form and billing email field are visible |
| Payment | At least one payment method is offered; records the methods and providers detected (Stripe, PayPal, Viva, JCC, Everypay, Cardlink, Nexi, Piraeus, Eurobank/Worldline, IRIS, Revolut, Klarna…); the place-order button is present but **not clicked**. A free order (total €0) needs no payment, so this stage is then *not tested* |
| Place order | Always *not tested*: JourneyGuard never submits orders |

Options:

| Option | Default | Use when |
|---|---|---|
| `productUrl` | auto | You want to test a specific, always-available product |
| `shopPath` | `/shop/` | Your shop page has another slug and the Store API is disabled |
| `cartPath` | auto (`/cart/`) | Your cart page has a translated slug, e.g. `/kalathi/` |
| `checkoutPath` | auto (`/checkout/`) | e.g. `/tameio/` |
| `payment` | `true` | Set `false` to skip the payment stage |
| `expectPayments` | – | Methods that must stay on offer, e.g. `[Viva, Αντικαταβολή]`. Matched against the method names and detected providers, ignoring case and accents. Without it, the stage only checks that *some* method is offered, so a dead card gateway goes unnoticed while cash on delivery still works |

Works with classic and block-based cart/checkout. Products whose options load on demand (very large variable products) cannot reveal which combination is in stock; the journey reports *not tested* and asks for a `productUrl` instead of raising a false alarm.

## `shopify` (beta)

Shopify changes its checkout often, so this preset is marked beta: please report false alarms.

| Stage | Checks |
|---|---|
| Website | Storefront loads and is not password-protected |
| Products | Picks an available product from `/products.json` (or `productHandle`); the product form is visible |
| Add to cart | Clicks add to cart and confirms via `/cart.js` |
| Checkout | Opens `/checkout`, lands on Shopify checkout, contact email field visible. A bot challenge is reported as *not tested*, not as an outage |
| Payment | Payment section visible (a miss is a warning, because Shopify's checkout markup changes often) |
| Place order | Always *not tested* |

Options: `productHandle`, `payment`.

## `contact-form`

| Stage | Checks |
|---|---|
| Contact page | The page opens and contains a form with an email field or a message box (or the `form` selector you give). Comment, review, search, log-in, cart and newsletter forms are skipped; forms from known plugins are preferred |
| Submit form | No interactive CAPTCHA (reCAPTCHA checkbox, hCaptcha, Turnstile, Divi's maths question); fills every visible field like a visitor (name, email, phone, subject, message, consent box, selects); submits; waits for a success message and fails on error messages |
| Email delivered | *Not tested yet* (IMAP inbox verification is planned for v0.2) |

Recognised plugins: Contact Form 7, WPForms, Gravity Forms, Elementor Forms, Fluent Forms, Ninja Forms, Divi, plus generic "thank you / ευχαριστούμε" messages and thank-you page redirects. The Contact Form 7 *"There was an error trying to send your message"* failure, a very common silent problem, is reported as **Messages from customers are being lost**.

What is *not* an outage, and is reported as *not tested* with a hint instead:

- anti-spam or anti-robot answers such as Akismet's spam status, *"reCAPTCHA verification failed"* or *"Επιβεβαιώστε ότι δεν είστε ρομπότ"*: allow-list the monitor, and send one message by hand to be sure real visitors get through;
- input errors (*"This field is required"*): tell JourneyGuard what to type with `fields`.

Options:

| Option | Default | |
|---|---|---|
| `path` | `/contact` | Page that holds the form |
| `form` | auto | CSS selector of the form |
| `email` | `journeyguard-test@example.com` | Use an address you can filter in your inbox |
| `phone` | `2100000000` | |
| `message` | short test text | |
| `fields` | – | Map of `selector: value` to override auto-fill |
| `successText` | auto | Exact confirmation text to wait for |
| `captcha` | `skip` | `ignore` to try submitting anyway (only with a test key) |
| `submit` | `true` | `false` checks that the form is there and can be filled in, without sending a message |

The preset runs every **24 hours** by default because each run sends a real message, and it is never retried within a run, so a slow confirmation cannot produce two messages. Override with `interval` and `retries`.

## Writing a new preset

Presets live in [`src/presets`](../src/presets). A preset is a function that returns named stages made of steps; steps can be regular YAML steps or `custom` functions with access to the Playwright page. Add a break mode to the demo shop and an end-to-end test for every failure you detect. PrestaShop, OpenCart and Magento presets are especially welcome.
