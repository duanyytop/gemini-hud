/**
 * Enhanced Footer component with HUD status line.
 * Compatible with @google/gemini-cli 0.34.x (column-based Footer + FooterRow).
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
//  FooterRow — exported verbatim
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
//  HUD helpers & Cost Logic
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
  showEstimatedCost: true,
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
  } catch { /* ignore */ }
  return DEFAULT_HUD_CONFIG;
}

const hudConfig = loadHudConfig();

let sessionCache = { sessionId: null, mtime: 0, data: null };

function getSessionData(sessionId) {
  const tmpDir = join(homedir(), '.gemini', 'tmp');
  if (!existsSync(tmpDir)) return null;

  const findFile = () => {
    if (sessionId) {
      const shortId = sessionId.slice(0, 8);
      const projectDirs = readdirSync(tmpDir, { withFileTypes: true });
      for (const dir of projectDirs) {
        if (!dir.isDirectory()) continue;
        const chatsDir = join(tmpDir, dir.name, 'chats');
        if (!existsSync(chatsDir)) continue;
        const files = readdirSync(chatsDir).filter(f => f.includes(shortId) && f.endsWith('.json'));
        if (files.length > 0) return join(chatsDir, files[0]);
      }
    }
    return null;
  };

  const fp = findFile();
  if (!fp) return null;

  try {
    const mtime = statSync(fp).mtimeMs;
    if (sessionCache.sessionId === sessionId && sessionCache.mtime === mtime) return sessionCache.data;
    const data = JSON.parse(readFileSync(fp, 'utf8'));
    sessionCache = { sessionId, mtime, data };
    return data;
  } catch { return sessionCache.data; }
}

function getTokensFromSession(sessionData) {
  const totals = { input: 0, output: 0, cached: 0 };
  if (!sessionData) return totals;
  if (sessionData.usageMetadata) {
    const m = sessionData.usageMetadata;
    totals.input = m.promptTokenCount || 0;
    totals.output = m.candidatesTokenCount || 0;
    totals.cached = m.cachedContentTokenCount || 0;
  } else if (Array.isArray(sessionData.messages)) {
    for (const msg of sessionData.messages) {
      if (msg.tokens) {
        totals.input += msg.tokens.input || 0;
        totals.output += (msg.tokens.output || 0) + (msg.tokens.thoughts || 0);
        totals.cached += msg.tokens.cached || 0;
      }
    }
  }
  return totals;
}

function estimateCost(tokens, model) {
  const modelStr = String(model).toLowerCase();
  let inputRate = 0.075, outputRate = 0.30; // Flash default

  if (modelStr.includes('pro')) {
    inputRate = tokens.input > 128000 ? 7.00 : 3.50;
    outputRate = tokens.input > 128000 ? 21.00 : 10.50;
  } else if (modelStr.includes('flash') && modelStr.includes('2.0')) {
    inputRate = 0.10; outputRate = 0.40;
  } else if (modelStr.includes('gemini-3') || modelStr.includes('gemini 3')) {
    inputRate = 0.10; outputRate = 0.40; // Assuming 3.0 Experimental/Preview rates
  }

  const cost = (tokens.input / 1_000_000) * inputRate + (tokens.output / 1_000_000) * outputRate;
  return cost > 0.005 ? `$${cost.toFixed(2)}` : null;
}

function getModelContextLimit(model) {
  const m = String(model).toLowerCase();
  if (m.includes('pro')) return 2_000_000;
  if (m.includes('flash')) return 1_000_000;
  return hudConfig.contextMaxTokens || 1_000_000;
}

function getGitStatus() {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', { encoding: 'utf8' }).trim();
    if (!branch) return null;
    const isDirty = execSync('git status --porcelain 2>/dev/null', { encoding: 'utf8' }).trim().length > 0;
    let ahead = 0, behind = 0;
    try {
      const out = execSync('git rev-list --left-right --count HEAD...@{u} 2>/dev/null', { encoding: 'utf8' }).trim();
      const parts = out.split(/\s+/);
      if (parts.length === 2) { ahead = parseInt(parts[0], 10); behind = parseInt(parts[1], 10); }
    } catch { /* skip */ }
    return { branch, isDirty, ahead, behind };
  } catch { return null; }
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
//  HUD Visual Components
// =====================================================================

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function Spinner() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(timer);
  }, []);
  return _jsx(Text, { color: 'cyan', children: SPINNER_FRAMES[frame] });
}

