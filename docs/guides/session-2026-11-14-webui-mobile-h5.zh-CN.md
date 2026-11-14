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

## 同日追加：隧道访客「白屏转圈」诊断与 gzip 修复（commit 809c8a5e）

用户反馈：开启公网远程访问后，浏览器一直转圈打不开（`https://<subdomain>.r.1work.vip`，标题能出现、页面空白）。诊断结论：**不是穿透工具的问题**——当时实测隧道全链路健康：HTML 0.44s / 7MB 主 JS 1.5s / `/api/auth/status` 200 / `/ws` 升级 101；干净浏览器 9s 完整渲染出登录页；生产机是打包版 `onework.exe`（自带 bundle，与仓库 out/renderer 重建无关）。

**真根因**：web-host 的 serve-handler 6.1.7 **没有 compression 选项**（README 误导，源码里根本没有），渲染层一直**裸传 ~12.5MB** JS+CSS。弱网访客 2KB 的 HTML 先到（标题出现）、JS 拉不完 → React 不挂载 → 白屏转圈——与反馈截图完全吻合。

修复（`packages/web-host/src/static-server.ts`）：

- 惰性 gzip：首次请求压缩并缓存（LRU 48MB，key=`path+mtime+size` 重建即失效），按 `Accept-Encoding` 协商；无 gzip 客户端 / Range / 已压缩格式（图片字体视频）原样回退；br-only 客户端回退 identity（只实现了 gzip）。
- 关键路径 12.5MB → 3.8MB（index 7.15→2.18MB、vendor 5.26→1.57MB）。
- 顺带把该文件里 5 处历史遗留的裸控制字节（NUL/退格，其中 2 处是本次误写）转成正规 `\u0000`/`\b` 转义文本。
- 4 个新单测钉死行为（gzip 协商 / 无 AE 回退 / br-only 回退 / 解压校验）。

⚠️ **诊断坑（都是真实踩过的）**：

1. **含 NUL 字节的文件会让 grep 按"二进制"处理**（无 `-a` 时静默吞输出、Read 工具直接拒读）——web-host/static-server.ts 历史上就带一个裸 NUL。
2. **经 heredoc 传 python 的 `\\b`/`\u0000` 转义会被链路吞掉一层**，写进源码变成裸控制字节（0x08/0x00）——运行时大部分等价但 grep/正则全坏；规避：python 里用 `bytes([92])`（反斜杠码点）构造，不要写字面反斜杠转义。
3. 修复"没生效"时先排除：进程是否载的旧代码（tsx 需重启）、hash 路由同文档导航不换 bundle、SW 缓存——这次三个都排除了才定位到转义层。
4. 客户端已有 SW（v2）对 script/style 强制走网络 + MIME 守卫，旧缓存不是此类白屏的原因，别冤枉它。

**对已装 3.0.18 的存量用户**：gzip 修复要随下次发版才生效；立即可用的替代缓解是在 frps 的 nginx 上开 `gzip on; gzip_proxied any;`（边缘压缩，无需客户端更新）——需要服务器操作，另行确认。
