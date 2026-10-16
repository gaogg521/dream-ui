# One Work 知识库改造交接

> 后续保存状态补充：三个仓库已建立本地 `checkpoint/knowledge-20261016` 快照提交，并导出通过校验的 Git bundle。核心快照 `8cb6181` 包含尚未合入 main 的企业启动接线与 AD 依赖；桌面快照 `0811195`；企业后台快照 `5612858`。这些快照包含其他任务的并存改动，仅作完整 DEV 状态备份，不得整体合并主线。本地恢复说明：`D:/dream/outputs/knowledge-checkpoint-20261016/README.md`。下文“本轮未 push”是交接当时的历史状态，后续远端提交以 Git 为准。

更新时间：2026-10-16，截至本次交接。这是交给后续 AI 的当前状态说明。旧文档中的“Office 尚未接入”等句子是按日期累积的历史记录，应以本文和最新日期记录为准。

## 1. 用户目标与已确认范围

把个人版与企业内部知识库改造成 WorkBuddy 风格的资料库，重点是使用体验，而不是仅有接口和表单。

- 页内阅读、编辑，保留资料目录，不用独立弹窗承载文档。
- 目录可拖拽调整、收起、自动适配长名称；页面导航压缩为一行。
- Markdown 默认支持图文、表格、粘贴、自动保存。
- 搜索覆盖标题与正文，导入和保存后自动处理索引。
- 保留原件，PDF、Office、图片、音视频按实际文件展示，不能用提取纯文本冒充原件阅读。
- 企业团队空间打通企业成员与权限。
- Office 路线由用户明确选择：**个人离线 + 企业内网，分别支持**。
- 内置两份原创教程，学习 WorkBuddy 的资料组织和复用方式。
- 本轮范围是企业内部资料库；公共外链分享、HTML 小应用发布不纳入本轮。
- 用户要求实际在 DEV UI 点击和验收，不允许把编译、单元测试或独立引擎示例成功当成产品完成。
- 用户已明确授权 AI 自行重启 DEV，不要反复让用户手工重启。
- 用户允许验收时双方使用鼠标；检测到用户输入后重新观察窗口，不要继续使用旧坐标。

## 2. 本轮经历与主要问题

### 第一阶段：资料库布局与企业联动

从管理表单改为左侧资料目录、右侧资料列表或文档工作区。加入个人资料与团队空间、最近访问、搜索和状态过滤、目录宽度调整；企业后台的知识库、检索测试、配置、Embedding 端点合并为同一行导航。修复标题、工具栏与位置标签在窄容器中挤压换行的问题。

用户多次指出空白过大、重复导航、标题截断、弹窗编辑和纯文本预览不符合产品预期。因此后续验收以实际页面为准，不能仅凭 API 可用判定达标。

### 第二阶段：图文编辑、自动保存、导入与正文搜索

新建和编辑 Markdown 使用图文编辑器；支持标题、段落、表格、图片插入和粘贴，保存状态显示正在保存、已自动保存或失败。资料页内编辑、返回和切换时保护未保存修改。

修复个人导入错误 `scope must be 'org' or 'team'`，个人资料正确登记为 personal，并避免绑定到不匹配的企业目录。浏览器文件选择器和桌面导入保留原件，提取正文后排队建立索引。搜索从标题过滤扩展到标题与已保存正文。

修复原件替换后旧正文与旧向量仍命中的问题：替换时清除旧正文、片段和词法索引，再按新原件提取、保存和重建；更新已保存快照，避免返回时错误提示未保存。无可提取正文的资料保留原件，零片段并给出提示。

### 第三阶段：原件阅读

建立按文件类型分派的页内原件阅读。PDF 保留原始分页、缩略图和缩放；图片、音频、视频依浏览器实际支持展示。HTML 在隔离 iframe 中运行，禁止同源权限和外部连接。DOCX 使用文档排版预览，PPTX 使用幻灯片预览，Excel 使用工作表数据预览。

注意：Office 的快速阅读组件与原版编辑引擎是两条路径。Excel 快速预览最多 2000 行、100 列，不还原图表和全部原始样式。不要说所有格式已经高保真预览。

### 第四阶段：WorkBuddy 实际学习与教程

