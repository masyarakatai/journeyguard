# Safety and responsible use

JourneyGuard drives a real browser through real shops. It is designed so that doing that is safe.

## No real orders, no real payments

- **Safe mode is on by default.** Before every click JourneyGuard inspects the target. Buttons that look like the final step of a purchase are refused: `#place_order`, WooCommerce block checkout buttons, Shopify's pay button, OpenCart's confirm button, and labels such as *Place order*, *Confirm order*, *Complete order*, *Pay now*, *Pay €24.90*, *Ολοκλήρωση παραγγελίας*, *Καταχώρηση παραγγελίας*, *Πληρωμή τώρα*, matched regardless of case and accents (so CSS uppercasing does not fool it). A refused click fails the journey with a clear message instead of placing an order.
- **A guard inside the page** backs this up at the moment an action happens: it blocks clicks on order buttons (including on an icon or text inside them), pressing Enter in a checkout field, and page scripts that submit the order form. Selecting a payment method (a radio or its label) is never blocked.
- Safe mode **fails closed**: only an explicit `safeMode: false` turns it off, and the dashboard and logs then say so loudly.
- The shop presets **stop once the payment step has loaded**. They verify that customers could pay (payment methods offered, provider scripts loaded, place-order button present) without paying.
- To test a full purchase, use a staging store or a store whose payment gateway is in **test mode**, write a custom journey, and set `safeMode: false` for that configuration only.

## Side effects you should know about

- **Carts:** shop journeys add one item to a cart in a fresh browser session that is discarded afterwards. WooCommerce keeps abandoned sessions for up to 48 hours; if you use abandoned-cart emails, make sure they require an email address (JourneyGuard never enters one at checkout).
- **Contact forms send real messages.** The `contact-form` preset runs every 24 hours by default. Use a monitoring address in the `email` option and a mail rule to file the messages away.
- **Analytics:** requests to your site carry the header `X-JourneyGuard: 1`, and the user agent of every request contains `JourneyGuard/<version>`. Exclude either in Google Analytics/GTM, Matomo or your ad pixels so test visits do not count as traffic or conversions.
- **Stock:** adding to cart does not reduce stock in WooCommerce or Shopify.

## Firewalls and bot protection

JourneyGuard identifies itself honestly and does **not** try to evade bot protection or solve CAPTCHAs. If Cloudflare, Sucuri, Wordfence or similar show a block page, the journey is reported as *not tested* (no alert) with a hint to allow-list the monitor. Extra headers, including allow-list secrets, are only sent to the monitored site, never to third-party scripts or payment providers. Allow-list requests carrying the `X-JourneyGuard` header (ideally combined with a secret header set under `sites[].headers`) or the monitor's IP address. Forms with a visible CAPTCHA are reported as *not tested*; use a test key for the monitoring environment if you need them covered.

## Only monitor what you are allowed to

Run JourneyGuard against sites you own, operate, or have written permission to test. Automated purchases and form submissions against third-party sites may breach their terms of service and the law.

## Your data

Everything stays on your server: results and screenshots live in `dataDir`, and JourneyGuard sends nothing anywhere except the alerts you configure. Screenshots can contain whatever the page showed, so protect the dashboard with a password and keep `dataDir` private. Use dedicated low-privilege test accounts for journeys that log in, and pass their credentials through environment variables.

## Reporting security issues

See [SECURITY.md](../SECURITY.md).
