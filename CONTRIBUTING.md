# Contributing to Pulse

Thanks for helping improve Pulse. Small, focused pull requests are welcome. For larger changes or new provider adapters, open an issue describing the use case first.

## Development

Use Node.js 24 or newer. Clone the repository, run `npm ci`, then `npm start` for the browser dashboard or `npm run desktop` on macOS. The server prints its local URL. See the README for provider sign-in and historical cache requirements; no provider credentials are needed to run the automated tests.

- `npm test` runs the regression suite using synthetic fixtures.
- `npm run site:build` builds the static website into `site-dist/`.
- `npm run desktop:smoke` checks the main window and tray on a Mac with a graphical session. It reads local usage; do not attach raw output containing personal data.
- `npm run desktop:pack` builds an Apple silicon app on macOS.

The server and adapters are in `server.mjs` and `claude-*.mjs`; the shared dashboard is in `app.js`, `index.html`, and the stylesheets. `desktop/` owns Electron integration, `marketing/` the website, and `scripts/` packaging support and the opt-in local updater.

## Pull requests

1. Create a branch from `main` and keep the change focused.
2. Add regression coverage for changed parsing, aggregation, or security behavior. Use invented data, not personal transcripts.
3. Run `npm test` and `npm run site:build`. For desktop changes, also run the macOS smoke check and state your platform.
4. Explain the problem, resulting behavior, checks performed, and any limitations. Include screenshots for visual changes with accounts and usage anonymized.

Missing telemetry must remain unknown. Do not invent quota, token, plan, or cost values. Keep provider-reported limits separate from estimated API costs, preserve explicit zeroes, and deduplicate repeated transcript records. Never log credentials or include authentication files, session transcripts, local caches, or private account data in commits or issues.

Do not expose the loopback API publicly or expand the Electron preload bridge without explaining the security implications. Use pull-request CI for untrusted contributions; never run contributor code with release credentials.

## Community and licensing

Be respectful, constructive, and specific. Harassment and sharing another person's private information are not welcome. Maintainers may remove harmful content or close abusive discussions.

By submitting a contribution, you agree to license it under this repository's MIT license. Only submit work you have the right to contribute and retain required third-party notices. No separate contributor license agreement is required.

Report security concerns through the private process in [SECURITY.md](SECURITY.md), not a public issue.
