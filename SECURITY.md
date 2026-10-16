# Security

Report vulnerabilities using [GitHub private vulnerability reporting](https://github.com/OliverPerrin/pulse/security/advisories/new). Include the affected version or commit, reproduction steps with synthetic data, and expected impact. Do not open a public issue containing exploit details, tokens, transcripts, or account data.

Security fixes target the current `main` branch. Older preview binaries may not contain those fixes; there is no guaranteed response time or support window.

Pulse reads local coding-tool usage and invokes installed CLIs using their existing authentication. Its unauthenticated API is intended only for loopback access on a trusted machine. Do not bind or proxy it to a public network. The marketing site is static and must never include local telemetry.

Desktop previews are ad-hoc signed and not Apple-notarized. The optional local updater builds and runs code from `main`; enabling it means trusting future changes on that branch. Dependencies retain their own licenses and security policies.