实际打开、滚动阅读 WorkBuddy 的“一分钟玩转资料库”“资料库新手教程”，查看更多菜单、文档信息、版本历史、PDF 工具栏等。观察到版本历史侧栏、关联任务、人机改写、HTML/CSV 工作台等能力，但没有逐一完成对方所有功能的操作验证。

WorkBuddy 网页版 PDF 显示腾讯文档技术支持；某个个人 MP4 在网页版明确显示暂不支持预览。不能把用户对竞品的概括当成已经验证“所有 Office、视频、设计格式都能在线编辑”。

新增两份原创内置教程：“一分钟上手资料库”“资料库使用指南”，有中英文，首页帮助卡和侧栏可以页内打开。内容围绕客户档案、会议记录、项目清单、原件与正文搜索、保存与权限边界，不直接复制竞品文章，不写入私人资料污染检索。

### 第五阶段：Office 引擎验证与产品接入

先用生成的测试文件独立验证 ONLYOFFICE 和本地 ZetaOffice，再接入产品。独立示例成功与产品接入成功严格分开记录。

个人版：本地 WASM 引擎、Electron 隔离视图、文件保存回写、中文输入桥接、离开前保存和失败重试。

企业版：内网 ONLYOFFICE、后端签发文档会话、受保护原件能力地址、签名回调、版本条件保存、正文提取和索引、页面自动保存及离开保护。

### 第六阶段：2026-10-16 重启恢复与实际回归

电脑重启后自行恢复个人 DEV、企业后台 Vite、WSL/Docker 企业 QA 和 ONLYOFFICE。保留企业 18 份、个人 16 份现有资料。

企业镜像构建曾卡在 ONNX 官方运行时下载。取消本次自有构建，按 crate 官方清单下载并校验运行时，再用 BuildKit 缓存完成编译；不是跳过依赖校验。

在企业页面实际修改 Word、Excel、PPT，等待自动保存，切回阅读确认新内容；下载原件和读取内容接口交叉验证。Word 新正文词在资料列表搜索命中。

个人离线文件菜单实测发现“打开其他文件”能进入 WASM 文件选择器并报错。先尝试 JS UNO 分派拦截，未通过实测后撤回。最终改用引擎禁用命令配置、**文档级**菜单/工具栏过滤，以及快捷键拦截。发现 Writer 的真实命令是 `OpenFromWriter`，不是通用 `Open`，补齐别名。最新实际窗口中不再出现新建、打开、另存为、关闭和模板入口；中文输入、自动保存、原件回写继续通过。

## 3. 当前实现结构

### dream-ui：个人桌面与共享资料库 UI

仓库：`D:/dream/dream-ui`。

关键目录：`packages/desktop/src/renderer/pages/knowledge/`。

- `KnowledgeLibrary.tsx` / `.module.css`：资料目录、列表、搜索、紧凑头部；搜索等待期间明确显示加载状态。
- `LibraryDocument.tsx`：页内阅读与编辑、原件阅读器和引擎选择。
- `original/OfflineOfficeEditor.tsx`：个人离线编辑组件，订阅引擎保存事件，上传原件成功后才确认保存；失败保留会话并重试。
- `original/intranet/OfficeEditor.tsx`、`officeApi.ts`：企业内网编辑组件，使用企业 HTTP 桥接。
- `guides/`：内置两份中英文教程。
- `pages/superAssistant/registries/RagSection.tsx`：导入、内容保存、资料切换保护、Office 保存后刷新正文和元信息。

离线引擎边界：

- `src/common/types/offlineOffice.ts`：IPC 合同。
- `src/preload/office.ts` 与 `preload/main.ts`：主窗口及引擎视图的受限 IPC 暴露。
- `src/process/office/nativeOffice.ts`：沙箱 WebContentsView、所有者/主 frame 校验、大小和布局限制、关闭前刷新、视图生命周期。
- `runtimeServer.ts`：随机 loopback 路径、静态资源白名单、哈希验证、COOP/COEP/CSP。此服务器不发布文档原件目录。
- `runtime/office-host.js`：WASM 启动、文件桥接、修改计数、防并发保存、保存确认。
- `runtime/office-thread.js`：UNO 模型载入/保存、宏禁用、受管文件命令配置和菜单过滤、UNO 错误信息解包。
- `runtime/office-input.js`：真实 DOM textarea 接收中文 IME/粘贴，再转给 Qt；避免组合输入重复，阻止替换文档的快捷键。
- `scripts/offline-office-manifest.json`、`prepareOfflineOffice.mjs`：固定大小/校验和的引擎、CJK 字体、许可证准备和验证。
- `resources/offline-office/`：约 280 MB 的忽略目录，不能提交 vendor 大文件。构建时准备资源，Electron extraResources 收入；本轮没有打安装包验收。

