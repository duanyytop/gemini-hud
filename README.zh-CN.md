# gemini-hud

将 HUD 状态栏直接嵌入 Gemini CLI 的 footer 区域 — 无需额外面板，无需 tmux。

通过 Node.js ESM Loader Hook 在运行时拦截并增强 Gemini CLI 的 Footer 组件。

![gemini-hud 截图](assets/gemini-hud.png)

## 特性

- **上下文预警**：当 Context 占用超过 90% 时，文字颜色会红色闪烁提醒（自动识别 Pro/Flash 限制）。
- **子代理监控**：当 `codebase-investigator` 等后台任务运行时，显示动态旋转图标和任务计数。
- **精准会话绑定**：利用 `sessionId` 锁定会话文件，完美支持多个 CLI 窗口同时运行而不干扰。
- **实时费用估算**：根据不同模型费率和已消耗 Token，实时计算本次会话的估算花费（美元）。
- **Git 状态增强**：显示分支名、工作区脏状态标记（`*`）以及领先/落后远程分支的数量（`↑/↓`）。
- **性能优化**：基于 `mtime` 的 session 文件缓存机制 — 即使对话历史达到 2M+ Token 也不会造成打字卡顿。
- **快捷键轮播提示**：在 HUD 右侧自动轮转显示高频生产力命令提示。

## 前置要求

- **Node.js** >= 20
- **Gemini CLI** >= 0.34.0（`npm install -g @google/gemini-cli`）

## 安装

```bash
npm install -g gemini-hud
```

## 使用法

```bash
gemini-hud          # 启动带 HUD 的 gemini
gemini-hud --help   # 参数直接传递给 gemini
```

或手动运行（路径按实际安装位置替换）：

```bash
node --import ./register.mjs $(which gemini)
```

## 配置

创建 `~/.gemini-hudrc`（JSON 格式）：

```json
{
  "colors": {
    "label": "gray",
    "value": "white",
    "separator": "gray",
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

所有字段均为可选，未指定的使用默认值。

## 工作原理

1. **`register.mjs`** — 通过 `node:module.register()` 注册 ESM loader hook。
2. **`loader.mjs`** — 拦截 `resolve` 阶段；当检测到 `@google/gemini-cli` 的 `Footer.js` 被加载时，重定向到我们的 `hud-footer.mjs`。
3. **`hud-footer.mjs`** — 渲染原始 Footer（保留所有原有功能），并在下方追加 HUD 信息行。
4. **`bin/gemini-hud`** — 跨平台启动脚本：`node --import register.mjs $(which gemini) "$@"`

## 数据来源

| 信息 | 来源 |
|------|------|
| 模型名称 | `uiState.currentModel` (来自 Footer props) |
| 上下文用量 | `max(uiState.lastPrompt, session.input) / modelLimit` |
| Token 详情 | `~/.gemini/tmp/<project>/chats/session-<id>.json` (缓存解析) |
| 活跃任务 | `uiState.activeTasks` (Sub-agents 状态) |
| Git 状态 | `git status --porcelain` 和 `git rev-list --count` |

## 兼容性

- **Node.js**: >= 20（需要 ESM loader hooks 支持）。
- **Gemini CLI**: >= 0.34.0（使用 column 布局的 Footer）。
- **平台**: macOS、Linux、Windows。

## 许可证

MIT
