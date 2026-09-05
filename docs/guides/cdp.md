# CDP (Chrome DevTools Protocol)

There are **two unrelated CDP surfaces** in this app. Mixing them up costs hours, so start here:

|                             | Developer app-wide CDP                                         | Agent browser bridge                        |
| --------------------------- | -------------------------------------------------------------- | ------------------------------------------- |
| What it exposes             | **Every** WebContents — the main window, settings, chat, WebUI | Exactly one page: the in-app browser        |
| Who it is for               | Developers debugging / driving the real UI                     | The agent, so it can browse                 |
| Port                        | `9230` by default, fixed                                       | OS-assigned ephemeral (`listen(0)`)         |
| Auth                        | **None**                                                       | Token required                              |
| Default                     | **Off.** Dev builds only, must be requested explicitly         | On, production included                     |
| Can it drive the AionUi UI? | **Yes**                                                        | **No — by design**                          |
| Code                        | `process/utils/configureChromium.ts` + `devtoolsCdp.ts`        | `process/resources/builtinMcp/cdpBridge.ts` |

If your goal is _"drive the real app UI to verify a change"_, you want the **first** column.

---

## 1. Developer app-wide CDP (debugging)

### Enabling it

Dev builds only, and off unless you ask for it:

```bash
# Windows PowerShell
$env:DREAM_DEVTOOLS_CDP_PORT = "9230"; bun run dev
```

```bash
# bash / zsh
DREAM_DEVTOOLS_CDP_PORT=9230 bun run dev
```

`DREAM_DEVTOOLS_CDP_PORT=1` (or `true`) means "on, default port 9230". `0`, `false`, an empty
value, or omitting the variable all mean off.

On startup you get a loud line confirming it:

```
[CDP] Developer app-wide debugging ENABLED on http://127.0.0.1:9230 — dev build only, ...
```

Verify it is really listening before you start debugging anything else:

```bash
curl -s http://127.0.0.1:9230/json/version
```

### It cannot be enabled in a packaged build

This is deliberate and not configurable. A packaged build refuses even with the environment
variable set, and logs why:

```
[CDP] DREAM_DEVTOOLS_CDP_PORT is set but this is a packaged build — refused.
```

The reason is in the switch itself: Chromium's `remote-debugging-port` is **application-wide
with no per-target ACL and no authentication**. Turning it on hands every WebContents —
including the main window with its preload bridge — to any process running as the same user.
That is acceptable on a developer's machine when explicitly requested; it is not acceptable to
ship. The switch used to be on by default and was deleted outright for exactly this reason, so
`tests/unit/process/devtoolsCdp.test.ts` locks both gates. **A red test there means a shipped
build can be remotely driven — it is not a test that needs updating.**

### Using it with chrome-devtools MCP

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@0.16.0", "--browser-url=http://127.0.0.1:9230"]
    }
  }
}
```

| IDE                | Config path                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Cursor**         | `~/.cursor/mcp.json`                                                                                                                 |
| **VS Code**        | `~/.vscode/mcp.json`                                                                                                                 |
| **Claude Desktop** | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows) |
| **Codebuddy**      | `~/.codebuddy/mcp.json`                                                                                                              |

### Inspect by hand

- `http://127.0.0.1:9230/json` lists targets; open one in Chrome to get DevTools.
- Or `chrome://inspect` → Configure → add `127.0.0.1:9230`.

### Known pitfalls when driving the real UI

These have each cost a debugging session in this repo:

- **A raw `ws` client is often more reliable than a browser-automation MCP.** The renderer talks
  to the backend over a WebSocket, not bare IPC, and `ipcBridge`/preload are not reachable the
  way you would expect from an automation tool. Connecting directly to the page target and
  driving it with `Runtime.evaluate` sidesteps that.
- **A window that is occluded stops producing frames.** Chromium suspends rendering for hidden
  or covered windows, so `scroll` events and `ResizeObserver` never fire and correct code looks
  broken. Before concluding a UI bug is real, probe `document.visibilityState` and confirm
  `requestAnimationFrame` is still firing; count scroll events rather than only watching
  `scrollTop`. `Page.bringToFront` does not fix this, and `Browser.getWindowForTarget` does not
  exist in Electron's CDP.
- **`display: none` elements still match selectors.** Counting `querySelectorAll(...).length` to
  prove something is hidden is wrong. Judge by `offsetParent`, `getBoundingClientRect()`, and
  computed `display`.
