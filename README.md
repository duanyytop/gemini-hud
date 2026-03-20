# gemini-hud

HUD status bar embedded directly in Gemini CLI's footer — no extra panes, no tmux required.

Uses Node.js ESM Loader Hooks to intercept and enhance Gemini CLI's Footer component at runtime.

![gemini-hud screenshot](assets/gemini-hud.png)

## Prerequisites

- **Node.js** >= 20
- **Gemini CLI** >= 0.34.0 (`npm install -g @google/gemini-cli`)

## Install

```bash
npm install -g gemini-hud
```

## Usage

```bash
gemini-hud          # launches gemini with HUD
gemini-hud --help   # passes args through to gemini
```

Or manually:

```bash
node --import /path/to/register.mjs $(which gemini)
```

## Configuration

Create `~/.gemini-hudrc` (JSON):

```json
{
  "colors": {
    "barFilled": "cyan",
    "barEmpty": "gray",
    "label": "gray",
    "value": "white",
    "separator": "gray",
    "modelName": "green",
    "warning": "yellow",
    "danger": "red"
  },
  "barWidth": 20,
  "contextMaxTokens": 1000000,
  "showGitBranch": true,
  "showSessionDuration": true,
  "showTokenBreakdown": true,
  "showToolCalls": true
}
```

All fields are optional — defaults apply for anything omitted.

## How It Works

1. **`register.mjs`** — Registers the ESM loader hook via `node:module.register()`
2. **`loader.mjs`** — Intercepts the `resolve` phase; when `Footer.js` from `@google/gemini-cli` is loaded, redirects to our `hud-footer.mjs`
3. **`hud-footer.mjs`** — Renders the original Footer (preserving all functionality) plus an additional HUD line below it
4. **`bin/gemini-hud`** — Cross-platform launcher: `node --import register.mjs $(which gemini) "$@"`

## Data Sources

| Info | Source |
|------|--------|
| Model name | `uiState.currentModel` (via Footer props) |
| Context % | `uiState.sessionStats.lastPromptTokenCount` (via Footer props) |
| Token breakdown | `~/.gemini/tmp/<project>/chats/session-*.json` |
| Tool calls | Session JSON `messages[].parts[].functionCall` |
| Git branch | `git rev-parse --abbrev-ref HEAD` |
| Session duration | Timer started at component mount |

## Compatibility

- **Node.js**: >= 20 (ESM loader hooks)
- **Gemini CLI**: >= 0.34.0 (column-based Footer with `FooterRow`)
- **Platforms**: macOS, Linux, Windows
- **Gemini CLI updates**: If `Footer.js` path changes, update the `FOOTER_PATTERN` regex in `loader.mjs`

## License

MIT