### dream-en：企业后台

仓库：`D:/dream/dream-en`。

`admin-web/src/console/components/` 下的 KnowledgeLibrary、LibraryDocument、KnowledgeBasesTab 与原件阅读组件提供企业版本；`original/intranet/` 的编辑器与桌面端对应实现保持同步，API 适配器不同。

`docs/knowledge-office-intranet.zh-CN.md` 记录配置、权限与验收；其中较早的待验收段落应结合末尾 10 月 16 日更新阅读。

### dream-core：原件、检索与内网 Office 保存

仓库：`D:/dream/dream-core`。

- `crates/dream-domain-devops/src/rag_files.rs`：受保护原件读写、Range 支持、替换时旧检索数据失效（前一阶段已提交）。
- `office_session.rs`：配置验证、HS256 签名、用途隔离能力票据、到期验证、引擎回调签名验证、下载地址限制。
- `office_service.rs`：会话持久化、成员与资料权限复查、强制保存命令、回调保存、原件版本条件更新、正文提取与后台索引。
- `office_text.rs`：Word/PPT OOXML 文字提取、Excel 数据提取、解压与稀疏大表保护。
- `office_routes.rs`：可用性、创建会话、刷新保存，以及能力票据保护的引擎取文件/回调路由。
- `dream-core-api-types/src/knowledge_office.rs`：前后端合同。
- `dream-core-app/src/router/knowledge_office.rs` 及 router 接线（enterprise-only 配置、活跃成员与 AD 身份复查、构建 OfficeService、挂载引擎路由）已随 `d31f814` 推送；AD 门限接线待 AD/LDAP 任务落地后补上。

企业 Office API：

```text
GET  /api/one/devops/office
POST /api/one/devops/rag/documents/{id}/office
POST /api/one/devops/office/sessions/{id}/flush
GET  /api/one/devops/office-engine/source?token=...
POST /api/one/devops/office-engine/callback?token=...
```

能力票据不是匿名开放文件地址。引擎取文件和回调仍复查会话、成员、AD 身份、读写权限和原件版本。不要绕过这些检查来解决接线依赖。

保存链路：浏览器修改 → 等引擎同步 → 服务端 force-save 带请求 nonce → 引擎签名回调 → 限定缓存地址下载 → 再次校验权限/版本 → 原件写入新 UUID → 数据库条件更新正文/状态 → 后台重建索引 → UI 显示已保存。

保护点：24 小时会话与编辑 JWT、重复/延迟回调拒绝覆盖新版本、旧会话不能覆盖别人后来保存的原件、持久会话与 pending journal 恢复、错误不伪报保存成功、下载禁止重定向。限制为原件 100 MiB、正文 16 MiB、解压 128 MiB、Excel 矩形一百万单元格。

## 4. 已实测的结果与证据

### 图文、导入和阅读

- 企业 Markdown 粘贴图文表格、插入 PNG、自动保存、刷新重开、正文独有词搜索已通过。
- 10 月 16 日复用 `QA图文粘贴与自动保存1015.md`，追加 `紫杉协作1016`，图片/表格/正文重开保留，正文搜索命中。
- 个人浏览器与企业端导入 Word、PPT、Excel、可提取文字 PDF 和文本格式的前一阶段回归通过；个人登记 personal。
- PDF 原始分页与缩略图、PNG、WAV 播放、原件字节、206/416、私人原件访问拒绝有前一阶段证据。
- HTML 测试按钮实际运行，企业测试显示交互成功与主程序访问隔离。
- 原件替换后新版正文命中、旧版正文不命中，两端已实测。

### 个人 Office

