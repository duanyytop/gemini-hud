/**
 * Enhanced Footer component with HUD status line.
 * Compatible with @google/gemini-cli 0.34.x (column-based Footer + FooterRow).
 *
 * Re-exports FooterRow verbatim and wraps the original Footer with an
 * additional HUD information bar below it.
 */

import { jsx as _jsx, jsxs as _jsxs } from 'react/jsx-runtime';
import { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import process from 'node:process';

// ---------- Re-imports from gemini-cli internals ----------

import { theme } from '@google/gemini-cli/dist/src/ui/semantic-colors.js';
import {
  shortenPath,
  tildeifyPath,
  getDisplayString,
  checkExhaustive,
} from '@google/gemini-cli-core';
import { ConsoleSummaryDisplay } from '@google/gemini-cli/dist/src/ui/components/ConsoleSummaryDisplay.js';
import { MemoryUsageDisplay } from '@google/gemini-cli/dist/src/ui/components/MemoryUsageDisplay.js';
import { ContextUsageDisplay } from '@google/gemini-cli/dist/src/ui/components/ContextUsageDisplay.js';
import { QuotaDisplay } from '@google/gemini-cli/dist/src/ui/components/QuotaDisplay.js';
import { DebugProfiler } from '@google/gemini-cli/dist/src/ui/components/DebugProfiler.js';
import { useUIState } from '@google/gemini-cli/dist/src/ui/contexts/UIStateContext.js';
import { useConfig } from '@google/gemini-cli/dist/src/ui/contexts/ConfigContext.js';
import { useSettings } from '@google/gemini-cli/dist/src/ui/contexts/SettingsContext.js';
import { useVimMode } from '@google/gemini-cli/dist/src/ui/contexts/VimModeContext.js';
import {
  ALL_ITEMS,
  deriveItemsFromLegacySettings,
} from '@google/gemini-cli/dist/src/config/footerItems.js';
import { isDevelopment } from '@google/gemini-cli/dist/src/utils/installationInfo.js';

// =====================================================================
//  FooterRow — exported verbatim so FooterConfigDialog can import it
// =====================================================================

const COLUMN_GAP = 3;

export const FooterRow = ({ items, showLabels }) => {
  const elements = [];
  items.forEach((item, idx) => {
    if (idx > 0) {
      elements.push(
        _jsx(
          Box,
          {
            flexGrow: 1,
            flexShrink: 1,
            minWidth: showLabels ? COLUMN_GAP : 3,
            justifyContent: 'center',
            alignItems: 'center',
            children:
              !showLabels &&
              _jsx(Text, { color: theme.ui.comment, children: ' \u00B7 ' }),
          },
          `sep-${item.key}`
        )
      );
    }
    elements.push(
      _jsxs(
        Box,
        {
          flexDirection: 'column',
          flexGrow: item.flexGrow ?? 0,
          flexShrink: item.flexShrink ?? 1,
          alignItems: item.alignItems,
          backgroundColor: item.isFocused
            ? theme.background.focus
            : undefined,
          children: [
            showLabels &&
              _jsx(Box, {
                height: 1,
                children: _jsx(Text, {
                  color: item.isFocused
                    ? theme.text.primary
                    : theme.ui.comment,
                  children: item.header,
                }),
              }),
            _jsx(Box, { height: 1, children: item.element }),
          ],
        },
        item.key
      )
    );
  });
  return _jsx(Box, {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    width: '100%',
    children: elements,
  });
};

// =====================================================================
//  Original Footer internals (from 0.34.x)
// =====================================================================

const CwdIndicator = ({
  targetDir,
  maxWidth,
  debugMode,
  debugMessage,
  color = theme.text.primary,
}) => {
  const debugSuffix = debugMode ? ' ' + (debugMessage || '--debug') : '';
  const availableForPath = Math.max(10, maxWidth - debugSuffix.length);
  const displayPath = shortenPath(tildeifyPath(targetDir), availableForPath);
  return _jsxs(Text, {
    color,
    children: [
      displayPath,
      debugMode &&
        _jsx(Text, { color: theme.status.error, children: debugSuffix }),
    ],
  });
};

const SandboxIndicator = ({ isTrustedFolder }) => {
  if (isTrustedFolder === false) {
    return _jsx(Text, { color: theme.status.warning, children: 'untrusted' });
  }
  const sandbox = process.env['SANDBOX'];
  if (sandbox && sandbox !== 'sandbox-exec') {
    return _jsx(Text, {
      color: 'green',
      children: sandbox.replace(/^gemini-(?:cli-)?/, ''),
    });
  }
  if (sandbox === 'sandbox-exec') {
    return _jsxs(Text, {
      color: theme.status.warning,
      children: [
        'macOS Seatbelt',
        ' ',
        _jsxs(Text, {
          color: theme.ui.comment,
          children: ['(', process.env['SEATBELT_PROFILE'], ')'],
        }),
      ],
    });
  }
  return _jsx(Text, { color: theme.status.error, children: 'no sandbox' });
};

const CorgiIndicator = () =>
  _jsxs(Text, {
    children: [
      _jsx(Text, { color: theme.status.error, children: '\u25BC' }),
      _jsx(Text, { color: theme.text.primary, children: "(\u00B4" }),
      _jsx(Text, { color: theme.status.error, children: '\u1D25' }),
      _jsx(Text, { color: theme.text.primary, children: '`)' }),
      _jsx(Text, { color: theme.status.error, children: '\u25BC' }),
    ],
  });

function isFooterItemId(id) {
  return ALL_ITEMS.some((i) => i.id === id);
}

// =====================================================================
//  HUD helpers (config, session data, formatters)
// =====================================================================

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
  contextMaxTokens: 1_000_000,
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
    // ignore
  }
  return DEFAULT_HUD_CONFIG;
}

