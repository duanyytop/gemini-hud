# gemini-hud

HUD status bar embedded directly in Gemini CLI's footer — no extra panes, no tmux required.

Uses Node.js ESM Loader Hooks to intercept and enhance Gemini CLI's Footer component at runtime.

![gemini-hud screenshot](assets/gemini-hud.png)

## Features

- **Context Warning**: Flashing color alert when context usage exceeds 90% (auto-detects 1M/2M limits).
- **Sub-agents Tracking**: Real-time spinner and task count for active background agents (like `codebase-investigator`).
- **Precision Session Binding**: Uses `sessionId` to precisely match session data, supporting multiple parallel CLI instances.
- **Estimated Cost**: Real-time USD cost calculation based on model rates and token usage.
- **Enhanced Git Info**: Displays branch name with dirty state (`*`) and sync status (`↑ahead/↓behind`).
- **Performance Optimized**: Cached session reading with `mtime` checks — lag-free even with 2M+ token history.
- **Live Shortcut Tips**: Rotating productivity tips (e.g., `/? help`, `/copy code`) on the right side.

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
  "contextMaxTokens": 1000000,
  "showGitBranch": true,
  "showSessionDuration": true,
  "showTokenBreakdown": true,
  "showToolCalls": true,
  "showEstimatedCost": true
}
```

All fields are optional — defaults apply for anything omitted.

## How It Works

1. **`register.mjs`** — Registers the ESM loader hook via `node:module.register()`.
2. **`loader.mjs`** — Intercepts the `resolve` phase; when `Footer.js` from `@google/gemini-cli` is loaded, redirects to our `hud-footer.mjs`.
3. **`hud-footer.mjs`** — Renders the original Footer (preserving all functionality) plus an additional HUD line below it.
4. **`bin/gemini-hud`** — Cross-platform launcher: `node --import register.mjs $(which gemini) "$@"`

## Data Sources

| Info | Source |
|------|--------|
| Model name | `uiState.currentModel` (via Footer props) |
| Context % | `max(uiState.lastPrompt, session.input) / modelLimit` |
| Token breakdown | `~/.gemini/tmp/<project>/chats/session-<id>.json` (cached) |
| Active Tasks | `uiState.activeTasks` (Sub-agents status) |
| Git status | `git status --porcelain` & `git rev-list --count` |

## Compatibility

- **Node.js**: >= 20 (ESM loader hooks).
- **Gemini CLI**: >= 0.34.0 (column-based Footer).
- **Platforms**: macOS, Linux, Windows.

## License

MIT
