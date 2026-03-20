/**
 * Enhanced Footer component with HUD status line.
 *
 * Wraps the original Gemini CLI Footer rendering logic and appends
 * a HUD information bar below it, showing:
 *   - Model name
 *   - Context usage progress bar
 *   - Token breakdown (input / output / cached)
 *   - Tool call count
 *   - Git branch
 *   - Session duration
 */

import { jsx as _jsx, jsxs as _jsxs } from 'react/jsx-runtime';
import { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';

// ---------- Re-import everything the original Footer uses ----------
// These are resolved relative to the *original* gemini-cli install
// because our loader only intercepts Footer.js itself.

import { theme } from '@google/gemini-cli/dist/src/ui/semantic-colors.js';
import {
  shortenPath,
  tildeifyPath,
  getDisplayString,
} from '@google/gemini-cli-core';
import { ConsoleSummaryDisplay } from '@google/gemini-cli/dist/src/ui/components/ConsoleSummaryDisplay.js';
import { MemoryUsageDisplay } from '@google/gemini-cli/dist/src/ui/components/MemoryUsageDisplay.js';
import { ContextUsageDisplay } from '@google/gemini-cli/dist/src/ui/components/ContextUsageDisplay.js';
import { QuotaDisplay } from '@google/gemini-cli/dist/src/ui/components/QuotaDisplay.js';
import { DebugProfiler } from '@google/gemini-cli/dist/src/ui/components/DebugProfiler.js';
import { isDevelopment } from '@google/gemini-cli/dist/src/utils/installationInfo.js';
import { useUIState } from '@google/gemini-cli/dist/src/ui/contexts/UIStateContext.js';
import { useConfig } from '@google/gemini-cli/dist/src/ui/contexts/ConfigContext.js';
import { useSettings } from '@google/gemini-cli/dist/src/ui/contexts/SettingsContext.js';
import { useVimMode } from '@google/gemini-cli/dist/src/ui/contexts/VimModeContext.js';
import process from 'node:process';

// ---------- HUD config ----------

const DEFAULT_HUD_CONFIG = {
  colors: {
    barFilled: 'cyan',
    barEmpty: 'gray',
    label: 'gray',
    value: 'white',
    separator: 'gray',
    modelName: 'green',
    warning: 'yellow',
    danger: 'red',
  },
  barWidth: 20,
  contextMaxTokens: 1_000_000, // Gemini default 1M
  showGitBranch: true,
  showSessionDuration: true,
  showTokenBreakdown: true,
  showToolCalls: true,
};

function loadHudConfig() {
  const rcPath = join(homedir(), '.gemini-hudrc');
  try {
    if (existsSync(rcPath)) {
      const raw = readFileSync(rcPath, 'utf8');
      const userConfig = JSON.parse(raw);
      return {
        ...DEFAULT_HUD_CONFIG,
        ...userConfig,
        colors: { ...DEFAULT_HUD_CONFIG.colors, ...(userConfig.colors || {}) },
      };
    }
  } catch {
    // ignore parse errors, use defaults
  }
  return DEFAULT_HUD_CONFIG;
}

const hudConfig = loadHudConfig();

// ---------- Session data reader ----------

function getLatestSessionData() {
  try {
    const tmpDir = join(homedir(), '.gemini', 'tmp');
    if (!existsSync(tmpDir)) return null;

    // Find most recently modified session JSON across project dirs
    let latestFile = null;
    let latestMtime = 0;

    const projectDirs = readdirSync(tmpDir, { withFileTypes: true });
    for (const dir of projectDirs) {
      if (!dir.isDirectory()) continue;
      const chatsDir = join(tmpDir, dir.name, 'chats');
      if (!existsSync(chatsDir)) continue;

      const files = readdirSync(chatsDir).filter((f) =>
        f.startsWith('session-') && f.endsWith('.json')
      );
      for (const f of files) {
        const fp = join(chatsDir, f);
        try {
          const mtime = statSync(fp).mtimeMs;
          if (mtime > latestMtime) {
            latestMtime = mtime;
            latestFile = fp;
          }
        } catch {
          // skip
        }
      }
    }

    if (!latestFile) return null;

    const raw = readFileSync(latestFile, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function countToolCalls(sessionData) {
  if (!sessionData || !Array.isArray(sessionData.messages)) return 0;
  let count = 0;
  for (const msg of sessionData.messages) {
    if (msg.role === 'model' && Array.isArray(msg.parts)) {
      for (const part of msg.parts) {
        if (part.functionCall) count++;
      }
    }
  }
  return count;
}

function getTokensFromSession(sessionData) {
  if (!sessionData || !sessionData.usageMetadata) {
    return { input: 0, output: 0, cached: 0 };
  }
  const m = sessionData.usageMetadata;
  return {
    input: m.promptTokenCount || 0,
    output: m.candidatesTokenCount || 0,
    cached: m.cachedContentTokenCount || 0,
  };
}

// ---------- Git branch ----------

function getGitBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', {
      encoding: 'utf8',
    }).trim();
  } catch {
    return '';
  }
}