10 月 15 日真实 DEV：Word 中文输入与中文 IME、保存再读；Excel `SUM(1,2)` 保留公式和值 3、合并单元格；PPT 新增第三页，图片和表格保留。

10 月 16 日菜单修复后实际 Word 输入 `离线菜单回归1016`，页面显示已自动保存，内容接口包含新文字；下载 DOCX 并拼接 XML 文本节点确认新增文字与先前中文内容均保留。注意字体切换会拆分 XML run，不能用未解析 XML 的单字符串包含检查误判失败。

个人测试文件 ID：

```text
Word  orag_01a13f8c48bc7a038a7fe36599c10591
Excel orag_01a13f8c48d87003a8d3f2050fabaf4c
PPT   orag_01a13f8c48f27f23bb90bcf01f8ed211
```

### 企业 Office

10 月 16 日产品页面真实修改：

- Word 写入 `企业原版保存1016`，自动保存，切回阅读有新文字、原两页分页保留；正文关键词搜索命中并显示已就绪。
- Excel A1 写入 `企业表格1016`，自动保存，切回数据阅读有新文字、合并单元格保留。
- PPT 写入 `企业演示1016`，自动保存，切回阅读有新文字、原表格保留。
- 三种受保护原件下载验证有修改；PPT 原件还有 1 张图片。三种内容接口均更新正文。
- 最新部署后重新打开 Word 编辑器成功；新会话 JWT 有效期核实为 24 小时。

企业测试文件 ID：

```text
Word  orag_01a13d9bce357a209430b4f3e4978a6b
Excel orag_01a13d9bcedc73b1842b98b9210b41a4
PPT   orag_01a13d9bce717c908b66de5a1c1b1dd3
```

证据均位于 `D:/dream/outputs/`：

```text
knowledge-enterprise-rich-restart-1016.jpg
knowledge-enterprise-office-editor-1016.jpg
knowledge-enterprise-office-final-1016.jpg
knowledge-enterprise-office-before-1016-{word.docx,excel.xlsx,pptx.pptx}
knowledge-enterprise-office-saved-1016-{word.docx,excel.xlsx,pptx.pptx}
knowledge-personal-office-saved-1016-word.docx
knowledge-office-native-{word,excel,pptx}-saved-1015.*
```

### 测试与编译（存在重复覆盖，不要累计相加）

- 后端 `cargo test -p dream-domain-devops --lib office_ --no-default-features`：最新 10 项通过，含编辑 JWT 到期、权限撤销、重启恢复、旧会话覆盖拒绝、回调重复/延迟、无回调不得伪报保存、稀疏 Excel 限制。
- 企业 app `cargo check -p dream-core-app --features enterprise --bin dreamcore` 已通过；完整 Linux QA 镜像已构建成功并部署。
- 前一轮 6 个前端文件 34 项通过；10 月 16 日又分别跑资料库 13 项、4 个编辑器文件 14 项、最新输入快捷键 5 项，均通过。
- 两端 TypeScript 检查在编辑组件改动后通过；后续主要是格式、文档及 JS 菜单控制。
- 本地引擎 8 个 vendor 文件校验通过。没有安装包、离线全新安装或生产发布验收。

日志：`knowledge-office-expiry-tests-1016.log`、`knowledge-library-pending-regression-1016.log`、`knowledge-office-editors-final-regression-1016.log`、`knowledge-office-file-shortcuts-1016.log`、`knowledge-office-enterprise-check-1016.log`。

## 5. Git 状态：务必区分提交与推送

**10 月 16 日晚更新：知识库成果已全部推送到各自 origin/main。** 推送经干净 worktree（cherry-pick 后仅含知识库内容）完成，dream-ui pre-push 四道门禁（格式、tsc、i18n、受影响测试 50 项）全绿；dream-core 在干净树上 `cargo check -p dream-core-app --features enterprise --bin dreamcore` 与个人版构建通过：

