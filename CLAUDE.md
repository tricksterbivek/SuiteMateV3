# SuiteMate V3 — Project Rules

## Browser automation

- For SuiteMate development, ALWAYS use the **Playwright MCP in extension mode** (`mcp__playwright__*` tools), which attaches to the dedicated Chrome profile signed in as **tricksterbirek@gmail.com** ("Trickster bvek" — the secondary account with the r, not the main tricksterbivek one).
- Prefer `browser_snapshot` over screenshots for reading page state.
- NEVER navigate to `chrome://` URLs through the relay — it kills the extension connection (recover with `browser_tabs new`).
- The pairing token lives in `~/.claude.json` → `mcpServers.playwright.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN`. When the browser refreshes its token: update that value, run `/mcp` → reconnect playwright, then retry.
- claude-in-chrome ("Browser 1") is superseded and no longer used for this project.

## Live testing environment (account 9845683-rp)

- ALL live testing and validation runs in the NetSuite **release-preview account 9845683-rp** (owner-directed, 2026-08-07). Entry URL: https://9845683-rp.app.netsuite.com/app/center/card.nl?sc=-29&whence=
- Do NOT test in 6998262 (MCoBeauty production) anymore; its locked validation records (`salesord.nl?id=16342809` / `16365465`) are superseded along with the venue. Never mix the two tenants in one testing flow.
- Read-only discipline still applies to business records unless the owner explicitly directs otherwise: never Save, Approve, Reject, Bill, Fulfill, Email, Print, Delete, or Make Copy.

## Parked features (do NOT resume unless explicitly asked)

- **Drag-and-drop form layout builder** (v3.22.0 state at `0a04764`) is parked on `feature/form-layout-builder`. Do not continue, merge, or build on it until the owner explicitly says so. Main stays on the v3.21.1 line (classic Personal Form Views + schema-2 storage compat).
