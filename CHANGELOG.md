# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-20

First public release.

### Added
- **Journeys in a real browser** (Playwright/Chromium) with per-stage results, retries and evidence: screenshot, page HTML, console errors, failed requests.
- **Presets** that need no selectors: `website` (error pages, broken scripts and styles, key pages, SSL expiry), `woocommerce` (in-stock product → cart → checkout → payment methods, classic and block checkout), `shopify` (beta) and `contact-form` (Contact Form 7, WPForms, Gravity Forms, Elementor, Fluent Forms, Ninja Forms, Divi and generic forms).
- **`expectPayments`** for WooCommerce: an alert when a named method (for example the card gateway) disappears while others such as cash on delivery remain. Detects Stripe, PayPal, Viva, JCC, Everypay, Cardlink, Nexi, Piraeus, Eurobank/Worldline, IRIS, Revolut, Klarna and more.
- **Custom journeys in YAML**: `goto`, `click`, `fill`, `select`, `check`, `press`, `expectVisible`, `expectHidden`, `expectText`, `expectNoText`, `expectUrl`, `waitFor`, `screenshot`, with fallback selectors.
- **Plain-language diagnosis in English, Greek and Spanish**: WordPress and PHP fatal errors, lost carts, missing payment methods, failing mail, firewalls, banners in the way, expiring SSL and more. Greek and Spanish reports and alerts translate the common technical messages too.
- **Alerts on change** via Telegram, Discord, Slack, email and webhooks, with screenshots, retried until delivered. The monitor also watches itself: one alert when it cannot run checks, one when it recovers, and `/healthz` answers 503 meanwhile.
- **Dashboard** with history, "run now", password protection and `/healthz`; **self-contained, white-label HTML reports**.
- **`journeyguard check <url>`**: checks any site once with no setup, never sends a message, results in Greek for `.gr`/`.cy` sites.
- **Guided setup** (`init`) in English, Greek or Spanish: detects WooCommerce, Shopify and WordPress from the site's code, checks that the contact page really has a form, finds your Telegram chat by itself, sends a test alert and writes `journeyguard.yml` plus a private `.env` with a generated dashboard password.
- `validate`, `test-alerts`, `detect`, and `demo` with a built-in shop that can be broken in 14 different ways.
- **Docker image** (Debian slim with the headless Chromium shell, about 900 MB, amd64 and arm64), Compose file, CI and release workflows.

### Safety and false alarms
- **Safe mode on by default**: an in-page guard refuses order and payment clicks, Enter in checkout fields and scripted order submissions, including custom buttons, web components and shadow DOM, in English and Greek with or without accents. A network backstop blocks order and payment requests (WooCommerce, Shopify, OpenCart, PrestaShop, Magento, Stripe, PayPal) even if a click slips through. Never blocks choosing a payment method; fails closed.
- **Not tested, not broken**: firewall block pages, CAPTCHAs (including Divi's maths question), anti-spam and anti-robot answers ("Επιβεβαιώστε ότι δεν είστε ρομπότ"), free orders and products whose options load on demand are reported as *not tested* with a hint, never as outages, and never count as recoveries.
- **Cookie banners and pop-ups** are closed like a visitor would, always choosing "necessary only".
- Error text only counts on real error pages; PHP errors are found anywhere on the page; sites that merely mention WooCommerce are not mistaken for shops; the right contact form is picked and a sent contact form is never retried.
- Watchdog for frozen pages and frames and a deadline per step; the scheduler survives errors and storage failures; `run` and `check` exit with 1 when a journey fails and 2 when nothing could be checked.
- The dashboard refuses to run on a public address without a strong password; "run now" is protected against cross-site requests; strict Content Security Policy. Extra headers are only sent to the monitored site.

[Unreleased]: https://github.com/nxdpro/journeyguard/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/nxdpro/journeyguard/releases/tag/v0.1.0
