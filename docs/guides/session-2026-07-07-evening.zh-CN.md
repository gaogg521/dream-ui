# 开发会话记录：2026-07-07 晚间（侧栏 / 企业 / 超级助手 / dev 环境）

> **读者**：后续接手的 AI 或人类开发者。  
> **代码位置**：`D:\aionui-m0\1oneUI` 分支 `one-main`（截至本文撰写时**大量改动未 commit**）。  
> **后端**：`D:\aionui-m0\1oneCore`（Rust，`one-employee` / `one-org` 等 crate）。  
> **启动脚本**：`D:\aionui-m0\scripts\`（不进入 1oneUI git 历史）。

---

## 1. 背景与产品意图

### 1.1 我们在做什么

Fork v2：**1oneUI 桌面前端 + 内嵌 1oneCore 后端**。本轮工作集中在：

1. **侧栏 B 方案**：视觉上移「团队 / 项目 / 历史对话」，减少中间空白。
2. **企业能力入口调整**：企业相关 UI 从侧栏迁到 **设置 → 企业**；远端连接在桌面客户端配置。
3. **超级助手（数字员工）**：`POST /api/one/employee/agents` 在「开远端」时不应打到无该路由的远端。
4. **开发环境可测**：`bun run dev` 不等于后端已更新；改完必须点路径冒烟。

### 1.2 架构共识（尚未完全实现）

| 域                                                 | 应走哪里                         | 说明                       |
| -------------------------------------------------- | -------------------------------- | -------------------------- |
| 个人会话、助手、MCP 执行、定时任务、**数字员工**   | **本机** aioncore                | 算力与数据在个人工作台     |
| Issues 看板、组织 SSO、管理员下发 MCP/Skill 注册表 | **远端** 企业服务器              | 协同与管控                 |
| 开「连接远端」                                     | **不应**把上述个人域全部切到远端 | 压力大、易 404、丢本机数据 |

**已做**：`personalAgent`（`ipcBridge.personalAgent.*`）固定 `http*Local` → 本机端口。  
**未做**：按域拆分 `httpBridge`（会话/助手/cron 等开远端时仍可能走远端）。

---

## 2. 开发环境（必读）

### 2.1 前端 ≠ 后端源码

`bun run dev` / `frontend-dev.ps1` 会 spawn **编译好的** `aioncore.exe`，不是 1oneCore 源码实时编译。

| 场景           | 命令                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------- |
| 只改前端       | `D:\aionui-m0\scripts\frontend-dev.ps1`                                                           |
| 改了 1oneCore  | `D:\aionui-m0\scripts\backend-rebuild.ps1` 然后 `frontend-dev.ps1`，或 `backend-rebuild.ps1 -Dev` |
| 只 curl 测 API | `D:\aionui-m0\scripts\backend-run.ps1`（默认 `127.0.0.1:25912 --local`）                          |

数据目录（dev）：`%APPDATA%\1one-Dev`（日志里可见 `1one-Dev`，与旧 `AionUi-Dev` 命名并存时注意）。

### 2.2 坑：dev 曾用到 Electron 自带的旧 aioncore

**现象**：`backend-rebuild.ps1` 已更新 `AionUi/resources/bundled-aioncore/...`，但 Electron 日志里仍出现：

```text
node_modules/.../electron/dist/resources/bundled-aioncore/win32-x64/aioncore.exe
/health → version 0.1.41；employee API → 404
```

**修复**：`packages/desktop/src/process/backend/binaryResolver.ts`  
解析顺序改为：

1. `AIONUI_BACKEND_BUNDLED_DIR`（显式覆盖）
2. `{cwd}/resources/bundled-aioncore`（`backend-rebuild` 输出，**dev 优先**）
3. `process.resourcesPath/bundled-aioncore`（打包 / Electron 内置，dev 下常过期）

**验证**：主进程日志应出现 `starting: D:\aionui-m0\1oneUI\resources\bundled-aioncore\...`，`/health` 版本与本地编译一致（如 `0.1.42`）。

### 2.3 进程清理

多开 `electron` / `aioncore` 会导致端口错乱、假死。重启前：

```powershell
taskkill /F /IM electron.exe /T
taskkill /F /IM aioncore.exe /T
```

---

## 3. 功能改动清单

### 3.1 侧栏布局（B 方案）

| 文件                                                    | 改动                                                                                     |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `renderer/components/layout/Sider/index.tsx`            | 去掉分割线；Team 紧挨记忆区；历史区 `flex-1` 独立滚动                                    |
| `renderer/pages/conversation/GroupedHistory/index.tsx`  | 区块标题（置顶 / 项目 / 历史对话）固定，列表单独滚动                                     |
| `renderer/components/layout/Sider/TeamSiderSection.tsx` | 团队列表 `max-h-36 overflow-y-auto`；**曾少 `</div>` 导致 TS 编译失败 → 整页黑屏**，已修 |
| `locales/*/conversation.json`                           | `conversationsSection`：对话 → **历史对话** / History                                    |

### 3.2 企业与设置入口

| 文件                                                                 | 改动                                                                                          |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `renderer/pages/settings/components/SettingsSider.tsx`               | `BUILTIN_TAB_IDS` 增加 `enterprise`；`appearance` 移出默认 Tab；分组标题 `webui` → `groupApp` |
| `renderer/pages/settings/EnterpriseSettings.tsx`                     | **新增**：设置内企业页包装                                                                    |
| `renderer/components/layout/Router.tsx`                              | `/settings/enterprise`；`/enterprise` → redirect；`/enterprise/login` 独立页                  |
| `renderer/components/layout/Sider/SiderNav/SiderEnterpriseEntry.tsx` | 侧栏企业入口调整（迁到设置）                                                                  |
| `renderer/pages/enterprise/*`                                        | 企业概览、远端连接 `RemoteServerSection`、SSO 浏览器登录等                                    |

### 3.3 超级助手（数字员工）

| 文件                                           | 改动                                                         |
| ---------------------------------------------- | ------------------------------------------------------------ |
| `common/adapter/httpBridge.ts`                 | `getLocalBaseUrl()`、`http*Local`、`preferLocalBackend`      |
| `common/adapter/ipcBridge.ts`                  | `personalAgent` 全部改为 `httpGetLocal` / `httpPostLocal` 等 |
| `tests/unit/common-adapter/httpBridge.test.ts` | 远端模式开启时仍请求 `127.0.0.1:{port}`                      |

后端路由（1oneCore）：`crates/one-employee/src/routes.rs` → `/api/one/employee/agents` 等。

### 3.4 启动与体验杂项

| 文件                                                    | 改动                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------- |
| `renderer/main.tsx`                                     | 启动 `!ready` 时显示 `t('common.loading')`，不再 `return null` 黑屏 |
| `renderer/services/prefetchAssistantsList.ts`           | 壳就绪后 idle 预取 assistants（新增）                               |
| `renderer/styles/themes/1one-themes.css` 等             | 主题 / 配色相关（本轮一并改动）                                     |
| `renderer/components/layout/WorkspaceIdentityEntry.tsx` | 侧栏底部工作区身份（新增）                                          |

---

## 4. Bug、根因与修复（今晚踩坑全集）

### 4.1 设置页一点击 → 全屏黑/空白

| 项       | 内容                                                                                                                                                                                                                  |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **现象** | 点侧栏「设置」后整窗空白（连标题栏、侧栏一起没）                                                                                                                                                                      |
| **根因** | `SettingsSider` 的 `BUILTIN_TAB_IDS` 含 `enterprise`，`SettingsPageWrapper.getBuiltinSettingsNavItems()` 的 `builtinMap` **没有 `enterprise`** → `map` 出 `undefined` → 访问 `item.id` 抛 `TypeError`，React 卸载整树 |
| **修复** | `SettingsPageWrapper.tsx` 补 `enterprise` 项；`map` 后 `.filter(Boolean)`                                                                                                                                             |
| **教训** | 改 `SettingsSider` 的 tab 列表时，**必须同步** `SettingsPageWrapper.getBuiltinSettingsNavItems()`                                                                                                                     |

### 4.2 超级助手创建员工 `Failed to fetch (127.0.0.1:port)`

| 项       | 内容                                                                                                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **现象** | UI 报 `TypeError: Failed to fetch`，不是 404 JSON                                                                                                                                         |
| **根因** | `httpPostLocal` 使用 `credentials: 'include'`；页面在 `http://localhost:5173`，API 在 `http://127.0.0.1:port`（跨域）。后端 CORS `Allow-Origin: *` 与带 cookie 请求不兼容，浏览器直接拦掉 |
| **修复** | `httpBridge.ts` 去掉 local 请求的 `credentials`（dev `--local` 无需 cookie）                                                                                                              |
| **教训** | curl/Node `fetch` 不过 CORS；**必须用浏览器/Electron 渲染进程或 CDP 测 POST**                                                                                                             |

### 4.3 employee API 404（旧后端）

| 项       | 内容                                                                           |
| -------- | ------------------------------------------------------------------------------ |
| **现象** | `GET/POST /api/one/employee/agents` → 404                                      |
| **根因** | dev 跑 Electron 内置 **0.1.41** 二进制，无 `one-employee` 路由                 |
| **修复** | `backend-rebuild.ps1` + `binaryResolver` 优先项目 `resources/`                 |
| **验证** | `curl http://127.0.0.1:{port}/health` 看 version；`POST` 带 `agentType` 应 200 |

### 4.4 侧栏改完整页黑屏（编译失败）

| 项       | 内容                                                                         |
| -------- | ---------------------------------------------------------------------------- |
| **根因** | `TeamSiderSection.tsx` 重构少闭合标签 → `tsc` 失败 → Vite HMR 后渲染进程挂掉 |
| **修复** | 补全 JSX；`bunx tsc --noEmit` 通过后再测 UI                                  |

### 4.5 暗色主题颜色问题

| 页面            | 问题                                        | 修复                                                                                                     |
| --------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 超级助手 → 设置 | 原生 `<select>` 下拉白底                    | 换 Arco `Select`；说明文字 `text-t-secondary`；`<code>` 加 `bg-fill-3`                                   |
| 设置 → 企业     | Tab「概览」几乎看不见；灰 Tag、Divider 太暗 | Tabs 加 `settings-remote-tabs`；标题/标签 `text-t-primary`；`arco-override.css` 补灰 Tag 与 Divider 暗色 |

### 4.6 主进程 console 冻死（历史坑，本轮未新增）

`src/process/` 禁止 `console.*`（会走 bridge 广播冻死主进程）。排查用 `appendFileSync` 写文件日志。见仓库 `CLAUDE.md` / `AGENTS.md`。

---

## 5. 冒烟测试清单（后续 AI 必做）

改完 **前端** 且在 `D:\aionui-m0` 工作时，至少执行：

```powershell
# 1. 若动过 1oneCore
D:\aionui-m0\scripts\backend-rebuild.ps1

# 2. 启动（无旧进程）
D:\aionui-m0\scripts\frontend-dev.ps1

# 3. 静态检查
cd D:\aionui-m0\1oneUI
bunx tsc --noEmit
bun run test tests/unit/common-adapter/httpBridge.test.ts
```

**必点路径（桌面窗口）**：

1. 侧栏：团队 / 项目 / **历史对话** 布局与滚动正常
2. **设置** → 模型页有内容，**不黑屏**
3. **设置 → 企业**：Tab、远端连接区、加入企业表单可读（暗色主题）
4. **超级助手 → 设置**：Agent 类型下拉正常（非系统白底）
5. **超级助手 → 创建数字员工**：成功，无 `Failed to fetch`

**日志确认**：

- `[aioncore] starting:` 路径为 `1oneUI\resources\bundled-aioncore\...`
- `/health` 的 `version` 与本地编译一致

**可选 CDP**（Electron 已开 `--remote-debugging-port=9230`）：

- 导航 `#/settings/model`、`#/settings/enterprise`、`#/super-assistant` 看 console 无 `TypeError`

---

## 6. 关键代码入口（给 CodeGraph / grep 用）

```
packages/desktop/src/common/adapter/httpBridge.ts    # getLocalBaseUrl, http*Local, credentials
packages/desktop/src/common/adapter/ipcBridge.ts     # personalAgent → http*Local
packages/desktop/src/process/backend/binaryResolver.ts
packages/desktop/src/renderer/pages/settings/components/SettingsSider.tsx
packages/desktop/src/renderer/pages/settings/components/SettingsPageWrapper.tsx
packages/desktop/src/renderer/pages/superAssistant/components/SettingsTab.tsx
packages/desktop/src/renderer/pages/enterprise/index.tsx
packages/desktop/src/renderer/pages/enterprise/components/RemoteServerSection.tsx
packages/desktop/src/renderer/components/layout/Sider/index.tsx
```

1oneCore：

```
crates/one-employee/src/routes.rs
crates/aionui-app/src/router/routes.rs   # CORS: Allow-Origin *
```

---

## 7. 未提交 / 未做事项

- **Git**：上述改动均在 `one-main` 工作区，**未 commit**（用户未要求推送）。
- **混合路由**：仅 `personalAgent` 本地化；会话/助手/cron 等远端模式行为待产品化拆分。
- **wecom 渠道**：日志有 `Invalid platform: wecom`（400），与本轮 UI 无关，后端/配置待查。
- **1one-command 旧仓**：`D:\1one-command` 为过渡期生产仓；本轮主要在 `aionui-m0`。

---

## 8. 时间线摘要

| 阶段                     | 内容                                        |
| ------------------------ | ------------------------------------------- |
| 侧栏 + i18n              | B 方案布局；历史对话命名                    |
| 超级助手 404             | 定位远端/旧二进制；`personalAgent` 本地化   |
| dev 启动自测             | `backend-rebuild`；发现 Electron 旧 bundled |
| `binaryResolver` 修复    | dev 用项目 `resources/`                     |
| 创建员工 Failed to fetch | CORS + credentials 修复                     |
| 设置黑屏                 | `SettingsPageWrapper` 缺 `enterprise`       |
| 暗色 UI                  | 超级助手 Select；企业页 Tabs/Tag/Divider    |

---

## 9. 相关文档

- 启动脚本说明：`D:\aionui-m0\scripts\README.md`
- 贡献 / 开发：`docs/contributing/development.md`
- WebUI / 远端：`docs/guides/webui.md`、`docs/prds/remote/webui/`

**本文路径**：`docs/guides/session-2026-07-07-evening.zh-CN.md`
