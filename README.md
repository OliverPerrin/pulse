# Pulse

A local-first macOS desktop app and usage dashboard for Codex, Claude Code, Command Code, Cursor, and OpenCode.

## Run the local dashboard

```bash
cd pulse
npm start
```

Then open <http://127.0.0.1:5173>.

The marketing/download site is available locally at <http://127.0.0.1:5173/marketing/> and in production at <https://usagepulse.vercel.app>.

## Repository and license

Pulse is maintained as one monorepo at <https://github.com/OliverPerrin/pulse>. The Electron app and marketing site deliberately share versioning, icon assets, screenshots, and release links. The source is MIT licensed; see [`LICENSE`](LICENSE).

## Run the desktop app

```bash
cd pulse
npm install
npm run desktop
```

Pulse opens the full dashboard in a native Electron window and keeps a menu-bar item alive when the main window closes. The menu-bar title shows the current limit percentages for every configured Codex account (`C1`, `C2`, and `C3`). Clicking it opens a compact per-account view with every active window, remaining percentage, reset time, warnings, balances, costs, tokens, and sync health. Right-click it to open Pulse, force a sync, control launch-at-login, or quit.

The desktop renderer is sandboxed, has Node integration disabled, and communicates through a narrow preload bridge. Packaged builds use a loopback-only server on port `5187`; `npm run desktop` uses its own development profile and port `5188`, so it can launch even while an installed build exists. Both fall back to an available ephemeral port if necessary. The regular `npm start` server remains independent on port `5173`.

For normal daily use, mount the DMG and drag `Pulse.app` into `/Applications`. This lets macOS register the bundle and bundled icon normally. Quit an older Pulse process before replacing an existing copy. Keep `npm run desktop` for source development.

## Verify and package macOS

```bash
npm run desktop:smoke
npm run desktop:pack
npm run desktop:dist
```

The Apple-silicon DMG is written to `release/Pulse-0.1.5-arm64.dmg`. This local build is ad-hoc signed without an Apple developer account; trusted public distribution still needs an Apple Developer ID certificate and notarization. The installed app starts its own loopback server. Its dashboard assets are bundled directly from the same source used by `npm start`.

Verify the packaged app with `release/mac-arm64/Pulse.app/Contents/MacOS/Pulse --smoke-test` (unset `ELECTRON_RUN_AS_NODE` if your terminal sets it). This checks the live API, both renderer surfaces, decoded dashboard images, and exits nonzero on failures.

Versioned DMGs are attached to private GitHub Releases rather than committed to Git or bundled into the Vercel deployment. The current private release link requires GitHub access to the repository.

## Automatic local updates after a push

On your Apple silicon Mac, enable the per-user updater once:

```bash
npm run updater:enable
```

It checks GitHub `main` every 60 seconds while you are logged in, including pushes made through T3 or another computer. A sleeping/offline Mac catches up on a later check. Rapid successive pushes may be coalesced to the latest commit. Updates are tracked by Git commit, so you do not need to bump the package version for each push; even website-only commits trigger a fresh local build. No Apple developer account is needed.

The updater keeps a private checkout under `~/Library/Application Support/Pulse Updater`; it never checks out, resets, or installs uncommitted changes from your working repository. For each new commit it runs `npm ci`, the tests, an ad-hoc-signed app build, signature verification, and packaged smoke checks. It then replaces `/Applications/Pulse.app` and verifies the installed copy. If Pulse was running, it reopens it and waits for a real dashboard/usage acknowledgement. A closed app stays closed. A failed replacement/startup restores the previous bundle. Preferences and account files are never replaced.

```bash
npm run updater:status   # Last check, installed commit, and any error
npm run updater:check    # Check immediately (also works with the agent disabled)
npm run updater:disable # Stop automatic checks
```

The LaunchAgent is `~/Library/LaunchAgents/com.usagepulse.updater.plist`. Logs and the transaction journal are in the updater's Application Support directory; the last rollback bundle is `/Applications/.PulseUpdater/previous.app`. Checks are locked against concurrent installs and failed commits retry with backoff. Disable automatic updates before manually restoring a rollback bundle, otherwise the latest commit will be installed again.

This uses your existing GitHub credentials and Node/npm installation. The runner is copied to Application Support when enabled, so edits to local updater code do not silently change the background job. Run `updater:enable` again after changing the updater itself or moving Node/npm. The first check rebuilds the current remote commit to establish an installation receipt.

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

## Polling and caching

Both desktop surfaces — the main window and the menu-bar popover — poll `/api/usage` independently, so the server memoises each source for slightly less than one poll interval and collapses concurrent requests onto a single pass. The defaults can be overridden with environment variables:

| Variable | Default | Covers |
| --- | --- | --- |
| `PULSE_SNAPSHOT_TTL_MS` | `4000` | The assembled snapshot, including de-duplication of simultaneous requests |
| `PULSE_CODEX_TTL_MS` | `10000` | The three `codex app-server` rate-limit and usage probes |
| `PULSE_OPENCODE_TTL_MS` | `60000` | The `opencode stats` invocation |

Transcripts are streamed and pre-filtered on raw bytes rather than read into memory, so a multi-hundred-megabyte Codex rollout costs a bounded amount of memory to scan. Command Code transcripts are parsed once per file and reused until the file's size or mtime changes. Dashboard assets are served with an `ETag`, so a reload revalidates instead of re-downloading.

A surface that is off screen keeps polling and keeps the menu-bar title current, but defers rebuilding its dashboard markup until it becomes visible again.

The subscription command center shows each Codex account’s tightest reported allowance, every usage window, local reset times, credits, and snapshot freshness. Missing or expired allowances stay unreported. Other providers show only the plan and allowance metadata available locally; limits are never inferred from estimated API cost. Overall totals and daily series are recomputed from the selected 7/30/90-day or lifetime provider snapshot on every sync.

## Dashboard visuals

The full dashboard includes account gauges and an upcoming reset timeline, actual daily usage sparklines, a daily activity heatmap, provider-share donut, and token composition chart. Cost/token and date-range controls drive the usage views; subscription windows stay tied to the current provider snapshot. The heatmap shows at most 90 daily records and labels longer ranges. Model and daily breakdowns share provider and text filters.

Run `npm test` for quota, reset, missing-data, cache, and desktop-bridge regressions. Run `npm run desktop:smoke` to verify both Electron surfaces against a real local snapshot.

Claude subscription names are read from `claude auth status --json` and refreshed once per minute. Only plan and connection metadata reach the dashboard; quota windows remain independently reported.
