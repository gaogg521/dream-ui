# WebUI 手机端（H5）适配 — 会话中心/频道表单/设置页全量修复

> 日期：2026-11-14 · 仓库：dream-ui · 状态：已交付（真机验收待用户）

## 背景与结论

用户打通远程访问隧道后用手机（Android Chrome + iOS Safari/PWA）实测 WebUI，发现除会话首页（`/guid`）与聊天页外，其余页面要么全部压缩、要么元素重叠。本轮以「响应式修复打底 + 高频页 H5 化」路线交付：

- **P0 修复**：会话中心行网格（标题列归零、时间列裁切）、频道配置表单（描述挤成竖条）、`/assistants` 页头与 Tab 全竖排。
- **P1/P2 修复**：MCP/语音输入的 Arco 横向表单、外观字体行、WebUI 地址行、设置顶部 chips 渐隐、Memory 页 padding、`--app-min-width` 360→320。
- **新增**：WebUI 手机端底部快捷导航（首页/会话/定时任务/知识库/设置）。

聊天页和会话首页本来就有完整移动适配（`isMobile` 抽屉、MobileActionSheet、container query 等），本轮未动。

## 审计方法（可复用）

1. **独立 dev WebUI**：`bun run webui --no-build --no-open`（端口 25809，复用 legacy `~/.aionui-web-dev` 数据库，与生产 25808/Electron dev 完全隔离）。生产实例在跑时不要动 25808。
2. **登录**（不知道 dev 密码时）：`bun run resetpass` 会 403（needs_setup=false 时防误重置）——改走扫码登录同款链路：
   - `POST http://127.0.0.1:<后端端口>/api/webui/generate-qr-token`（仅本地直连，走代理会被 `reject_webui_proxied_middleware` 拒）拿 token；
   - 浏览器打开 `http://127.0.0.1:25809/qr-login?token=<token>` → 设 `dream-session` cookie。
3. **造测试会话**：`POST /api/conversations`，body `{"type":"dream","name":"…","extra":{}}`（只给 name 会 400）。
4. **移动仿真**：IAB `setViewportSize(390,844)` 即可触发 `isMobile`（浏览器端 `width<768` 分支，不需要 touch 仿真）；320px 复测小屏护栏。
5. ⚠️ **两个截图/加载坑**：
   - hash 路由是同文档导航：重编后必须 `tab.reload()` 且**先清 Service Worker 与 caches**（`aionui-webui-v2`）才能看到新包，否则一直跑旧 bundle 还以为修复没生效。
   - IAB `fullPage` 截图对单屏页面会拼出 2×2 重复伪影——页面实际无溢出，用视口截图 + 页内滚动。
6. 基线/修后截图存 `scratchpad/mobile-audit-1114/{before,after}/`。

## 修复清单

| 问题                                                                                                    | 位置                                                           | 修法                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 会话中心行固定网格 `minmax(0,1fr) 76px 140px 160px` ≈452px 起步，手机上标题列=0、日期列裁切             | `ConversationRow.tsx` / `SessionCenter/index.tsx`              | `detailed && isMobile` 改两行卡片（标题行 + 模式·模型·时间元信息行，`pe-20px` 避让常显 more 按钮）；`ConversationColumnHeader` 移动端不渲染  |
| 频道表单 `PreferenceRow` 7 份重复定义，左右布局把长描述挤成竖条                                         | `contents/channels/*ConfigForm.tsx`                            | 抽共享 `channels/PreferenceRow.tsx`（props 取并集：label/description/extra/required），移动端 `flex-col` 堆叠、控件全宽                      |
| `/assistants` 页头标题与 Tab 竖排：actions `shrink-0` 把 `flex-1` 标题挤到 0 宽；5 个 Tab×26px gap 超宽 | `SettingsPageHeader.tsx`                                       | 移动端标题/操作纵向堆叠（actions 改 `justify-start`）；Tab 改横向滚动 lane（`shrink-0 whitespace-nowrap` + `[scrollbar-width:none]`）        |
| MCP 图像/视频模型、语音输入的 Arco `layout='horizontal'` 窄列竖排 CJK label                             | `ToolsModalContent.tsx` / `VoiceInputSection/index.tsx`        | `layout={isMobile ? 'vertical' : 'horizontal'}`                                                                                              |
| 外观字体行换行散乱                                                                                      | `AppearanceModalContent/index.tsx`                             | 控件行 `justify-end` → `md:justify-end`                                                                                                      |
| WebUI 地址行不换行（窄 Electron 窗口）                                                                  | `WebuiModalContent.tsx` / `webuiTunnel/WebuiTunnelSection.tsx` | `flex-wrap` + URL 侧 `flex-1 justify-end`                                                                                                    |
| 设置顶部 chips 导航滚动无提示                                                                           | `settings.css`                                                 | `mask-image` 两缘渐隐                                                                                                                        |
| 手机到各主页面要反复开关抽屉                                                                            | 新增 `components/layout/MobileBottomNav.tsx` + `Layout.tsx`    | 5 个固定 tab；仅 `isMobile && !isElectronDesktop()` 挂载（Electron 窄窗保持桌面形态）；Content 内加等高 spacer（56px + safe-area）防内容被盖 |
| 320px 设备永久横向滚动                                                                                  | `styles/themes/base.css`                                       | `--app-min-width` 360px → 320px                                                                                                              |
| Memory 页桌面 padding 挤压小屏                                                                          | `pages/memory/index.tsx`                                       | 移动端 `12px 16px`                                                                                                                           |
| TeamPage 列宽 400px                                                                                     | `TeamPage.tsx`                                                 | **保留不动**：400px ≈ 手机屏宽，横滑 + snap 本就是窄屏设计                                                                                   |

i18n：`common.bottomNav.*` 5 键补齐全部 13 个 locale，`bun run i18n:types`（即 `node scripts/generate-i18n-types.js`）重新生成 `i18n-keys.d.ts`。

## 验证

- 四闸全绿：oxfmt（先 `npx oxfmt` 修 25 个文件漂移）→ `tsc --noEmit` 0 错 → `check-i18n.js` 过 → `vitest --changed origin/main` 32 文件 248 测试全过；`bun run package` 构建成功。
- 移动仿真复拍：390×844 全量 + 320×700 抽查，会话中心卡片流、Telegram 表单堆叠、`/assistants` 页头、MCP 表单、底部导航均正常，`scrollWidth == viewport` 无横向溢出。

## 未做 / 待办

- **真机验收**：隧道 frpc 只转发生产 25808，手机要看这批修复需等下次发版装包，或临时 `bun run webui --no-build --remote --port 25809` 后用手机连同一 WiFi 访问 `http://<LAN-IP>:25809`。
- 独立 H5 分包/移动组件库（路线三）与移动专属业务流：本轮明确不做。