function ShortcutTips() {
  const tips = ['/? help', '/copy code', '/clear screen', '/new session', '/quit'];
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => (i + 1) % tips.length), 5000);
    return () => clearInterval(timer);
  }, []);
  return _jsxs(Text, {
    children: [
      _jsx(Text, { color: 'gray', children: 'TIP: ' }),
      _jsx(Text, { color: 'white', children: tips[index] }),
    ],
  });
}

// =====================================================================
//  HUD Line Component
// =====================================================================

function HudLine({ sessionId, promptTokenCount, model, terminalWidth, activeTasks = [] }) {
  const [sessionData, setSessionData] = useState(null);
  const [gitStatus, setGitStatus] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [isBright, setIsBright] = useState(true);
  const startTimeRef = useRef(Date.now());

  useEffect(() => {
    const tick = () => {
      setElapsed(Date.now() - startTimeRef.current);
      setSessionData(getSessionData(sessionId));
      if (hudConfig.showGitBranch) setGitStatus(getGitStatus());
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => clearInterval(id);
  }, [sessionId]);

  const tokens = getTokensFromSession(sessionData);
  const limit = getModelContextLimit(model);
  const realTokens = Math.max(promptTokenCount || 0, tokens.input);
  const contextRatio = realTokens / limit;

  useEffect(() => {
    if (contextRatio < 0.9) { setIsBright(true); return; }
    const id = setInterval(() => setIsBright(b => !b), 500);
    return () => clearInterval(id);
  }, [contextRatio]);

  const c = hudConfig.colors;
  const toolCalls = (sessionData?.messages || []).reduce((acc, m) => acc + (m.type === 'gemini' ? (m.toolCalls?.length || 0) : 0), 0);
  const cost = hudConfig.showEstimatedCost ? estimateCost(tokens, model) : null;
  const ctxColor = contextRatio >= 0.9 ? (isBright ? c.danger : 'gray') : (contextRatio >= 0.7 ? c.warning : c.value);

  const sep = _jsx(Text, { color: c.separator, children: ' \u2502 ' });
  const parts = [];

  // 1. Tasks
  if (activeTasks.length > 0) {
    parts.push(_jsxs(Box, { key: 'tasks', marginRight: 1, children: [
      _jsx(Spinner, {}),
      _jsx(Text, { color: 'cyan', children: ` ${activeTasks.length}` })
    ]}));
    parts.push(sep);
  }

  // 2. Context & Tokens
  parts.push(_jsxs(Box, { key: 'ctx', children: [
    _jsx(Text, { color: c.label, children: 'ctx:' }),
    _jsx(Text, { color: ctxColor, children: `${(contextRatio * 100).toFixed(0)}%` }),
    _jsx(Text, { color: 'gray', children: ' ' })
  ]}));

  if (hudConfig.showTokenBreakdown) {
    parts.push(_jsxs(Box, { key: 'tokens', children: [
      _jsx(Text, { color: c.label, children: 'in:' }),
      _jsx(Text, { color: c.value, children: formatTokenCount(tokens.input) }),
      _jsx(Text, { color: c.label, children: ' out:' }),
      _jsx(Text, { color: c.value, children: formatTokenCount(tokens.output) })
    ]}));
  }

  // 3. Cost
  if (cost) {
    parts.push(sep);
    parts.push(_jsxs(Text, { key: 'cost', children: [
      _jsx(Text, { color: c.label, children: 'est:' }),
      _jsx(Text, { color: 'green', children: cost })
    ]}));
  }

  // 4. Git
  if (hudConfig.showGitBranch && gitStatus) {
    parts.push(sep);
    parts.push(_jsxs(Box, { key: 'git', children: [
      _jsx(Text, { color: c.value, children: gitStatus.branch }),
      gitStatus.isDirty && _jsx(Text, { color: c.warning, children: '*' }),
      (gitStatus.ahead > 0 || gitStatus.behind > 0) && _jsxs(Text, { color: 'gray', children: [
        ' \u2191', gitStatus.ahead, '\u2193', gitStatus.behind
      ]})
    ]}));
  }

  // 5. Tools & Time
  parts.push(sep);
  if (toolCalls > 0) {
    parts.push(_jsxs(Text, { key: 'tools', children: [
      _jsx(Text, { color: c.label, children: '\uD83D\uDD27 ' }),
      _jsx(Text, { color: c.value, children: String(toolCalls) }),
      _jsx(Text, { color: 'gray', children: ' ' })
    ]}));
  }
  parts.push(_jsxs(Text, { key: 'time', children: [
    _jsx(Text, { color: c.label, children: '\u23F1 ' }),
    _jsx(Text, { color: c.value, children: formatDuration(elapsed) })
  ]}));

  return _jsxs(Box, { width: terminalWidth, paddingX: 1, justifyContent: 'space-between', children: [
    _jsx(Box, { children: parts }),
    _jsx(ShortcutTips, {})
  ]});
}

// =====================================================================
//  Footer Component
// =====================================================================

const CwdIndicator = ({ targetDir, maxWidth, debugMode, debugMessage, color }) => {
  const debugSuffix = debugMode ? ' ' + (debugMessage || '--debug') : '';
  const availableForPath = Math.max(10, maxWidth - debugSuffix.length);
  const displayPath = shortenPath(tildeifyPath(targetDir), availableForPath);
  return _jsxs(Text, { color, children: [displayPath, debugMode && _jsx(Text, { color: theme.status.error, children: debugSuffix })] });
};

const SandboxIndicator = ({ isTrustedFolder }) => {
  const sandbox = process.env['SANDBOX'];
  if (isTrustedFolder === false) return _jsx(Text, { color: theme.status.warning, children: 'untrusted' });
  if (sandbox === 'sandbox-exec') return _jsx(Text, { color: theme.status.warning, children: 'Seatbelt' });
  if (sandbox) return _jsx(Text, { color: 'green', children: sandbox.replace(/^gemini-/, '') });
  return _jsx(Text, { color: theme.status.error, children: 'no sandbox' });
};

const CorgiIndicator = () =>
  _jsxs(Text, { children: [_jsx(Text, { color: theme.status.error, children: '\u25BC' }), _jsx(Text, { color: theme.text.primary, children: "(\u00B4" }), _jsx(Text, { color: theme.status.error, children: '\u1D25' }), _jsx(Text, { color: theme.text.primary, children: '`)' }), _jsx(Text, { color: theme.status.error, children: '\u25BC' })] });

function isFooterItemId(id) { return ALL_ITEMS.some((i) => i.id === id); }

export const Footer = () => {
  const uiState = useUIState();
  const config = useConfig();
  const settings = useSettings();
  const { vimEnabled, vimMode } = useVimMode();

  const {
    sessionId, model, targetDir, debugMode, branchName, debugMessage, corgiMode,
    errorCount, showErrorDetails, promptTokenCount, isTrustedFolder, terminalWidth, quotaStats, activeTasks,
  } = {
    sessionId: uiState.sessionStats.sessionId,
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
    activeTasks: uiState.activeTasks || [],
  };

  const isFullErrorVerbosity = settings.merged.ui.errorVerbosity === 'full';
  const showErrorSummary = !showErrorDetails && errorCount > 0 && (isFullErrorVerbosity || debugMode || isDevelopment);
  const displayVimMode = vimEnabled ? vimMode : undefined;

  const items = settings.merged.ui.footer.items ?? deriveItemsFromLegacySettings(settings.merged);
  const showLabels = settings.merged.ui.footer.showLabels !== false;
  const itemColor = showLabels ? theme.text.primary : theme.ui.comment;

  const potentialColumns = [];
  const addCol = (id, header, element, dataWidth, isHighPriority = false) => {
    potentialColumns.push({ id, header: showLabels ? header : '', element, width: Math.max(dataWidth, showLabels ? header.length : 0), isHighPriority });
  };

  if (uiState.showDebugProfiler) addCol('debug', '', () => _jsx(DebugProfiler, {}), 45, true);
  if (displayVimMode) {
    const vimStr = `[${displayVimMode}]`;
    addCol('vim', '', () => _jsx(Text, { color: theme.text.accent, children: vimStr }), vimStr.length, true);
  }

  for (const id of items) {
    if (!isFooterItemId(id)) continue;
    const itemConfig = ALL_ITEMS.find((i) => i.id === id);
    const header = itemConfig?.header ?? id;
    switch (id) {
      case 'workspace':
        addCol(id, header, (maxWidth) => _jsx(CwdIndicator, { targetDir, maxWidth, debugMode, debugMessage, color: itemColor }), tildeifyPath(targetDir).length);
        break;
      case 'git-branch':
        if (branchName) addCol(id, header, () => _jsx(Text, { color: itemColor, children: branchName }), branchName.length);
        break;
      case 'sandbox':
        addCol(id, header, () => _jsx(SandboxIndicator, { isTrustedFolder }), 10);
        break;
      case 'model-name':
        addCol(id, header, () => _jsx(Text, { color: itemColor, children: getDisplayString(model) }), 12);
        break;
      case 'context-used':
        addCol(id, header, () => _jsx(ContextUsageDisplay, { promptTokenCount, model, terminalWidth }), 8);
        break;
      case 'quota':
        if (quotaStats?.remaining !== undefined) addCol(id, header, () => _jsx(QuotaDisplay, { remaining: quotaStats.remaining, limit: quotaStats.limit, resetTime: quotaStats.resetTime, terse: true, forceShow: true, lowercase: true }), 8);
        break;
      case 'memory-usage':
        addCol(id, header, () => _jsx(MemoryUsageDisplay, { color: itemColor }), 10);
        break;
      case 'session-id':
        addCol(id, header, () => _jsx(Text, { color: itemColor, children: uiState.sessionStats.sessionId.slice(0, 8) }), 8);
        break;
      case 'code-changes':
        const added = uiState.sessionStats.metrics.files.totalLinesAdded;
        const removed = uiState.sessionStats.metrics.files.totalLinesRemoved;
        if (added > 0 || removed > 0) addCol(id, header, () => _jsxs(Text, { children: [_jsxs(Text, { color: theme.status.success, children: ['+', added] }), ' ', _jsxs(Text, { color: theme.status.error, children: ['-', removed] })] }), 10);
        break;
      case 'token-count':
        let total = 0;
        for (const m of Object.values(uiState.sessionStats.metrics.models)) total += m.tokens.total;
        if (total > 0) {
          const formatted = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(total).toLowerCase();
          addCol(id, header, () => _jsxs(Text, { color: itemColor, children: [formatted, ' tokens'] }), 10);
        }
        break;
      default:
        checkExhaustive(id);
        break;
    }
  }

  if (corgiMode) addCol('corgi', '', () => _jsx(CorgiIndicator, {}), 5);
  if (showErrorSummary) addCol('error-count', '', () => _jsx(ConsoleSummaryDisplay, { errorCount }), 12, true);

  const columnsToRender = [];
  let currentUsedWidth = 2;
  for (const col of potentialColumns) {
    const gap = columnsToRender.length > 0 ? (showLabels ? COLUMN_GAP : 3) : 0;
    if (col.isHighPriority || currentUsedWidth + gap + 10 <= terminalWidth - 2) {
      columnsToRender.push(col);
      currentUsedWidth += gap + 10;
    }
  }

  const rowItems = columnsToRender.map((col, index) => ({
    key: col.id,
    header: col.header,
    element: col.element(20),
    flexGrow: 0,
    flexShrink: col.id === 'workspace' ? 1 : 0,
    alignItems: (index === columnsToRender.length - 1) ? 'flex-end' : 'flex-start',
  }));

  const originalFooter = _jsx(Box, { width: terminalWidth, paddingX: 1, overflow: 'hidden', flexWrap: 'nowrap', children: _jsx(FooterRow, { items: rowItems, showLabels }) });

  return _jsxs(Box, {
    flexDirection: 'column',
    width: terminalWidth,
    children: [
      originalFooter,
      _jsx(HudLine, { sessionId, promptTokenCount, model, terminalWidth, activeTasks }),
    ],
  });
};