| 仓库       | 已推送提交             | 内容                                                                         |
| ---------- | ---------------------- | ---------------------------------------------------------------------------- |
| dream-ui   | `df0d706e`             | 离线/内网 Office 编辑、自动保存、布局与教程说明、测试                        |
| dream-ui   | `90332d93`、`de180165` | 本交接文档与验收状态（含 oxfmt 格式化）                                      |
| dream-core | `f758692`、`831ead1`   | Office 合同、领域服务、会话、回调、提取与验收文档                            |
| dream-core | `3a3e787`              | auth 目录身份门禁槽位（trait + 可选字段，未接线为 None）与 64 字符用户名登录 |
| dream-core | `d31f814`              | 企业 app 组合接线：knowledge_office.rs、module 声明、engine 路由挂载         |
| dream-core | `928b118`              | Dockerfile ORT BuildKit 缓存挂载                                             |
| dream-en   | `8abbd90`              | 企业内网编辑接入 UI（更早已推送）                                            |

要点：

- 企业接线的 `directory_identity` 槽位当前为 None：AD/LDAP 生命周期（`ldap_directory.rs`、迁移 006、SsoService 的 gate 实现与接线）仍是工作区未提交 WIP，由该任务自行整体提交后再把真实 gate 接入。MemberAdmission 的目录检查代码已就位，gate 一接即生效。
- 干净 checkout（`D:/dream/scratchpad/push-core-1016`、`push-ui-1016` 两个 worktree）即可复现已推送状态；但**当前 DEV/QA 运行时仍由完整脏工作区构建**，其行为多出未提交的 AD 接线。
- 各仓本地 main 与 origin/main 的 SHA 已分叉（本地 `05fa962`/`4357c32` 与远端 `831ead1`/`f758692` 内容相同、SHA 不同；UI 同理）。后续会话应把本地 main 重排到 origin/main。工作区仍有大量其他任务的未提交改动（core 约 40 个文件），不能 `git add .`、reset、clean 或整仓格式化；主仓 index 中原先对 state.rs 的精确暂存已因一次误执行 reset 打散，文件内容无损。
- 推送过程中修复了 dream-ui 主仓 node_modules 断链（`bun install --frozen-lockfile` 补回 42 个包，zod/@anthropic-ai/sdk 解析恢复），此前 tsc 与 vitest 在主仓同样起不来属环境预存问题。

已有独立校验 checkout：`D:/dream/scratchpad/knowledge-search-ui-verify`；core 的 `knowledge-core-docs-verify` 含上一轮未提交的旧 Office 合同，**不是当前完整实现，不要覆盖或误当成最新版**。

## 6. 当前运行环境与恢复办法

截至最后检查，以下端口都在监听：

| 服务                  | 地址                                         | 状态                        |
| --------------------- | -------------------------------------------- | --------------------------- |
| 个人源码 DEV renderer | http://localhost:5173/                       | 已恢复                      |
| 个人随进程 core       | http://127.0.0.1:61755/                      | 当前临时端口，重启会变      |
| 企业 admin Vite       | http://localhost:25810/admin/knowledge-bases | 已登录 QA admin             |
| 企业 gateway          | http://localhost:29870/                      | 已恢复，Office enabled=true |
| 内网 ONLYOFFICE QA    | http://localhost:29976/                      | 已恢复                      |

个人 DEV 当前根 PID `2224`，命令：

```powershell
node node_modules/electron-vite/bin/electron-vite.js dev --watch --config packages/desktop/electron.vite.config.ts
```

工作目录 `D:/dream/dream-ui`。最新日志 `outputs/knowledge-office-dev-restart-1016.log` 与 `.err.log`；从 `DREAMCORE_LISTENING` 读取实际 core 端口。个人 profile 为 `C:/Users/allenzhao/AppData/Roaming/dream-ui-Dev`。

企业 admin Vite 工作目录 `D:/dream/dream-en/admin-web`：

```powershell
$env:DREAM_BACKEND_URL='http://127.0.0.1:29870'
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 25810 --strictPort
```

WSL 发行版 `Ubuntu-22.04`，Docker 管理使用 root。已有 keepalive，避免发行版空闲退出。

企业 QA 最新镜像：`onework-enterprise:qa-20261016-knowledge-office-dev`，最终 manifest `sha256:affe4cf4410847c8bc8100f5e431babecd36c44a0b18a9a2ca9cf8d866bde8ec`。

Compose 工作目录：`/root/enterprise-fresh-qa-104/one-work-offline-20261011-online-1.0.4`，project `enterprise-fresh-qa-104`，按顺序使用：

