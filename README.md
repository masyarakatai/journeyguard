<div align="center">

<img src="docs/assets/logo.svg" width="72" alt="">

# JourneyGuard

**Your website can be "up" while customers can't buy, sign up or contact you.**<br>
JourneyGuard walks through your shop and forms like a real customer and tells you, in plain language, the moment a journey breaks.

[![CI](https://github.com/nxdpro/journeyguard/actions/workflows/ci.yml/badge.svg)](https://github.com/nxdpro/journeyguard/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/nxdpro/journeyguard?include_prereleases&sort=semver)](https://github.com/nxdpro/journeyguard/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/docker-ghcr.io%2Fnxdpro%2Fjourneyguard-2496ED?logo=docker&logoColor=white)](https://github.com/nxdpro/journeyguard/pkgs/container/journeyguard)
![Self-hosted](https://img.shields.io/badge/self--hosted-yes-success)

[Check your site](#check-your-site-in-one-minute) · [Quick start](#quick-start) · [Presets](docs/presets.md) · [Configuration](docs/configuration.md) · [Alerts](docs/alerts.md) · [Safety](docs/safety.md) · [FAQ](#faq) · [Ελληνικά](README.el.md)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/dashboard-dark.png">
  <img src="docs/assets/dashboard.png" alt="JourneyGuard dashboard: the WooCommerce checkout fails with a WordPress critical error, with the failed step, a plain-language diagnosis and a screenshot" width="900">
</picture>

</div>

> **Status: early release (v0.1).** Tested against a demo shop with more than 50 failure scenarios and on our own production sites. False alarms are the bugs we care about most: please [report them](https://github.com/nxdpro/journeyguard/issues/new/choose).

## Why

Most outages that cost small businesses money are not "the server is down". They are:

- a plugin update that breaks **checkout** with a PHP error, while the homepage still loads,
- an **add to cart** button that silently stops working after a theme change,
- a payment gateway whose API keys expired, so the **card payment** disappears and only cash on delivery is left,
- a caching rule that **empties the cart** on the way to checkout,
- a **contact form** that says "error sending your message" because the mail server broke weeks ago.

An uptime monitor sees `200 OK` for all of these. JourneyGuard opens a real browser, goes through the journey step by step, and when something fails it keeps a screenshot, the browser errors, the failed requests, and a **plain-language explanation** of the likely cause.

| | Uptime monitor | JourneyGuard |
|---|:---:|:---:|
| Server answers | ✅ | ✅ |
| Products can be added to cart | – | ✅ |
| Checkout and payment methods load | – | ✅ |
| Contact form actually sends | – | ✅ |
| Screenshot + diagnosis at the moment of failure | – | ✅ |
| Never places a real order | n/a | ✅ |

JourneyGuard complements an uptime monitor such as [Uptime Kuma](https://github.com/louislam/uptime-kuma); it does not replace it. Point Uptime Kuma at JourneyGuard's `/healthz` endpoint and you get both.

## Check your site in one minute

```bash
docker run --rm ghcr.io/nxdpro/journeyguard check https://your-shop.com
```

JourneyGuard detects the platform (WooCommerce, Shopify, WordPress), then walks through the journeys that fit: homepage and SSL, product → cart → checkout → payment methods, and the contact form. Nothing is bought and no message is sent: the contact form is filled in but not submitted. Results appear in the terminal, in Greek for `.gr` and `.cy` sites (`--lang en|el` to choose). Add `--report report.html` for a shareable report (see [deployment](docs/deployment.md#one-off-checks-and-reports)).

Only check sites you own or are allowed to test.

## Try the demo

```bash
docker run --rm -p 8080:8080 ghcr.io/nxdpro/journeyguard demo --host 0.0.0.0
```

<img src="docs/assets/demo.svg" alt="Terminal: journeyguard demo checks a healthy shop, then catches a broken checkout with a plain-language diagnosis" width="760">

This starts a small demo shop, checks it while healthy, breaks its checkout, and serves the dashboard on http://localhost:8080 so you can see exactly what you would receive. Add `--break add-to-cart`, `payment`, `cart-session`, `contact` or `down` to try other failures. The image is about 900 MB.

<details>
<summary>Without Docker (Node.js 22+)</summary>

```bash
git clone https://github.com/nxdpro/journeyguard && cd journeyguard
npm ci && npm run build && npm install -g .
npx playwright install --with-deps chromium   # Chromium plus, on Linux, its system libraries (asks for sudo)
journeyguard demo
```

</details>

## Quick start

Requirements: a small VPS or any machine with Docker (1 vCPU and 1–2 GB RAM check dozens of journeys). No database: results are plain JSON and PNG files.

**1. Guided setup.** A few questions in English or Greek: your site's address (WooCommerce, Shopify and WordPress are detected automatically) and where alerts should go. For Telegram it finds your chat by itself and sends a test message. It writes `journeyguard.yml` and a private `.env` with a generated dashboard password.

```bash
mkdir journeyguard && cd journeyguard
docker run --rm -it --user "$(id -u):$(id -g)" -v "$PWD:/config" ghcr.io/nxdpro/journeyguard \
  init --config /config/journeyguard.yml
```

**2. Start it.**

```bash
curl -O https://raw.githubusercontent.com/nxdpro/journeyguard/main/docker-compose.yml
docker compose up -d
```

Open http://your-server:8080 and sign in with any username and the password the setup printed (it is also in `.env`). Useful one-off commands:

```bash
docker compose run --rm journeyguard test-alerts   # send a test message to every alert channel
docker compose run --rm journeyguard run           # run every check once and print the result
```

With a Node.js install the same steps are `journeyguard init`, `journeyguard run` and `journeyguard start`.

See [deployment](docs/deployment.md) for reverse proxies, systemd and CI.

## Configuration

```yaml
settings:
  interval: 15m
  language: en          # en | el — reports and alerts in English or Greek

alerts:
  - type: telegram
    botToken: ${TELEGRAM_BOT_TOKEN}
    chatId: ${TELEGRAM_CHAT_ID}

sites:
  - name: My Shop
    url: https://shop.example.com
    journeys:
      - preset: website
      - preset: woocommerce
        options:
          expectPayments: [Viva, Cash on delivery]   # alert if either one disappears
      - preset: contact-form
        options: { path: /contact/ }
      - name: Newsletter sign-up          # your own journey, no code needed
        steps:
          - goto: /
          - fill: { selector: '#newsletter-email', value: 'monitor@example.com' }
          - click: { text: Subscribe }
          - expectText: Thanks for subscribing
```

Full reference: [docs/configuration.md](docs/configuration.md). More examples: [`examples/`](examples).

## Presets

| Preset | What it checks |
|---|---|
| `website` | Homepage renders without error pages, scripts and styles load, key pages open, SSL certificate is not about to expire |
| `woocommerce` | Finds an in-stock product → adds it to the cart → cart keeps it → checkout opens → payment methods are offered, optionally the ones you name (order **not** placed) |
| `shopify` (beta) | Store is public → product → add to cart → checkout opens → payment section loads (order **not** placed) |
| `contact-form` | Fills the form like a visitor, submits it once a day and waits for the confirmation; detects Contact Form 7, WPForms, Gravity Forms, Elementor, Divi and generic forms. `submit: false` checks the form without sending |

Presets discover products and pages on their own, so most sites need no selectors at all. They close cookie banners and pop-ups the way a visitor would, always choosing "necessary only". Firewalls, CAPTCHAs and anti-spam rejections are reported as *not tested* with a hint, never as outages. Details and options: [docs/presets.md](docs/presets.md).

## What you get when something breaks

<img src="docs/assets/alert.png" alt="E-mail alert on a phone: the checkout journey failed, with the failed step, the likely cause and a screenshot" width="300" align="right">

- **An alert** on Telegram, Discord, Slack, email or any webhook, only when a journey breaks and when it recovers, never every 5 minutes. Telegram, Discord and email include the screenshot.
- **The exact step** that failed and the steps that were never reached.
- **Evidence**: screenshot, page URL and HTTP status, browser console errors, failed network requests.
- **A likely cause** in plain English or Greek, e.g. *"Customers lose their cart at checkout: cart and checkout pages are probably being cached."*
- **A self-contained HTML report** you can email to a client (`journeyguard run --report report.html`), white-label ready.
- **A health check for the monitor itself**: if JourneyGuard cannot run its checks (for example the browser no longer starts), it tells you once, and `/healthz` answers 503.

<br clear="right">

<details>
<summary>More screenshots: dark mode, phone, client report, Greek</summary>

| | |
|---|---|
| <img src="docs/assets/dashboard-dark.png" alt="Dashboard in dark mode" width="440"> | <img src="docs/assets/report.png" alt="Self-contained HTML report for a client" width="440"> |
| <img src="docs/assets/dashboard-mobile.png" alt="Dashboard on a phone" width="220"> <img src="docs/assets/alert-el.png" alt="The same alert in Greek" width="220"> | <img src="docs/assets/dashboard-el.png" alt="Dashboard in Greek" width="440"> |

</details>

## How is this different?

- **From an uptime or keyword monitor** (Uptime Kuma, UptimeRobot): those load one URL. JourneyGuard adds a product to the cart, opens checkout and checks the payment methods, with the cookies and JavaScript of a real visit.
- **From Checkly, Datadog Synthetics or your own Playwright tests**: those are great if your team writes and maintains test code. JourneyGuard is for shops and agencies that don't: presets find a buyable product through the WooCommerce Store API or Shopify's `products.json`, so there is nothing to write and little to break when the theme changes.
- **Safety built in**: an in-page guard and a network backstop make sure a check never places an order, which hand-written tests rarely guarantee.
- **Answers, not stack traces**: every failure comes with a likely cause and what to check, in English or Greek.
- **Free and self-hosted**: MIT licensed, one container, your data stays on your server.

## Safe by design

- Safe mode is **on by default**: JourneyGuard refuses to click anything that looks like *place order*, *pay now* or *ολοκλήρωση παραγγελίας*. A guard inside the page also stops pressing Enter in a checkout field and scripts that submit the order form, and order and payment requests are blocked at the network level as a last line of defence. The shop presets stop once the payment step has loaded.
- Requests to your site carry an `X-JourneyGuard: 1` header and every request a `JourneyGuard/x.y` user agent, so you can allow-list the monitor in your firewall and exclude it from analytics. Extra headers are never sent to third parties.
- It does not bypass CAPTCHAs or bot protection: those pages are reported as *not tested* rather than attacked.
- Monitor only sites you own or are authorised to test. Read [docs/safety.md](docs/safety.md).

## Known limitations

- Email delivery is not verified yet: the contact-form check confirms the site says "sent". Inbox checks (IMAP) are planned for v0.2.
- Pages behind a CAPTCHA, a bot challenge or a strict firewall are reported as *not tested* until you allow-list the monitor.
- Payment methods are checked as offered, not paid with. Name the methods that matter with `expectPayments`; without it, the check only fails when no method is offered at all.
- Shopify's checkout changes often, so the `shopify` preset is beta.

## FAQ

**Will it place orders or send messages?** It never places orders or payments (see [safety](docs/safety.md)). A monitored contact form sends one real test message a day so you know mail works; `check` and `submit: false` never send.

**My site uses Cloudflare, Wordfence or another firewall.** If the monitor is challenged, the journey is reported as *not tested* with a hint. Allow-list requests that carry the `X-JourneyGuard` header, or the server's IP address.

**Will it mess up my analytics?** Exclude the `JourneyGuard` user agent or the `X-JourneyGuard` header in your analytics filters. Cookie banners are always answered with "necessary only", so tracking scripts that respect consent do not run.

**Is it GDPR-friendly?** It runs on your own server, stores screenshots of your own pages and sends data nowhere except the alert channels you configure.

**How much does it need?** One container; 1 vCPU and 1–2 GB RAM handle dozens of journeys, because journeys run one at a time.

**Which platforms are supported?** WooCommerce, Shopify (beta) and any website or contact form. PrestaShop, OpenCart and Magento presets are on the roadmap; until then, describe the journey in YAML.

## Use it in CI

Run the same journeys after every deploy and fail the pipeline if checkout broke (full example in [deployment](docs/deployment.md#ci-smoke-test-every-deploy)):

```yaml
- run: |
    docker run --rm -v "$PWD:/work" -w /work -e HOME=/tmp -e JOURNEYGUARD_DATA_DIR=/tmp/jg \
      --user "$(id -u):$(id -g)" ghcr.io/nxdpro/journeyguard \
      run --config journeyguard.yml --no-alerts --report journeyguard-report.html
```

## For agencies

- Every client site in one dashboard, each with its own journeys and schedule ([`examples/agency.yml`](examples/agency.yml)).
- A self-contained HTML report with your name and link (`report.brandName`, `report.brandUrl`) to send to the client.
- Alerts and reports in English or Greek.
- Want to offer monitoring under your own brand without running servers? Ask about our [reseller programme](mailto:info@nxdpro.com?subject=JourneyGuard%20for%20agencies).

## Roadmap

- **v0.2:** inbox verification for forms (IMAP), PrestaShop and OpenCart presets, alerts per site, repeat-alert reminders
- **v0.3:** optional AI diagnosis (bring your own key), visual change detection, performance budgets
- **v0.4:** multi-user dashboard, status page, agency workspaces

See [ROADMAP.md](ROADMAP.md) and vote with 👍 on issues. Platform requests are very welcome.

## Contributing

Bug reports, presets for new platforms, translations and docs are all welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md). Run the test suite with `npm test`: it exercises every preset against the bundled demo shop.

## Professional help

JourneyGuard is built and maintained by [NXDPRO Solutions](https://www.nxdpro.com/?utm_source=github&utm_medium=readme&utm_campaign=journeyguard), a web and e-commerce studio in Limassol, Cyprus, building websites, e-shops and custom business systems for clients in Cyprus and Greece since 2003.

**Don't want to run a server?** We can check your shop for free, or set up JourneyGuard and watch it for you: [info@nxdpro.com](mailto:info@nxdpro.com?subject=JourneyGuard%20check). If JourneyGuard found a problem you would rather not fix yourself, we can help with that too.

## License

[MIT](LICENSE) © NXDPRO Solutions
