# 开发会话记录：2026-07-08（1ONE CLI 品牌 + 助手按本机 CLI 过滤）

> **读者**：后续接手的 AI。  
> **状态**：`one-main` — 前端 `7cef2d2`+，后端 `e2eeb13`+；**v2.1.32** 含图标 + Cursor 路径探测补全。

---

## 1. 需求

1. 会话窗口 / 助手列表里 **「Aion CLI」** 显示为 **「1ONE CLI」**（仅品牌名，不改 `aionrs` 类型与路由）。
2. **助手页与首页**只显示本机**已安装且可用**的 CLI 助手；未安装的不默认列出（如仅装了 Claude、Cursor、OpenClaw）。
3. 用户确认：**改名与过滤不影响已有会话**（底层仍是 `aionrs` / 各 `acp_backend`）。

---

## 2. 实现摘要

### 2.1 显示名「1ONE CLI」

| 层                | 文件                                                                                             | 说明                                            |
| ----------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| 前端统一          | `renderer/utils/model/assistantDisplay.ts` → `resolveAssistantName()`                            | `aionrs` 或旧名 `Aion CLI` → `1ONE CLI`         |
| 会话首页          | `guid/components/AssistantSelectionArea.tsx`                                                     | 用 `resolveAssistantName`                       |
| 设置 → 助手       | `MyAssistantRow`、`OfficialAssistantsGrid`、`AssistantListPanel`、`index.tsx`、`BoundAssistants` | 同上                                            |
| 编辑器 Agent 下拉 | `assistantUtils.ts` → `buildAssistantEditorBackends`                                             | `agent_type === 'aionrs'` → `1ONE CLI`          |
| 后端显示名        | `1oneCore/.../enums.rs`                                                                          | `AgentType::Aionrs.display_name()` → `1ONE CLI` |
| DB 迁移           | `migrations/019_rename_aion_cli_to_1one_cli.sql`                                                 | 更新 `agent_metadata` + `assistant_definitions` |

**不影响会话**：`agent_id`、`agent.type`、IPC/API 路径不变。

### 2.2 只显示本机已安装的 CLI 助手

| 文件                                           | 逻辑                                                                                                                         |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `renderer/utils/model/assistantSelection.ts`   | 新增 `isInstalledGeneratedCliAssistant()`：`source === 'generated'` 时仅 `agent_status === 'online'` 或 **内置 aionrs** 显示 |
| `selectableAssistants()`                       | 会话首页胶囊共用此过滤                                                                                                       |
| `AssistantSettings/home/AssistantHomeTabs.tsx` | 「我的助手」列表共用此过滤（替代仅隐藏 `missing`）                                                                           |

**Agent 状态来源**（1oneCore `AgentRegistry`）：

- `online`：探测到 CLI 可用 → **显示**
- `missing` / `unchecked` / `offline`：未安装或未扫描 → **隐藏**（generated 类）
- `aionrs`（internal）：内置 → **始终显示**

**已装但未出现**：启动时可能仍是 `unchecked`，需 **设置 → Agent → 扫描本地 Agent** 后变为 `online`。

### 2.3 Cursor 未检测到（2026-07-08 坑）

