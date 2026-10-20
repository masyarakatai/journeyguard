# Configuration

JourneyGuard reads one YAML file, `journeyguard.yml` by default (override with `--config` or `JOURNEYGUARD_CONFIG`). Create a starter file with `journeyguard init https://your-site.com` and check it with `journeyguard validate`.

Any value can reference an environment variable: `${NAME}` or `${NAME:-default}`. Keep tokens and passwords out of the file this way.

## `settings`

| Key | Default | Meaning |
|---|---|---|
| `interval` | `15m` | How often each journey runs. Units: `ms`, `s`, `m`, `h`, `d`. |
| `timeout` | `30s` | Maximum wait for each step. |
| `retries` | `1` | Re-runs a failed journey before reporting it. A journey that passes on retry is marked as a warning (*intermittent problem*). |
| `safeMode` | `true` | Refuses order/payment actions. Only an explicit `false` turns it off; an empty or unset `${VARIABLE}` keeps it on. See [safety](safety.md). |
| `language` | `en` | `en` or `el`. Stage names, diagnosis, dashboard, reports and alerts. |
| `dataDir` | `./journeyguard-data` | Where runs and screenshots are stored, relative to the config file. `JOURNEYGUARD_DATA_DIR` overrides it. |
| `keepRuns` | `200` | Runs kept per journey; older ones are deleted. |
| `headers` | `{ X-JourneyGuard: "1" }` | Extra headers on requests to the monitored site (never to third-party scripts, images or payment providers). |
| `userAgentSuffix` | `JourneyGuard/<version> (+repo URL)` | Appended to a regular Chrome user agent. |
| `viewport` | `{ width: 1366, height: 900 }` | Browser window size. |
| `browser.headless` | `true` | Set `false` (or pass `--headed`) to watch the browser. |
| `browser.executablePath` | – | Use a system Chromium instead of Playwright's. `JOURNEYGUARD_CHROMIUM_PATH` also works. |
| `report.brandName` / `report.brandUrl` | – | Your brand on reports and the dashboard (agencies). |
| `report.poweredBy` | `true` | Show the small "Monitored with JourneyGuard" footer. |
| `dashboard.host` | `127.0.0.1` | Use `0.0.0.0` to expose it (Docker does this for you). |
| `dashboard.port` | `8080` | |
| `dashboard.password` | `JOURNEYGUARD_PASSWORD` | Enables HTTP basic auth (any username). Falls back to the `JOURNEYGUARD_PASSWORD` environment variable. On any address other than 127.0.0.1 it is required and must be at least 10 characters. |
| `dashboard.publicUrl` | – | Used to link alerts to the dashboard. |

## `alerts`

A list of channels. See [alerts](alerts.md) for each type. Alerts fire when a journey **breaks** and when it **recovers**.

## `sites`

```yaml
sites:
  - name: My Shop                     # shown everywhere; also used to build stable IDs
    url: https://shop.example.com     # relative step URLs resolve against this
    interval: 30m                     # optional: overrides settings.interval for this site
    headers:                          # optional: extra headers for this site only
      X-Monitor-Token: ${SHOP_MONITOR_TOKEN}   # sent to this site (and its www. variant), never to third parties
    journeys: [...]
```

## Journeys

A journey is either a **preset** or your own list of steps.

```yaml
journeys:
  - preset: woocommerce              # see presets.md for options
    options: { productUrl: /product/test-item/ }
    interval: 10m                    # optional per-journey interval
  - preset: contact-form
    enabled: false                   # temporarily switch a journey off
  - name: Newsletter sign-up         # custom journeys need a name
    steps:                           # each step becomes its own stage on the dashboard
      - goto: /
      - fill: { selector: '#newsletter-email', value: monitor@example.com }
      - click: { text: Subscribe }
      - expectText: Thanks for subscribing
  - name: Customer login
    stages:                          # or group steps into named stages
      - name: Sign in
        steps:
          - goto: /my-account/
          - fill: { selector: '#username', value: '${SHOP_TEST_USER}' }
          - fill: { selector: '#password', value: '${SHOP_TEST_PASSWORD}' }
          - click: 'button[name=login]'
      - name: Orders page
        steps:
          - click: { text: Orders }
          - expectVisible: .woocommerce-orders-table, .woocommerce-info
```

### Journey identity

History and alert state are stored per journey under a stable id: the journey's `name`, or for presets without a name the preset plus its `path`, `productUrl` or `productHandle` (e.g. `contact-form-contact`). Disabling or reordering journeys never changes another journey's id. If two journeys would end up with the same id, JourneyGuard asks you to give one of them a `name`.

## Steps

Every step has exactly one action. Optional on every step: `name` (label in reports), `timeout` (e.g. `10s`), `optional: true` (a failure becomes a warning).

Selectors are [Playwright selectors](https://playwright.dev/docs/other-locators): CSS, `text=...`, `role=button[name="Buy"]`, etc. Wherever a selector is accepted you may give a **list of fallbacks**; the first that matches is used. This keeps journeys working across theme changes.

| Step | Example | Passes when |
|---|---|---|
| `goto` | `goto: /checkout/` | The page loads with HTTP status < 400 |
| `click` | `click: '#buy'` · `click: { text: Add to cart }` | The element is visible and clicked (safe mode applies) |
| `fill` | `fill: { selector: '#email', value: a@b.c }` | The field is visible and filled |
| `select` | `select: { selector: '#size', value: M }` | The option is selected |
| `check` | `check: '#terms'` | The checkbox is ticked |
| `press` | `press: { selector: '#search', key: Enter }` | The key is pressed |
| `expectVisible` | `expectVisible: [.cart_item, .wc-block-cart-item]` | The element becomes visible |
| `expectHidden` | `expectHidden: .loading` | The element disappears |
| `expectText` | `expectText: Order summary` · `expectText: { selector: h1, text: Cart }` | The text appears |
| `expectNoText` | `expectNoText: Internal Server Error` | The text is **not** on the page |
| `expectUrl` | `expectUrl: /thank-you` · `expectUrl: /\/order\/\d+/` | The URL contains the text or matches the `/regex/` |
| `waitFor` | `waitFor: '#map'` · `waitFor: 2000` | The element appears, or the time passes |
| `screenshot` | `screenshot: cart` | Saves an extra screenshot as evidence |

## Exit codes

`journeyguard run` exits with `0` when nothing failed, `1` when at least one journey failed, and `2` for configuration or setup errors, so it fits CI pipelines and cron jobs.