- **Arco dropdowns need a full PointerEvent sequence**, not a bare `click()`.
- **Import app modules through `/@fs/`** when evaluating in the page.
- **The dev userData directory is `%APPDATA%\dream-ui-Dev`** (was `1one-Dev` before
  2026-08-24 — renamed so this repo's dev profile can never collide with the pre-fork
  `1oneUI` repo's own `1one-Dev`/`1one-Dev-2`, which are still in active use on the
  same dev machines), not the production one.
- **A stale service worker can white-screen the app.** If the window comes up blank after a
  rebuild, clear `%APPDATA%\dream-ui-Dev\Service Worker` — the PWA dev SW caches an old module graph.

---

## 2. Agent browser bridge

This is what lets the agent browse. It starts on its own and logs:

```
[CDP] Single-target bridge listening on 127.0.0.1:<port>
```

The port is ephemeral by design — that, plus the token, is the only real barrier against other
local processes, so do not move it onto a fixed port.

**It cannot touch the AionUi interface itself.** It exposes exactly one `webContents`: the in-app
browser page. If you connect to it hoping to click a settings toggle, you are on the wrong
surface — use the developer port above.

Users can turn this off in settings, after which the agent simply cannot drive the browser (the
MCP launcher refuses to start rather than quietly opening a Chrome the user cannot see).

---

## History

Between the removal of the original always-on `remote-debugging-port` and its reintroduction
here, there was a window in which this document was wrong in three ways: it told you to connect
to `9230` (nothing listened), it described a **Settings → System → Developer Debug → Enable
Remote Debugging** toggle (no such setting exists — `enableRemoteDebugging` / `remoteDebugging` /
`developerDebug` are all zero hits repo-wide), and the "real-machine CDP verification"
methodology used across the session documents was silently unavailable. The toggle is still
gone; drive the port from the environment variable instead.

---

# CDP（Chrome DevTools Protocol）中文说明

这个应用里有**两套互不相干的 CDP**，搞混会白折腾几个小时，所以先看这张表：

|                      | 开发者应用级 CDP                                        | agent 浏览器通道                            |
| -------------------- | ------------------------------------------------------- | ------------------------------------------- |
| 暴露什么             | **每一个** WebContents——主窗口、设置、聊天、WebUI       | 只有一个页面：应用内浏览器                  |
| 给谁用               | 开发者调试 / 驱动真实界面                               | agent，让它能上网                           |
| 端口                 | 默认固定 `9230`                                         | 系统分配的临时端口（`listen(0)`）           |
| 认证                 | **无**                                                  | 需要 token                                  |
| 默认                 | **关闭。** 仅 dev 构建，且必须显式开启                  | 开启，正式版也开                            |
| 能驱动 AionUi 界面吗 | **能**                                                  | **不能——按设计就碰不到**                    |
| 代码                 | `process/utils/configureChromium.ts` + `devtoolsCdp.ts` | `process/resources/builtinMcp/cdpBridge.ts` |

如果你的目的是**「驱动真实界面来验收一个改动」**，你要的是**左边那一列**。

---

## 一、开发者应用级 CDP（调试用）

### 怎么开

只在 dev 构建下可用，且不显式要求就不开：

```powershell
# Windows PowerShell
$env:DREAM_DEVTOOLS_CDP_PORT = "9230"; bun run dev
```

```bash
# bash / zsh
DREAM_DEVTOOLS_CDP_PORT=9230 bun run dev
```

`DREAM_DEVTOOLS_CDP_PORT=1`（或 `true`）表示「开，用默认端口 9230」。`0`、`false`、空值、
或者干脆不设，都表示关。

启动时会有一条醒目日志确认：

```
[CDP] Developer app-wide debugging ENABLED on http://127.0.0.1:9230 — dev build only, ...
```

**开始调试别的东西之前，先确认它真的在监听**：

```bash
curl -s http://127.0.0.1:9230/json/version
```

### 打包版打不开，这是刻意的

打包版即使设了环境变量也**无条件拒绝**，并会说明原因：

```
[CDP] DREAM_DEVTOOLS_CDP_PORT is set but this is a packaged build — refused.
```

