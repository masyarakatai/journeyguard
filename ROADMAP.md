# Roadmap

Priorities follow user feedback: 👍 the issues you care about, or open one.

## v0.2 — Trust the results
- Inbox verification for forms over IMAP (did the email actually arrive?)
- Presets: PrestaShop, OpenCart; WooCommerce variable-product hardening
- Alerts per site (send each client's alerts to that client); reminder alerts for long outages; quiet hours
- Maintenance windows (pause checks during deploys)
- Warn when a payment method seen in recent runs disappears, without listing it in `expectPayments`
- A GitHub Action, so small shops can run checks on a schedule without a server

## v0.3 — Explain more
- Optional AI diagnosis with your own API key (local-first, off by default)
- Visual change detection for key pages
- Performance budgets (alert when checkout gets slower than N seconds)
- Journey recorder: click through your site once, get the YAML

## v0.4 — Teams and agencies
- Multi-user dashboard with roles
- Public status page per site
- Agency workspaces, scheduled PDF reports to clients

## Ideas under discussion
- Magento and Wix presets
- Greek-market checks: Skroutz/BestPrice product feeds, shipping methods for a test postcode (ACS, BOX NOW, ΕΛΤΑ)
- A mobile-viewport journey
- Login journeys with TOTP test accounts
- Checking from multiple locations