| 误解                                    | 事实                                                                                                             |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 「我用 Cursor 跟你聊」= 应检测到 Cursor | **Cursor IDE**（本聊天窗口）≠ **Cursor Agent CLI**（终端里的 `agent` 命令）                                      |
| 列表里应有 Cursor                       | 旧种子写死探测 `cursor`；Windows 实际装在 `%LOCALAPPDATA%\cursor-agent\`，命令是 **`agent`**（ACP：`agent acp`） |

**修复（两层）**：

1. 迁移 `020_fix_cursor_agent_cli_command.sql`：把 `command` / `binary_name` 从 `cursor` 改为 **`agent`**。
2. `aionui-runtime/resolver.rs`：`resolve_command_path("agent")` 在 PATH 未命中时，回退探测 **`%LOCALAPPDATA%\cursor-agent\agent.exe`**（及 `.cmd` 等 shim）。

**Claude Code**：种子仍为 `binary_name: claude`，经 bundled `claude-agent-acp` 桥接；需本机 `claude` 在 PATH 且 **设置 → Agent → 扫描本地 Agent** 后 `agent_status` 才为 `online` 并出现在首页胶囊。

**生效**：`backend-rebuild.ps1` → 安装/启动 **v2.1.32+** → **设置 → Agent → 扫描本地 Agent**。

### 2.4 1ONE CLI 会话图标（旧 Aion 黑圆标）

| 现象                                        | 根因                                                            |
| ------------------------------------------- | --------------------------------------------------------------- |
| 首页左侧 **1ONE CLI** 胶囊仍是黑底 A 字旧标 | `agent_metadata.icon` 仍指向 `/api/assets/logos/brand/aion.svg` |

**修复**：

- 资源：`crates/aionui-assets/assets/logos/brand/1one.png`（与桌面 `resources/app.png` 同款吉祥物）
- 迁移 `021_rebrand_aionrs_icon_to_1one.sql`：更新 `agent_metadata.icon` 与 `assistant_definitions.avatar_value`

### 2.5 会话首页右下角友情提示

- 组件：`guid/components/GuidAuthorTip.tsx`
- i18n：`guid.authorTip.*`（12 语言）
- 挂载：`GuidPage.tsx` 容器右下角

### 2.6 关于页外链（2026-07-08）

| 项                                | 新值                                 |
| --------------------------------- | ------------------------------------ |
| GitHub 图标 / 帮助文档 / 更新日志 | `https://github.com/gaogg521/1oneUI` |
| 官网                              | `https://1one.1oneclaw.com`          |

文件：`packages/desktop/src/renderer/components/settings/SettingsModal/contents/AboutModalContent.tsx`  
**生效**：仅前端 → `frontend-dev.ps1`，刷新设置 → 关于页。

---

## 3. 前后端加载（本次改动怎么生效）

| 改动类型                                                              | 命令                                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **仅前端**（`assistantDisplay.ts`、`assistantSelection.ts`、助手 UI） | `D:\aionui-m0\scripts\frontend-dev.ps1`，刷新窗口                                    |
| **含 1oneCore**（迁移 `019`/`020`/`021`、Cursor `agent` 路径探测）    | `backend-rebuild.ps1` → `frontend-dev.ps1` 或安装 `out/1ONE Code-2.1.32-win-x64.exe` |

验证迁移：重启后 assistant 列表名称为 `1ONE CLI`（DB 层）；仅前端时 `resolveAssistantName` 也会强制显示 `1ONE CLI`。

---

## 4. 测试

```powershell
cd D:\aionui-m0\1oneUI
bunx vitest run tests/unit/renderer/assistantSelection.test.ts
bunx vitest run tests/unit/renderer/hooks/guidAssistantSelectionArea.dom.test.tsx
bunx vitest run tests/unit/assistants/useDetectedAgents.dom.test.ts
```

桌面冒烟：

1. 设置 → 助手：CLI 区只剩本机 `online` 的项 + **1ONE CLI**
2. 会话首页：胶囊与助手页一致
3. 旧会话打开、发消息正常

---

## 5. 关键代码入口

```
packages/desktop/src/renderer/utils/model/assistantDisplay.ts   # resolveAssistantName
packages/desktop/src/renderer/utils/model/assistantSelection.ts # isInstalledGeneratedCliAssistant
packages/desktop/src/renderer/pages/guid/components/GuidAuthorTip.tsx
crates/aionui-runtime/src/resolver.rs                           # cursor-agent install path for `agent`
crates/aionui-db/migrations/020_fix_cursor_agent_cli_command.sql
crates/aionui-db/migrations/021_rebrand_aionrs_icon_to_1one.sql
crates/aionui-ai-agent/src/registry.rs   # derive_management_status / refresh_availability
```

**发行包（Windows x64）**：`D:\aionui-m0\AionUi\out\1ONE Code-2.1.32-win-x64.exe`

---

## 6. 相关文档

- [AI 交接约定（改完必写文档 + 加载对照）](ai-handoff-conventions.zh-CN.md)
- [2026-07-07 晚间会话](session-2026-07-07-evening.zh-CN.md)
- `D:\aionui-m0\scripts\README.md`

---

## 7. 后续修订（2026-07-08 下午，装了就显示 + 登录渠道 + Cursor 澄清）

> 承接第 2 节。用户实测「明明装了 Cursor 却不显示」，据此把可见性判据从**「只显示 online」订正为「装了就显示」**，并附带修复企业登录渠道。**仅改源码，未重打包**（等实测后再出包）。提交：AionUi `63957f3`、AionCore `8403b02`。