```text
docker-compose.yml
compose.updater.yml
compose.update.yml
/mnt/d/dream/scratchpad/enterprise-terminal-regression-20261012/compose.qa-intent.yml
/mnt/d/dream/scratchpad/enterprise-terminal-regression-20261012/compose.qa-ad-lifecycle.yml
/mnt/d/dream/outputs/compose.qa-knowledge-office-1016.yml
```

更新命令末尾 `up -d --no-deps app admin`。不要去掉 AD/登录相关 override，否则可能读到不兼容配置而看不到当前资料。

ONLYOFFICE 容器 `knowledge-office-qa-1015`，固定 image：

```text
onlyoffice/documentserver@sha256:ca17889f10b11141cc6441836aebdd2835cf3e1b49681b2fd6e155c94b7850b3
```

它在企业 Compose 网络中可用 DNS `knowledge-office-qa-1015`，One Work app DNS `app:25808`。QA 已允许引擎访问企业内部地址；示例上传应用仅属 QA，不是客户部署方案。

环境变量与密钥保存在 WSL `/tmp/onework-office-qa-1016.env`，权限 600，**不可打印、提交或粘贴给第三方**。地址值是 public `http://localhost:29976/`、internal `http://knowledge-office-qa-1015/`、callback `http://app:25808/`。`/tmp` 重启可能丢失，需要按已配置引擎签名密钥安全重建。

QA 管理 token 文件：`D:/dream/scratchpad/enterprise-terminal-regression-20261012/admin.token`。只用于本地已授权 QA API，读入变量，不打印值。

### 构建缓存

`outputs/ort-linux-1.28.0.tar.lzma2` 来自官方 CDN，10,060,013 字节，SHA256：`e454f710f8a49f53aa5b4ff51e3454ae1835777e431c6c35c5255ce6f205fd68`，与 ort-sys 官方清单一致。

解压缓存：`outputs/ort-linux-cache-1016/`；QA Dockerfile：`outputs/Dockerfile.knowledge-office-qa-1016`。从当前 root Dockerfile 派生，注入已验证运行时缓存。重建：

```bash
cd /mnt/d/dream/dream-core
docker build --build-context ort-cache=/mnt/d/dream/outputs/ort-linux-cache-1016 \
  -f /mnt/d/dream/outputs/Dockerfile.knowledge-office-qa-1016 \
  -t onework-enterprise:qa-20261016-knowledge-office-dev .
```

最终构建日志：`outputs/knowledge-office-enterprise-image-final-1016.log`。

## 7. 尚未完成与不能夸大的地方

### 优先收尾

1. ~~整理企业 app 接线和 AD 权限依赖，精确提交自有 hunk；在干净 checkout 验证能复现当前服务。再整理 UI/core 与最新远端基线，运行推送门禁并推送。~~ **已完成（10-16 晚）**：知识库相关提交已全部推送，接线以 `d31f814` 落地，干净 worktree 编译与 UI 门禁通过；AD/LDAP 生命周期 WIP 留在原任务，落地后把 `directory_identity` 从 None 接到真实 gate。剩余：本地 main 重排到 origin/main。
2. 个人文件菜单最新方案已通过 Word 菜单与中文保存实测，但需要在 Excel/PPT 同样回归；其他引擎菜单如导出、发送、打印/打印设置仍未完整测试，不要宣称每个菜单都可用。WASM 文件对话框已实际发现异常，后续应消除不受支持入口或实现产品内下载流程。
3. 浏览器真正的后退/前进 popstate、硬关闭、强制刷新、长时间断网、保存并发与冲突提示需继续做真实 E2E。当前 navigator 包装与页面切换 guard，不等于全部浏览器生命周期都受保护。
4. 对企业真实只读成员、被撤销成员、AD 禁用成员做完整 UI/API 联动验收。现有后端测试覆盖撤销与拒绝，但不替代所有真实账号场景。
5. “默认向量索引”要补全新 profile/全新企业安装验收：已实现保存/导入自动排队并有索引就绪证据，但**关键词正文命中不证明新安装默认向量模型可用，也不证明语义检索已实测通过**。核对实际 embedding 配置、离线模型资源和失败反馈。
6. 更新文档内较早的待验收描述为清晰状态表，避免历史段落让后续 AI 误判。

