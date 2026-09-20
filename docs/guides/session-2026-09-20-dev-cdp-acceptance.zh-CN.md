# 2026-09-20：DEV 统一 CDP 验收（图表缩放 + 连接器/协同收尾）

## 本轮代码收尾

| 仓             | 内容                                                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **dream-en**   | IntegrationsTab「立即同步」→ `POST /api/one/admin/integrations/{provider}/sync`；PlatformTab「测试中继」→ collaboration relay |
| **dream-core** | `POST /api/one/admin/platform/collaboration/relay`（`relay_collaboration`）                                                   |
| **dream-ui**   | `/test/components` 增加 Mermaid + WaveDrom CDP fixture；`scripts/dev-cdp-acceptance.mjs`                                      |

## DEV CDP 怎么跑

```powershell
$env:DREAM_DEVTOOLS_CDP_PORT = "9230"
cd D:\dream\dream-ui
bun run dev
# 另开终端
bun run dev:cdp-acceptance
```

可选企业 HTTP 冒烟（需 enterprise dreamcore + 管理员 token）：

```powershell
$env:DREAM_BACKEND_URL = "http://127.0.0.1:25808"
$env:DREAM_ADMIN_TOKEN = "<runtime token>"
node scripts/dev-cdp-acceptance.mjs
```

## 2026-09-20 本机结果

在 `DREAM_DEVTOOLS_CDP_PORT=9230` + `bun run dev` 下执行 `bun run dev:cdp-acceptance`：

- PASS：CDP 9230 监听
- PASS：Mermaid / WaveDrom pan/zoom（穿透 ShadowView 查询 `data-testid`）
- SKIP：企业 HTTP（未设 `DREAM_BACKEND_URL`）

## 仍 intentionally 未做

- 干净机器安装器全量验收（§3.1 handoff）
- 宝云 Phase 4、完整 connector SDK（Octocrab 等）——当前为 HTTP 探测/同步 seam