### 7.1 Cursor 可见性：online → online‖offline（订正第 2.2 节）

- **根因**：第 2 节的过滤 `isInstalledGeneratedCliAssistant` 只放行 `agent_status==='online'`。而 `online` 要求 `agent acp` 的 ACP 握手成功；**Cursor Agent CLI 需先登录**，未登录时握手失败被判 `offline` → 被隐藏。冷启动未扫描则是 `unchecked` → 也隐藏。
- **澄清（Cursor 装哪）**：app 探测的是 **Cursor Agent CLI**（命令 `agent` / `cursor-agent`，装在 `%LOCALAPPDATA%\cursor-agent\`），**不是** Cursor 编辑器 `…\Programs\cursor\Cursor.exe`。本机 `agent` 已在 PATH（`…\cursor-agent\agent.cmd`），路径本就找得到——「找不到」与安装目录无关。切勿把命令手填成 `Cursor.exe`（`Cursor.exe acp` 非 ACP 协议，必失败）；迁移 `020` 会在重编后把命令强制重置回 `agent`。
- **前端**（`assistantSelection.ts`）：`isInstalledGeneratedCliAssistant` 改为 `agent_status === 'online' || agent_status === 'offline'`（已安装即显示；隐藏 `missing`/`unchecked`）。后端已区分 `missing`(没装) / `offline`(装了握手失败) / `online`(可用)。
- **后端**（`crates/aionui-assistant/src/service.rs` `reconcile_generated_assistants`）：生成型助手行的过滤从 `Online|Unchecked` 放宽到 **含 `Offline`**，否则「启动探测先把安装但离线的 agent 置 Offline → 不生成助手行」，前端无从显示。补单测 `bootstrap_materializes_generated_assistant_from_offline_agent`。
- **预期**：重编后点「一键扫描全部」→ Cursor 以「离线/需登录」出现；在 Cursor Agent CLI 登录后再扫描 → 变 `online` 才能真正对话。

### 7.2 1ONE CLI 猫图标：源码已就位，重编即生效

- 猫 logo = `app.png`（前端）/ `1one.png`（后端 `aionui-assets` crate，同一张 236431B 粉猫图）。迁移 `021` 已把 aionrs `agent_metadata.icon` → `/api/assets/logos/brand/1one.png`，`reconcile_generated_assistants` 每次启动从 icon 同步到生成助手 `avatar_value`，avatar 投影对 `/api/` 路径正常输出图片（`is_local_avatar_value` 对 `/api/` 返回 false）。
- **无需改码**——用户仍看到旧暗色菱形只因运行的是旧后端构建（迁移未跑、猫图未嵌入旧二进制）。重编后端后自动变猫。

### 7.3 企业登录渠道桌面端不跳转 / 置灰

- **根因**：`packages/desktop/src/renderer/pages/enterprise/components/EnterpriseLoginChannelPanel.tsx` 用**相对路径** `fetch('/api/one/sso/providers')`。桌面 Electron 渲染进程是 `file://`，相对 `/api` 打不到后端（在 `http://127.0.0.1:{port}`）→ providers 永远空 → 飞书/钉钉/企微/LDAP 全判 `not_configured` → 按钮 `disabled` → 点不动、无从跳转。
- **修**：改用 `getBaseUrl()`（`@/common/adapter/httpBridge`；WebUI→''同源、桌面→`127.0.0.1:port`、企业远端→远端 URL）拼绝对地址。渠道跳转机制（`enterpriseBrowserLogin.ts` 的 `ensureWebuiRunning` + `openExternalUrl`）为既有设计未动；若修后跳转本身仍失败，再考虑单机走本地后端 origin + `desktop=1` 深链（AionCore `/api/one/sso/{provider}/authorize?desktop=1` → `aionui://sso-callback?token=`，已确认支持）。

### 7.4 验证 / 待办

- 前端 `tsc --noEmit` 无错、`oxlint` 干净、`assistantSelection` 单测 8/8。
- 后端 crate 编译过，`reconcile` 8/8 + `bootstrap_materializes` 5/5（含新 offline 用例）。
- **待办**：重编（AionCore release + AionUi）+ `dist:win` 出新包（bump 版本、不删旧 .exe）→ 用户实测 ①②③。
