# Security policy

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private reporting instead: **Security → Report a vulnerability** on this repository, or email [info@nxdpro.com](mailto:info@nxdpro.com?subject=JourneyGuard%20security) with "JourneyGuard security" in the subject. We acknowledge reports within 3 working days and aim to ship a fix for confirmed issues within 30 days, crediting you unless you prefer otherwise.

## Supported versions

Security fixes go to the latest minor release.

## Scope notes

- `journeyguard start` refuses to serve the dashboard on a non-local address without a password of at least 10 characters (`JOURNEYGUARD_PASSWORD`). Running it with `--allow-no-password` on a public address is a configuration choice, not a vulnerability; a way to reach the dashboard or trigger checks without the password **is** in scope.
- Journey files can contain credentials (via environment variables) and screenshots can contain page content: treat `journeyguard.yml` and `dataDir` as sensitive.
- Safe-mode bypasses (any way a default preset could place an order or take a payment) **are** in scope and treated as high severity.