// ---------- Formatters ----------

function formatTokenCount(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

// ---------- Progress bar component ----------

function ProgressBar({ ratio, width, filledColor, emptyColor }) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(clamped * width);
  const empty = width - filled;

  const barColor =
    clamped >= 0.9
      ? hudConfig.colors.danger
      : clamped >= 0.7
        ? hudConfig.colors.warning
        : filledColor;

  return _jsxs(Text, {
    children: [
      _jsx(Text, { color: 'gray', children: '[' }),
      _jsx(Text, { color: barColor, children: '█'.repeat(filled) }),
      _jsx(Text, { color: emptyColor, children: '░'.repeat(empty) }),
      _jsx(Text, { color: 'gray', children: ']' }),
    ],
  });
}

// ---------- HUD line component ----------

function HudLine({ promptTokenCount, model, terminalWidth }) {
  const [sessionData, setSessionData] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef(Date.now());

  // Periodically refresh session data & elapsed time
  useEffect(() => {
    const tick = () => {
      setElapsed(Date.now() - startTimeRef.current);
      setSessionData(getLatestSessionData());
    };
    tick(); // initial
    const id = setInterval(tick, 3000);
    return () => clearInterval(id);
  }, []);

  const c = hudConfig.colors;
  const tokens = sessionData ? getTokensFromSession(sessionData) : null;
  const toolCalls = sessionData ? countToolCalls(sessionData) : 0;
  const gitBranch = hudConfig.showGitBranch ? getGitBranch() : '';

  // Context usage ratio
  const contextRatio = promptTokenCount
    ? promptTokenCount / hudConfig.contextMaxTokens
    : 0;

  const sep = _jsx(Text, { color: c.separator, children: ' │ ' });

  const parts = [];

  // Model
  parts.push(
    _jsxs(Text, {
      key: 'model',
      children: [
        _jsx(Text, { color: c.label, children: '⚡' }),
        _jsx(Text, { color: c.modelName, children: getDisplayString(model) }),
      ],
    })
  );

  // Context bar
  parts.push(sep);
  parts.push(
    _jsxs(Box, {
      key: 'ctx',
      children: [
        _jsx(Text, { color: c.label, children: 'CTX ' }),
        _jsx(ProgressBar, {
          ratio: contextRatio,
          width: hudConfig.barWidth,
          filledColor: c.barFilled,
          emptyColor: c.barEmpty,
        }),
        _jsx(Text, {
          color: c.value,
          children: ` ${(contextRatio * 100).toFixed(0)}%`,
        }),
      ],
    })
  );

  // Token breakdown
  if (hudConfig.showTokenBreakdown && tokens) {
    parts.push(sep);
    parts.push(
      _jsxs(Text, {
        key: 'tokens',
        children: [
          _jsx(Text, { color: c.label, children: 'IN:' }),
          _jsx(Text, { color: c.value, children: formatTokenCount(tokens.input) }),
          _jsx(Text, { color: c.label, children: ' OUT:' }),
          _jsx(Text, { color: c.value, children: formatTokenCount(tokens.output) }),
          tokens.cached > 0 &&
            _jsxs(Text, {
              children: [
                _jsx(Text, { color: c.label, children: ' CACHE:' }),
                _jsx(Text, { color: c.value, children: formatTokenCount(tokens.cached) }),
              ],
            }),
        ],
      })
    );
  }

  // Tool calls
  if (hudConfig.showToolCalls && toolCalls > 0) {
    parts.push(sep);
    parts.push(
      _jsxs(Text, {
        key: 'tools',
        children: [
          _jsx(Text, { color: c.label, children: '🔧' }),
          _jsx(Text, { color: c.value, children: String(toolCalls) }),
        ],
      })
    );
  }

  // Git branch
  if (hudConfig.showGitBranch && gitBranch) {
    parts.push(sep);
    parts.push(
      _jsxs(Text, {
        key: 'git',
        children: [
          _jsx(Text, { color: c.label, children: ' ' }),
          _jsx(Text, { color: c.value, children: gitBranch }),
        ],
      })
    );
  }

  // Session duration
  if (hudConfig.showSessionDuration) {
    parts.push(sep);
    parts.push(
      _jsxs(Text, {
        key: 'time',
        children: [
          _jsx(Text, { color: c.label, children: '⏱ ' }),
          _jsx(Text, { color: c.value, children: formatDuration(elapsed) }),
        ],
      })
    );
  }

  return _jsx(Box, {
    width: terminalWidth,
    paddingX: 1,
    children: _jsx(Box, { children: parts }),
  });
}

