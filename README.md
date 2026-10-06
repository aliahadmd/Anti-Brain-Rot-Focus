# Anti-Brain Rot Focus

A Manifest V3 browser extension for Chrome and Edge that blocks distracting sites, shows a calm block page, and rewards focus days with medals. Everything stays in local browser storage; see [PRIVACY.md](PRIVACY.md).

## How it works

- **Blocking.** A `declarativeNetRequest` rule stops blocked domains (and their subdomains) from loading. `webNavigation` then swaps the tab to `blocked.html`. When blocking turns on, a pause ends, or a site is added, tabs already open on blocked sites are redirected too.
- **Redirect mode.** Optionally, blocked visits go to a website you choose instead of the block page (Settings → Redirect Blocked Sites). A target that is itself blocked, or a tab that keeps bouncing back to blocked sites, falls back to the block page.
- **Focus days.** A day counts once it has passed if the browser ran that day with Focus on, at least one site blocked, and no pause, disable, or site removal.
- **Penalties.** Pausing, disabling Focus, or removing a site each cost 3 progress days. Sites added today can be removed for free. Medals already earned are never taken away.
- **Medals.** A regular medal every 10 progress days and a prestige medal every 30.

## Layout

| Path | Role |
|---|---|
| `background.js` | Service worker. The only writer of focus, reward, blocklist, and stats state; pages change state by message. |
| `lib/shared.js` | Constants and helpers shared by the service worker and every page. |
| `lib/engine.js` | Pure reward and stats logic. |
| `popup.*`, `blocked.*`, `options.*` | Toolbar popup, block page, dashboard. |
| `tests/` | `node:test` suites that run the real scripts against an in-memory `chrome` fake. |
| `scripts/` | Packaging and icon generation. |

## Development

Load the folder as an unpacked extension (`chrome://extensions` → Developer mode → Load unpacked).

```bash
npm test
```

```bash
npm run package
```

`npm run package` writes a store-ready zip to `dist/` containing only runtime files.