理由就在这个开关本身：Chromium 的 `remote-debugging-port` 是**应用级的、没有 per-target
ACL、没有任何认证**。一开就把每个 WebContents（含挂着 preload 桥的主窗口）交给同一用户下的
任意进程，那个进程就能驱动整个应用。开发者机器上显式要求时可以接受，随产品发出去不行。
这个开关当初**默认常开**，正是因此被整个删掉，所以
`tests/unit/process/devtoolsCdp.test.ts` 把两道闸都钉死了。
**那里变红意味着发出去的包可能被远程驱动，不是测试需要更新。**

### 配 chrome-devtools MCP

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@0.16.0", "--browser-url=http://127.0.0.1:9230"]
    }
  }
}
```

| IDE                | 配置路径                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Cursor**         | `~/.cursor/mcp.json`                                                                                                                  |
| **VS Code**        | `~/.vscode/mcp.json`                                                                                                                  |
| **Claude Desktop** | `~/Library/Application Support/Claude/claude_desktop_config.json`（macOS）或 `%APPDATA%\Claude\claude_desktop_config.json`（Windows） |
| **Codebuddy**      | `~/.codebuddy/mcp.json`                                                                                                               |

### 手工检查

- `http://127.0.0.1:9230/json` 列出所有目标，在 Chrome 里点开就是 DevTools。
- 或 `chrome://inspect` → 配置 → 添加 `127.0.0.1:9230`。

### 驱动真实界面时的已知坑（每条都在本仓真实吃过亏）

- **裸 `ws` 客户端往往比浏览器自动化 MCP 更可靠。** 渲染层与后端走 WebSocket 而非裸 IPC，
  `ipcBridge`/preload 也不是自动化工具够得着的形态。直接连页面 target 用 `Runtime.evaluate`
  驱动可以绕开这些。
- **窗口被遮挡时 Chromium 会停止产帧。** 于是 `scroll` 事件与 `ResizeObserver` 永不触发，
  **正常代码会被测成 BUG**。下结论说 UI 有问题之前，先探 `document.visibilityState` 并确认
  `requestAnimationFrame` 还在跑；判据要数 scroll 事件个数，别只看 `scrollTop` 变没变。
  `Page.bringToFront` 解决不了，`Browser.getWindowForTarget` 在 Electron 的 CDP 里不存在。
- **`display:none` 的元素照样匹配选择器。** 拿 `querySelectorAll(...).length` 变少来证明
  「藏起来了」是错的，判据必须是 `offsetParent` + `getBoundingClientRect()` + computed `display`。
- **Arco 下拉要发完整的 PointerEvent 序列**，光 `click()` 不行。
- **在页面里 import 应用模块要走 `/@fs/`。**
- **dev 的 userData 目录是 `%APPDATA%\dream-ui-Dev`**（2026-08-24 之前是 `1one-Dev`，改名是
  为了不再跟没并入本仓库、仍在同一台机器上独立使用的旧仓库 `1oneUI`（用的是
  `1one-Dev`/`1one-Dev-2`）撞车），不是正式版那个。
- **旧的 Service Worker 会让应用白屏。** 重编之后窗口空白，清
  `%APPDATA%\dream-ui-Dev\Service Worker`（PWA 的 dev SW 会缓存旧的模块图）。

---

## 二、agent 浏览器通道

这条是让 agent 能上网的通道，自己会起来并打印：

```
[CDP] Single-target bridge listening on 127.0.0.1:<port>
```

端口是临时的，这是刻意的——它加上 token 是本机唯一真实屏障，所以**不要**把它改到固定端口。

**它碰不到 AionUi 界面本身。** 它只暴露一个 `webContents`：应用内浏览器那个页面。如果你连上
它想点一下设置里的开关，说明你连错了那一套，请用上面的开发者端口。

用户可以在设置里关掉它，关掉后 agent 就无法操作浏览器（此时 MCP 启动器会拒绝启动，不会
偷偷开一个用户看不见的 Chrome）。

---

## 沿革

在原来那个「默认常开」的 `remote-debugging-port` 被删除、到这次以两道闸的形态恢复之间，有
一段时间这份文档有三处是错的：它让你连 `9230`（那时没有任何进程在监听）、它描述了一个
**设置 → 系统 → 开发者调试 → 启用远程调试**的开关（这个设置项不存在，
`enableRemoteDebugging` / `remoteDebugging` / `developerDebug` 全仓 0 命中）、而各 session
文档里那套「真机 CDP 验证」的方法论在那段时间实际上是不可用的。那个设置开关**至今仍然不
存在**，请改用环境变量。
