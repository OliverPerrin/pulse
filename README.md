# Pulse

A local-first macOS desktop app and usage dashboard for Codex, Claude Code, Command Code, Cursor, and OpenCode.

## Run the local dashboard

```bash
cd usage-dashboard
npm start
```

Then open <http://127.0.0.1:5173>.

The marketing/download site is available at <http://127.0.0.1:5173/marketing/>.

## Repository and license

Pulse is maintained as one monorepo at <https://github.com/OliverPerrin/pulse>. The Electron app and marketing site deliberately share versioning, icon assets, screenshots, and release links. The source is MIT licensed; see [`LICENSE`](LICENSE).

## Run the desktop app

```bash
cd usage-dashboard
npm install
npm run desktop
```

Pulse opens the full dashboard in a native Electron window and keeps a menu-bar item alive when the main window closes. The menu-bar title shows the current limit percentages for every configured Codex account (`C1`, `C2`, and `C3`). Clicking it opens a compact per-account view with every active window, remaining percentage, reset time, warnings, balances, costs, tokens, and sync health. Right-click it to open Pulse, force a sync, control launch-at-login, or quit.

The desktop renderer is sandboxed, has Node integration disabled, and communicates through a narrow preload bridge. It starts its own loopback-only server on port `5187`, falling back to an available ephemeral port if necessary. The regular `npm start` server remains independent on port `5173`.

## Verify and package macOS

```bash
npm run desktop:smoke
npm run desktop:pack
npm run desktop:dist
```

The Apple-silicon DMG is written to `release/Pulse-0.1.0-arm64.dmg`. This development artifact is intentionally unsigned; production distribution still needs an Apple Developer ID certificate and notarization.

Versioned DMGs are attached to private GitHub Releases rather than committed to Git or bundled into the Vercel deployment. The current private release link requires GitHub access to the repository.

## Build and host the marketing site

```bash
npm run site:build
```

This emits a dependency-free static site to `site-dist/`. The root `vercel.json` sets the build command and output directory, so importing the private GitHub repository into Vercel is sufficient to enable preview and production deployments. Vercel authentication and GitHub-app access must be completed by the Vercel account owner.

## Product boundaries

Pulse currently includes the existing account, model, history, token, cost, credit, and limit views. It does not add cloud accounts, teams, agent management, or thread handoffs. macOS is the supported desktop target for this first build; Windows and Linux packaging can be added after the macOS behavior is settled.

## Local data behavior

The server only reads local session metadata and aggregate usage statistics. It does not expose authentication files or tokens. Codex and Claude records are aggregated from the local T3 transcript cache and priced with the same LiteLLM per-model rate table and cache arithmetic used by T3 Code. The result is an API cost estimate, not subscription spend. Command Code is aggregated from structured local transcripts, and OpenCode is queried through its read-only `stats` command. Cursor stays visible as a connected adapter but contributes no fabricated tokens or cost because its local ACP metadata does not expose usage totals.

Codex account windows and range usage are read directly from every configured `CODEX_HOME` through the CLI app-server's read-only `account/rateLimits/read` and `account/usage/read` methods. The default homes are displayed as `.codex`, `.codex-alt`, and `.codex-alt2`, while the filesystem paths remain server-side. Pulse reconciles those three account totals with locally priced transcripts and includes any account-reported usage missing from the transcript scan, using the observed blended model rate only for that uncovered remainder.

Rate limits and account usage arrive through separate CLI responses. Pulse caches the last valid response for each channel for up to 24 hours, so a transient partial poll cannot turn a populated account into zero usage; cached values are explicitly labeled in the interface until a fresh snapshot returns.

The Limits & windows section is adapter-shaped for provider-reported 5-hour, weekly, and 30-day windows. Other providers use the separated preview blueprint until they expose a local limit endpoint; Codex rows show an `Exact snapshot` badge when the CLI returns a live rate-limit response. Overall totals and daily series are recomputed from the selected 7/30/90-day or lifetime provider snapshot on every sync.