const hudConfig = loadHudConfig();

function getLatestSessionData() {
  try {
    const tmpDir = join(homedir(), '.gemini', 'tmp');
    if (!existsSync(tmpDir)) return null;
    let latestFile = null;
    let latestMtime = 0;
    const projectDirs = readdirSync(tmpDir, { withFileTypes: true });
    for (const dir of projectDirs) {
      if (!dir.isDirectory()) continue;
      const chatsDir = join(tmpDir, dir.name, 'chats');
      if (!existsSync(chatsDir)) continue;
      const files = readdirSync(chatsDir).filter(
        (f) => f.startsWith('session-') && f.endsWith('.json')
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
    return JSON.parse(readFileSync(latestFile, 'utf8'));
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

function getGitBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', {
      encoding: 'utf8',
    }).trim();
  } catch {
    return '';
  }
}

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

// =====================================================================
//  HUD visual components
// =====================================================================

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
      _jsx(Text, { color: barColor, children: '\u2588'.repeat(filled) }),
      _jsx(Text, { color: emptyColor, children: '\u2591'.repeat(empty) }),
      _jsx(Text, { color: 'gray', children: ']' }),
    ],
  });
}

function HudLine({ promptTokenCount, model, terminalWidth }) {
  const [sessionData, setSessionData] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef(Date.now());

  useEffect(() => {
    const tick = () => {
      setElapsed(Date.now() - startTimeRef.current);
      setSessionData(getLatestSessionData());
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => clearInterval(id);
  }, []);

  const c = hudConfig.colors;
  const tokens = sessionData ? getTokensFromSession(sessionData) : null;
  const toolCalls = sessionData ? countToolCalls(sessionData) : 0;
  const gitBranch = hudConfig.showGitBranch ? getGitBranch() : '';
  const contextRatio = promptTokenCount
    ? promptTokenCount / hudConfig.contextMaxTokens
    : 0;

  const sep = _jsx(Text, { color: c.separator, children: ' \u2502 ' });
  const parts = [];

  // Model
  parts.push(
    _jsxs(Text, {
      key: 'model',
      children: [
        _jsx(Text, { color: c.label, children: '\u26A1' }),
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
          _jsx(Text, {
            color: c.value,
            children: formatTokenCount(tokens.input),
          }),
          _jsx(Text, { color: c.label, children: ' OUT:' }),
          _jsx(Text, {
            color: c.value,
            children: formatTokenCount(tokens.output),
          }),
          tokens.cached > 0 &&
            _jsxs(Text, {
              children: [
                _jsx(Text, { color: c.label, children: ' CACHE:' }),
                _jsx(Text, {
                  color: c.value,
                  children: formatTokenCount(tokens.cached),
                }),
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
          _jsx(Text, { color: c.label, children: '\uD83D\uDD27' }),
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
          _jsx(Text, { color: c.label, children: '\uD83C\uDF3F' }),
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
          _jsx(Text, { color: c.label, children: '\u23F1 ' }),
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

// =====================================================================
//  Footer — original 0.34.x logic + HUD line appended below
// =====================================================================

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

  const isFullErrorVerbosity = settings.merged.ui.errorVerbosity === 'full';
  const showErrorSummary =
    !showErrorDetails &&
    errorCount > 0 &&
    (isFullErrorVerbosity || debugMode || isDevelopment);
  const displayVimMode = vimEnabled ? vimMode : undefined;

  const items =
    settings.merged.ui.footer.items ??
    deriveItemsFromLegacySettings(settings.merged);
  const showLabels = settings.merged.ui.footer.showLabels !== false;
  const itemColor = showLabels ? theme.text.primary : theme.ui.comment;

  const potentialColumns = [];
  const addCol = (id, header, element, dataWidth, isHighPriority = false) => {
    potentialColumns.push({
      id,
      header: showLabels ? header : '',
      element,
      width: Math.max(dataWidth, showLabels ? header.length : 0),
      isHighPriority,
    });
  };

  // 1. System Indicators
  if (uiState.showDebugProfiler) {
    addCol('debug', '', () => _jsx(DebugProfiler, {}), 45, true);
  }
  if (displayVimMode) {
    const vimStr = `[${displayVimMode}]`;
    addCol(
      'vim',
      '',
      () => _jsx(Text, { color: theme.text.accent, children: vimStr }),
      vimStr.length,
      true
    );
  }

  // 2. Main Configurable Items
  for (const id of items) {
    if (!isFooterItemId(id)) continue;
    const itemConfig = ALL_ITEMS.find((i) => i.id === id);
    const header = itemConfig?.header ?? id;
    switch (id) {
      case 'workspace': {
        const fullPath = tildeifyPath(targetDir);
        const debugSuffix = debugMode
          ? ' ' + (debugMessage || '--debug')
          : '';
        addCol(
          id,
          header,
          (maxWidth) =>
            _jsx(CwdIndicator, {
              targetDir,
              maxWidth,
              debugMode,
              debugMessage,
              color: itemColor,
            }),
          fullPath.length + debugSuffix.length
        );
        break;
      }
      case 'git-branch': {
        if (branchName) {
          addCol(
            id,
            header,
            () => _jsx(Text, { color: itemColor, children: branchName }),
            branchName.length
          );
        }
        break;
      }
      case 'sandbox': {
        let str = 'no sandbox';
        const sandbox = process.env['SANDBOX'];
        if (isTrustedFolder === false) str = 'untrusted';
        else if (sandbox === 'sandbox-exec')
          str = `macOS Seatbelt (${process.env['SEATBELT_PROFILE']})`;
        else if (sandbox) str = sandbox.replace(/^gemini-(?:cli-)?/, '');
        addCol(
          id,
          header,
          () => _jsx(SandboxIndicator, { isTrustedFolder }),
          str.length
        );
        break;
      }
      case 'model-name': {
        const str = getDisplayString(model);
        addCol(
          id,
          header,
          () => _jsx(Text, { color: itemColor, children: str }),
          str.length
        );
        break;
      }
      case 'context-used': {
        addCol(
          id,
          header,
          () =>
            _jsx(ContextUsageDisplay, {
              promptTokenCount,
              model,
              terminalWidth,
            }),
          10
        );
        break;
      }
      case 'quota': {
        if (quotaStats?.remaining !== undefined && quotaStats.limit) {
          addCol(
            id,
            header,
            () =>
              _jsx(QuotaDisplay, {
                remaining: quotaStats.remaining,
                limit: quotaStats.limit,
                resetTime: quotaStats.resetTime,
                terse: true,
                forceShow: true,
                lowercase: true,
              }),
            10
          );
        }
        break;
      }
      case 'memory-usage': {
        addCol(
          id,
          header,
          () => _jsx(MemoryUsageDisplay, { color: itemColor }),
          10
        );
        break;
      }
      case 'session-id': {
        addCol(
          id,
          header,
          () =>
            _jsx(Text, {
              color: itemColor,
              children: uiState.sessionStats.sessionId.slice(0, 8),
            }),
          8
        );
        break;
      }
      case 'code-changes': {
        const added =
          uiState.sessionStats.metrics.files.totalLinesAdded;
        const removed =
          uiState.sessionStats.metrics.files.totalLinesRemoved;
        if (added > 0 || removed > 0) {
          const str = `+${added} -${removed}`;
          addCol(
            id,
            header,
            () =>
              _jsxs(Text, {
                children: [
                  _jsxs(Text, {
                    color: theme.status.success,
                    children: ['+', added],
                  }),
                  ' ',
                  _jsxs(Text, {
                    color: theme.status.error,
                    children: ['-', removed],
                  }),
                ],
              }),
            str.length
          );
        }
        break;
      }
      case 'token-count': {
        let total = 0;
        for (const m of Object.values(
          uiState.sessionStats.metrics.models
        ))
          total += m.tokens.total;
        if (total > 0) {
          const formatter = new Intl.NumberFormat('en-US', {
            notation: 'compact',
            maximumFractionDigits: 1,
          });
          const formatted = formatter.format(total).toLowerCase();
          addCol(
            id,
            header,
            () =>
              _jsxs(Text, {
                color: itemColor,
                children: [formatted, ' tokens'],
              }),
            formatted.length + 7
          );
        }
        break;
      }
      default:
        checkExhaustive(id);
        break;
    }
  }

  // 3. Transients
  if (corgiMode) addCol('corgi', '', () => _jsx(CorgiIndicator, {}), 5);
  if (showErrorSummary) {
    addCol(
      'error-count',
      '',
      () => _jsx(ConsoleSummaryDisplay, { errorCount }),
      12,
      true
    );
  }

  // --- Width Fitting Logic ---
  const columnsToRender = [];
  let droppedAny = false;
  let currentUsedWidth = 2;
  for (const col of potentialColumns) {
    const gap =
      columnsToRender.length > 0 ? (showLabels ? COLUMN_GAP : 3) : 0;
    const budgetWidth = col.id === 'workspace' ? 20 : col.width;
    if (
      col.isHighPriority ||
      currentUsedWidth + gap + budgetWidth <= terminalWidth - 2
    ) {
      columnsToRender.push(col);
      currentUsedWidth += gap + budgetWidth;
    } else {
      droppedAny = true;
    }
  }

  const rowItems = columnsToRender.map((col, index) => {
    const isWorkspace = col.id === 'workspace';
    const isLast = index === columnsToRender.length - 1;
    const otherItemsWidth = columnsToRender
      .filter((c) => c.id !== 'workspace')
      .reduce((sum, c) => sum + c.width, 0);
    const numItems =
      columnsToRender.length + (droppedAny ? 1 : 0);
    const numGaps = numItems > 1 ? numItems - 1 : 0;
    const gapsWidth = numGaps * (showLabels ? COLUMN_GAP : 3);
    const ellipsisWidth = droppedAny ? 1 : 0;
    const availableForWorkspace = Math.max(
      20,
      terminalWidth - 2 - gapsWidth - otherItemsWidth - ellipsisWidth
    );
    const estimatedWidth = isWorkspace ? availableForWorkspace : col.width;
    return {
      key: col.id,
      header: col.header,
      element: col.element(estimatedWidth),
      flexGrow: 0,
      flexShrink: isWorkspace ? 1 : 0,
      alignItems:
        isLast && !droppedAny && index > 0 ? 'flex-end' : 'flex-start',
    };
  });

  if (droppedAny) {
    rowItems.push({
      key: 'ellipsis',
      header: '',
      element: _jsx(Text, { color: theme.ui.comment, children: '\u2026' }),
      flexGrow: 0,
      flexShrink: 0,
      alignItems: 'flex-end',
    });
  }

  // ---------- Original footer output ----------
  const originalFooter = _jsx(Box, {
    width: terminalWidth,
    paddingX: 1,
    overflow: 'hidden',
    flexWrap: 'nowrap',
    children: _jsx(FooterRow, { items: rowItems, showLabels }),
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
