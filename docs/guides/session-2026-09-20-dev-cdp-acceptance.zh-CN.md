# 2026-09-20：DEV 统一 CDP 验收（图表缩放 + 连接器/协同收尾）

## 本轮代码收尾

| 仓             | 内容                                                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **dream-en**   | IntegrationsTab「立即同步」→ `POST /api/one/admin/integrations/{provider}/sync`；PlatformTab「测试中继」→ collaboration relay |
| **dream-core** | `POST /api/one/admin/platform/collaboration/relay`（`relay_collaboration`）                                                   |
| **dream-ui**   | `scripts/dev-cdp-acceptance.mjs`：在 **真实会话页** `#/conversation/:id` 验 Mermaid/WaveDrom 缩放（不经 `/test/components`）  |

## DEV CDP 怎么跑

脚本会：

1. 运行 `scripts/seed-dev-diagram-conversation.mjs`（bun + 本机 `%APPDATA%/dream-ui-Dev/1one/one-backend.db`，可用 `DREAM_DEV_USERDATA` 覆盖），写入 **助理侧（position=left）** markdown（用户气泡走纯文本，不会渲染 Mermaid/WaveDrom）；
2. 通过 CDP（Node + `ws`）打开 `#/conversation/<id>`，在 **MessageText → MarkdownView** 路径上点缩放控件。

```powershell
$env:DREAM_DEVTOOLS_CDP_PORT = "9230"
cd D:\dream\dream-ui
bun run dev
# 另开终端（dev 窗口需已启动且后端可用）
bun run dev:cdp-acceptance
```

已有会话时可跳过创建逻辑：

```powershell
$env:DREAM_CDP_CONVERSATION_ID = "<conversation-id>"
bun run dev:cdp-acceptance
```

可选企业 HTTP 冒烟（需 enterprise dreamcore + 管理员 token）：

```powershell
$env:DREAM_BACKEND_URL = "http://127.0.0.1:25808"
$env:DREAM_ADMIN_TOKEN = "<runtime token>"
node scripts/dev-cdp-acceptance.mjs
```

## 2026-09-20 深夜补验（另一会话）：图表复现 + @@ 投递首次真 E2E

### 结论

1. **图表缩放验收在干净环境复现成立**：重起 dev 实例后 `dev:cdp-acceptance` 全过
   （Mermaid 缩放 / WaveDrom 缩放 / 真实会话 UI / 夹具会话 `813c4bf3`）。
2. **@@ 投递此前从未被 E2E 验过**——本轮补上，全过。新脚本
   `scripts/dev-cdp-delivery-acceptance.mjs`：经 CDP 在页面里用 `window.__backendPort`
   直连本机后端（dev 本地模式无鉴权），真实建 A/B 两会话 → A 经真实发送边界发
   `@@conv:<B>` → 应用自身 1s drainer 投递 → 断言 B 历史出现
   `[[DREAM_SESSION_MESSAGE]]` 块、带原 user body、**无回信地址**
   （reply_requested=false）→ 导航 UI 到 B 断言块真实渲染。

### 本轮抓到的两个坑（下次直接避开）

| #   | 坑                                    | 现象                                                                                                                                                                                                                     | 处理                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **bundled 后端过期**                  | `bun run dev` 不自动编译 Rust，起的是 `resources/bundled-dreamcore/win32-x64/dreamcore.exe`（当时 09-19 18:07，早于 09-20 20:20 的投递提交）。`@@conv:` 原样落库、投递从未入队——功能"看起来没做"，其实是后端没有这份代码 | 关 dev 应用（文件被锁会 EPERM）→ `cargo build -p dream-core-app` → 拷 `target/debug/dreamcore.exe` 到 `resources/bundled-dreamcore/win32-x64/` → 重启 dev。原 `backend-rebuild.ps1` 在旧工作区布局（`D:\旧中转目录\scripts\`），改名搬迁后未随仓，暂用上述手动等效流程 |
| 2   | **CDP 页面目标 WS 单客户端 + 脏槽位** | 同一 page target 的 `webSocketDebuggerUrl` 一次只允许一个调试客户端；被强杀的脚本（Windows 上杀 bash 管道可能留下孤儿连接）会让后续所有连接 `open` 永久挂起，且 `connectCdp` 无超时保护，表现为脚本静默卡死              | 关掉全部 dev 实例重启一个干净的，让验收脚本成为第一个客户端；根治需要给 `dev-cdp-acceptance.mjs` 的 `connectCdp` 加超时                                                                                                                                                |

### 附：消费测试改动的后端三步（手动版 backend-rebuild）

```powershell
# 1) 关掉所有 dev 应用实例（dreamcore.exe 被占用会 EPERM）
cd D:\dream\dream-core
cargo build -p dream-core-app
copy target\debug\dreamcore.exe ..\dream-ui\resources\bundled-dreamcore\win32-x64\dreamcore.exe
cd ..\dream-ui; bun run dev   # 再开验收
```

## 仍 intentionally 未做

- 干净机器安装器全量验收（§3.1 handoff）
- 宝云 Phase 4、完整 connector SDK（Octocrab 等）——当前为 HTTP 探测/同步 seam
- 真实 IdP 往返（SAML 需 Okta/SimpleSAMLphp、SCIM 需 Okta/Azure AD 真推送）——
  单测水位已补齐（见 dream-core 本轮 session doc），真环境验收仍欠
