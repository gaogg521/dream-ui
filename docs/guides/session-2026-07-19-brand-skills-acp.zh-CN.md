# 品牌缺口补齐：注入技能 / ACP 身份 → 1One Work（2026-07-19）

> 给后续 AI。关联上游同步总表 [`session-2026-07-19-upstream-sync-changelog.zh-CN.md`](session-2026-07-19-upstream-sync-changelog.zh-CN.md)。

---

## 现象

助手回答「你能为我做哪些事情？」时自称 **「AionUi 的 AI 助手」**。  
UI locales 早已是 **1One Work**，但模型上下文里仍大量出现 AionUi。

## 根因

| 已刷                                       | 未刷（会进模型提示）                                      |
| ------------------------------------------ | --------------------------------------------------------- |
| 前端 `locales` 用户可见串                  | Core **内置技能**文案（尤其 auto-inject `aionui-config`） |
| 窗口产品名 / 部分 UI                       | **ACP** `clientInfo.name = "AionUi"`                      |
| 管家规则 `aionui-assistant.*.md` 已是 1ONE | `cmd_capabilities` 里 config/diagnose 描述仍写 AionUi     |

技能会 materialize / 注入会话 → 模型按语料自称上游品牌。

## 修复（已 commit）

**仓**：`1oneCore` `sync-v0148`  
**Commit**：`9504fa47` — `fix(brand): 注入技能与 ACP 身份改为 1One Work`

| 改动                                  | 路径                                                                                                                         |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 用户可见产品名 `AionUi` → `1One Work` | `assets/builtin-skills/auto-inject/aionui-config`、`aionui-troubleshooting`、`aionui-webui-*`、`openclaw-setup`、`morph-ppt` |
| ACP 客户端名                          | `crates/aionui-ai-agent/src/protocol/acp.rs` → `"1One Work"`                                                                 |
| capabilities 描述                     | `crates/aionui-app/src/commands/cmd_capabilities.rs`                                                                         |

**刻意保留（勿再盲替换）**：

- 技能 ID：`aionui-config` / `aionui-troubleshooting` …
- 环境变量：`$AIONUI_HELPER_BIN`、`AIONUI_BASE_URL` …
- 真实路径 / 上游仓库 URL：`%APPDATA%/AionUi`、`github.com/iOfficeAI/AionUi/...`、`/Applications/AionUi.app`（若存在）

盲替换曾踩坑：把 `$AIONUI_*` 写成 `$1One Work_*`、把 `name: aionui-config` 改坏。重做时必须保护这些 token。

## 验证（隔离 dev，2026-07-19 22:22）

- 数据目录：`%APPDATA%\1one-Dev`（不动正式安装）
- 窗口标题 CDP：`1One Work`
- materialize 后 `aionui-config/SKILL.md`：`AionUi=0`，`1One Work≥1`，`$AIONUI_HELPER_BIN` 仍在
- `/api/skills`：`AionUi=0`，`1One Work>0`
- 含本修复的 `aioncore.exe` 约 **22:20** 已嵌入 bundled

## 品牌分层（接手记住）

| 层         | 显示名                             | 说明                                        |
| ---------- | ---------------------------------- | ------------------------------------------- |
| 产品 / UI  | **1One Work**                      | locales、技能散文、ACP clientInfo、窗口标题 |
| 安装器     | **1ONE Code** / `1onecode.exe`     | `electron-builder.yml`                      |
| 内置 Agent | **1ONE CLI**                       | `AgentType::Aionrs.display_name`            |
| 管家规则   | **1ONE 管家**                      | `builtin-assistants/rules`                  |
| 内部 ID    | `aionui-*` / `AIONUI_*` / `aionrs` | 不改，避免断链                              |

## 仍可能残留

- 源码注释、版权头、`console.log('[AionUi] …')`、测试夹具路径字面量
- 用户 DB 里旧助手自定义 system prompt（需用户自己改或新建会话）
- 未在本次列表中的其它 builtin skill 散文（按需再扫）

出包前确认 bundled `aioncore.exe` ≥ 含 `9504fa47` 的 release build。