### 产品差距

- 个人编辑器仍是英文传统 LibreOffice 菜单；中文输入候选框靠近最后点击位置，不是精确插入点。首次启动有明显加载时间，尚未专业化整合工具栏与中文 UX。
- Markdown 图文表格可用；**Office 富 HTML/图片剪贴板粘贴并未完整实现和验收**，不要混为一谈。
- DOCX/XLSX/PPTX 基础原版编辑可用；旧 DOC/PPT 转换、XLS 原版编辑、复杂图表、复杂样式、动画、宏等没有完整承诺。宏在个人引擎中禁用。
- 快速阅读仍用 DOCX/PPTX 预览组件与 Excel 数据表，不等于所有复杂排版都与原版编辑引擎一致。设计文件在线预览/修改未实现。
- PDF 用户已确认基本阅读可用，按用户要求未继续大改；部分内嵌原生 PDF 插件空白兼容性仍有记录，未做全平台完整验收。
- 扫描 PDF OCR、图片内容识别、视频/音频全文转录不因上传就自动完成。
- Office 多人共同编辑未实现；当前每会话独立 key + 版本 CAS 防覆盖，冲突体验仍需优化。
- 可恢复版本历史、版本选择与恢复未实现；保存保留新原件版本不等于有版本历史产品。旧原件清理/保留策略未做，不要擅自删除。
- 定位评论、AI 选区改写及接受/拒绝、资料一键加入任务、会话产物自动入库/回写尚未闭环。
- HTML 可视化编辑、HTML 与 CSV 双向动态工作台未实现。
- 公共外链分享和发布明确不在这轮范围；不要擅自打包、发版或部署生产。

## 8. 后续 AI 工作规则与工具经验

- 先读项目 AGENTS、架构/i18n 约定和本文。结构查询优先 CodeGraph，文本搜索用 rg。索引查到定义后不要再全仓 grep 复核。
- UI AGENTS 要求不要在 Rust 构建运行期间跑 Vitest。本轮最后 Linux/Rust 构建已经结束。
- Windows 原生 DEV 可用 computer-use 技能的 `@oai/sky`，先读取技能和 guidance/api/confirmations。每次操作后重新观察，不能复用过期窗口/坐标。
- 浏览器使用 CUA。曾出现 iframe 的 click/press 报焦点不可用，重新开标签仍一样；对可见编辑 textarea 使用受支持的 locator.fill 成功进入实际 Office 模型，再用页面保存状态、原件下载和重新阅读验证。不要改为直接调用隐藏编辑器 API来冒充 UI 验收。
- 曾有用户切到 Codex 后，原生截图与旧 One Work AX 不一致。**不要依据不匹配的截图继续点击，不要自动化 Codex UI**；重新选择目标或暂停该步，用已授权 QA API核对原件。
- 最新个人原件确认时需解析 XML 文本节点再拼接；中文与数字可能分散到不同 run。
- 修改 runtime 宿主文件会触发主进程重启，重新取窗口；仅改 renderer 通常 HMR 即可。重启旧服务前核对 PID/命令和自己创建的进程树，禁止停止全部 node/electron。
- 不要打印 admin token、JWT、签名 URL 或引擎配置密钥。交接文档只列文件位置与非秘密配置。
- 每次报告明确说明实际产品验收、独立引擎验证、单元测试、源码编译、安装包和生产交付之间的区别。

## 9. 建议接手顺序

先复查服务健康和资料数量 → 本地 main 重排到 origin/main → 回归个人 Excel/PPT 菜单与保存、导出等剩余入口 → 测保存失败/浏览器离开/权限撤销 → 全新安装的默认索引与语义搜索 → 专业化离线编辑 UI与复杂格式验收。

当前可以确定的是：**服务恢复，图文与正文搜索可用，企业三种 Office 基础编辑保存已在产品 UI 实测，个人离线编辑已完成基础接入与保存，并修复了主要文件菜单脱离托管的问题。整体仍处于 DEV 验收阶段，不能宣布全面对齐 WorkBuddy或生产交付完成。**