// ---------- Enhanced Footer (exported) ----------

export const Footer = () => {
  const uiState = useUIState();
  const config = useConfig();
  const settings = useSettings();
  const { vimEnabled, vimMode } = useVimMode();

  const {
    model,
    targetDir,
    debugMode,
    branchName,
    debugMessage,
    corgiMode,
    errorCount,
    showErrorDetails,
    promptTokenCount,
    isTrustedFolder,
    terminalWidth,
    quotaStats,
  } = {
    model: uiState.currentModel,
    targetDir: config.getTargetDir(),
    debugMode: config.getDebugMode(),
    branchName: uiState.branchName,
    debugMessage: uiState.debugMessage,
    corgiMode: uiState.corgiMode,
    errorCount: uiState.errorCount,
    showErrorDetails: uiState.showErrorDetails,
    promptTokenCount: uiState.sessionStats.lastPromptTokenCount,
    isTrustedFolder: uiState.isTrustedFolder,
    terminalWidth: uiState.terminalWidth,
    quotaStats: uiState.quota.stats,
  };

  const showMemoryUsage =
    config.getDebugMode() || settings.merged.ui.showMemoryUsage;
  const isFullErrorVerbosity =
    settings.merged.ui.errorVerbosity === 'full';
  const showErrorSummary =
    !showErrorDetails &&
    errorCount > 0 &&
    (isFullErrorVerbosity || debugMode || isDevelopment);
  const hideCWD = settings.merged.ui.footer.hideCWD;
  const hideSandboxStatus = settings.merged.ui.footer.hideSandboxStatus;
  const hideModelInfo = settings.merged.ui.footer.hideModelInfo;
  const hideContextPercentage = settings.merged.ui.footer.hideContextPercentage;
  const pathLength = Math.max(20, Math.floor(terminalWidth * 0.25));
  const displayPath = shortenPath(tildeifyPath(targetDir), pathLength);
  const justifyContent =
    hideCWD && hideModelInfo ? 'center' : 'space-between';
  const displayVimMode = vimEnabled ? vimMode : undefined;
  const showDebugProfiler = debugMode || isDevelopment;

  // ---------- Original Footer ----------
  const originalFooter = _jsxs(Box, {
    justifyContent,
    width: terminalWidth,
    flexDirection: 'row',
    alignItems: 'center',
    paddingX: 1,
    children: [
      (showDebugProfiler || displayVimMode || !hideCWD) &&
        _jsxs(Box, {
          children: [
            showDebugProfiler && _jsx(DebugProfiler, {}),
            displayVimMode &&
              _jsxs(Text, {
                color: theme.text.secondary,
                children: ['[', displayVimMode, '] '],
              }),
            !hideCWD &&
              _jsxs(Text, {
                color: theme.text.primary,
                children: [
                  displayPath,
                  branchName &&
                    _jsxs(Text, {
                      color: theme.text.secondary,
                      children: [' (', branchName, '*)'],
                    }),
                ],
              }),
            debugMode &&
              _jsx(Text, {
                color: theme.status.error,
                children: ' ' + (debugMessage || '--debug'),
              }),
          ],
        }),
      !hideSandboxStatus &&
        _jsx(Box, {
          flexGrow: 1,
          alignItems: 'center',
          justifyContent: 'center',
          display: 'flex',
          children:
            isTrustedFolder === false
              ? _jsx(Text, {
                  color: theme.status.warning,
                  children: 'untrusted',
                })
              : process.env['SANDBOX'] &&
                  process.env['SANDBOX'] !== 'sandbox-exec'
                ? _jsx(Text, {
                    color: 'green',
                    children: process.env['SANDBOX'].replace(
                      /^gemini-(?:cli-)?/,
                      ''
                    ),
                  })
                : process.env['SANDBOX'] === 'sandbox-exec'
                  ? _jsxs(Text, {
                      color: theme.status.warning,
                      children: [
                        'macOS Seatbelt',
                        ' ',
                        _jsxs(Text, {
                          color: theme.text.secondary,
                          children: ['(', process.env['SEATBELT_PROFILE'], ')'],
                        }),
                      ],
                    })
                  : _jsxs(Text, {
                      color: theme.status.error,
                      children: [
                        'no sandbox',
                        terminalWidth >= 100 &&
                          _jsx(Text, {
                            color: theme.text.secondary,
                            children: ' (see /docs)',
                          }),
                      ],
                    }),
        }),
      !hideModelInfo &&
        _jsxs(Box, {
          alignItems: 'center',
          justifyContent: 'flex-end',
          children: [
            _jsxs(Box, {
              alignItems: 'center',
              children: [
                _jsxs(Text, {
                  color: theme.text.primary,
                  children: [
                    _jsx(Text, {
                      color: theme.text.secondary,
                      children: '/model ',
                    }),
                    getDisplayString(model),
                    !hideContextPercentage &&
                      _jsxs(Box, {
                        children: [
                          ' ',
                          _jsx(ContextUsageDisplay, {
                            promptTokenCount,
                            model,
                            terminalWidth,
                          }),
                        ],
                      }),
                    quotaStats &&
                      _jsxs(Box, {
                        children: [
                          ' ',
                          _jsx(QuotaDisplay, {
                            remaining: quotaStats.remaining,
                            limit: quotaStats.limit,
                            resetTime: quotaStats.resetTime,
                            terse: true,
                          }),
                        ],
                      }),
                  ],
                }),
                showMemoryUsage && _jsx(MemoryUsageDisplay, {}),
              ],
            }),
            _jsxs(Box, {
              alignItems: 'center',
              children: [
                corgiMode &&
                  _jsx(Box, {
                    paddingLeft: 1,
                    flexDirection: 'row',
                    children: _jsxs(Text, {
                      children: [
                        _jsx(Text, { color: theme.ui.symbol, children: '| ' }),
                        _jsx(Text, {
                          color: theme.status.error,
                          children: '▼',
                        }),
                        _jsx(Text, {
                          color: theme.text.primary,
                          children: "(´",
                        }),
                        _jsx(Text, {
                          color: theme.status.error,
                          children: 'ᴥ',
                        }),
                        _jsx(Text, {
                          color: theme.text.primary,
                          children: '`)',
                        }),
                        _jsx(Text, {
                          color: theme.status.error,
                          children: '▼',
                        }),
                      ],
                    }),
                  }),
                showErrorSummary &&
                  _jsxs(Box, {
                    paddingLeft: 1,
                    flexDirection: 'row',
                    children: [
                      _jsx(Text, {
                        color: theme.ui.comment,
                        children: '| ',
                      }),
                      _jsx(ConsoleSummaryDisplay, { errorCount }),
                    ],
                  }),
              ],
            }),
          ],
        }),
    ],
  });

  // ---------- Combined: original + HUD ----------
  return _jsxs(Box, {
    flexDirection: 'column',
    width: terminalWidth,
    children: [
      originalFooter,
      _jsx(HudLine, { promptTokenCount, model, terminalWidth }),
    ],
  });
};
