# Contributing to JourneyGuard

Thanks for helping small businesses catch broken checkouts and forms before their customers do.

## Ways to help

- **Report a false alarm or a missed failure.** These are the most valuable issues. Include the platform, the preset, the dashboard error and, if you can, the screenshot.
- **Request or build a preset** for a platform (PrestaShop, OpenCart, Magento, Wix, Squarespace, booking systems…).
- **Add diagnosis rules.** If you know what a symptom usually means, add it to [`src/diagnose.ts`](src/diagnose.ts) in English and Greek.
- **Translate** dashboard, alerts and diagnosis into another language ([`src/i18n.ts`](src/i18n.ts), [`src/presets/options.ts`](src/presets/options.ts)).
- **Improve the docs**, especially setup guides for specific hosts and firewalls.

## Development

```bash
git clone https://github.com/nxdpro/journeyguard && cd journeyguard
npm install
npx playwright install chromium
npm test                     # builds, then runs unit + end-to-end tests against the bundled demo shop
npm run demo                 # try your changes interactively
```

The code is TypeScript (ES modules, Node 22+). Useful places:

| Path | What lives there |
|---|---|
| `src/presets/` | Preset journeys (`website`, `woocommerce`, `shopify`, `contact-form`) |
| `src/steps.ts` | YAML step actions |
| `src/runner.ts` | Browser session, evidence capture, retries |
| `src/diagnose.ts` | Plain-language hints (EN/EL) |
| `src/alerts/` | Telegram, Discord, Slack, email, webhook |
| `src/demo/shop.ts` | Demo shop with break modes, used by tests and `journeyguard demo` |
| `test/` | `node:test` suites |

## Rules of thumb

1. **Every new failure you detect gets a demo-shop break mode and an end-to-end test.** That is how we keep false alarms out.
2. **Safety first.** Nothing may place an order, take a payment or bypass a CAPTCHA by default.
3. **Plain language.** Messages are read by shop owners, not only developers. Say what is broken and what to do.
4. Keep dependencies few. Ask in an issue before adding one.

## Pull requests

- One topic per PR, with a short description of the user-visible change.
- `npm test` must pass. CI runs it on Node 22, 24 and 26 and builds the Docker image (amd64 and arm64).
- Add a line to `CHANGELOG.md` under *Unreleased*.

## Releasing (maintainers)

1. Set the new version in `package.json` (`npm version 0.2.0 --no-git-tag-version`) and move the *Unreleased* notes in `CHANGELOG.md` under `## [0.2.0] - <date>`.
2. Merge to `main` and wait for CI.
3. Actions → **Release** → **Run workflow**. It tests again, tags `v0.2.0`, publishes the Docker image (and npm, when `NPM_TOKEN` is set) and creates the GitHub release with the changelog section as notes. Pushing a `v0.2.0` tag does the same. Versions with a suffix such as `0.2.0-beta.1` become pre-releases and never move `latest`.

By contributing you agree that your contribution is licensed under the MIT license, and you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
