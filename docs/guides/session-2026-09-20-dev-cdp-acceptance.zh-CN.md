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

## 仍 intentionally 未做

- 干净机器安装器全量验收（§3.1 handoff）
- 宝云 Phase 4、完整 connector SDK（Octocrab 等）——当前为 HTTP 探测/同步 seam
