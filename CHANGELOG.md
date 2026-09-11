# Changelog

> 从 `2.2.0` 起，本项目构建自 `dream-ui` / `dream-core` / `dream-engine` 三个独立仓库，
> 不再跟随开源上游 AionUi。`2.1.x` 及更早条目里指向 `iOfficeAI/AionUi` 的链接是旧仓库
> 时期的历史事实，保留不改。版本号规则见
> [`docs/contributing/versioning.md`](docs/contributing/versioning.md)。

## [3.0.4](https://github.com/gaogg521/dream-ui/compare/v3.0.3...v3.0.4) (2026-09-11)

本版按 **新增 / 优化改进 / 修复** 三类重新梳理。后端从 `v0.1.71-one.3` 提到
`v0.1.71-one.4`，3.0.3 那句「公司安全策略仍然不会生效」从本版起不再成立。

### 单机版

Windows 安装时间缩短约 62%（约 4.5 分钟 → 约 100 秒）；装新版不再多出一份旧程序，早期版本留下的数据会被接管；公司安全策略从本版起真正生效（见企业版）。

#### 新增

- 对话进行中实时显示上下文与 token 用量。此前只在整轮结束时更新一次，长任务跑到一半看不出还剩多少余量
- 「+」菜单里的技能改成可搜索的图标网格，选中的技能以标签形式回显
- 技能中心与菜单改为展示技能自己的名称和图标，不再只显示文件名
- 用户自行导入的技能会进入常驻集合，和内置技能同等对待
- 模型可以单独指定 OpenAI 兼容接口里 max-tokens 字段的名字，适配非标准中转站

#### 优化改进

- Windows 安装时间从约 4.5 分钟降到约 100 秒，缩短约 62%，安装体验大幅改善。安装包里的载荷从 solid LZMA 换成 zip：解压一直是整个安装最慢的一步，实测 180–268 秒，换掉之后降到 48–58 秒
- 与之相应，3.0.3 说明里提到的差分更新在本版关闭。两者在打包器里互斥、只能二选一：差分要到第二次更新、且本地还缓存着上一版安装包时才省流量，而安装提速对每个用户的每一次安装都生效。macOS 与 Linux 不受这条影响
- 早期版本留下的数据文件改名接管，数据库统一叫 one-backend.db，会话与进程记录同理。此前靠「新名字不存在就用旧名字」也能跑，但每装一次新版就多一条要永远维护的兼容分支；现在启动时直接改名，连 SQLite 的 -wal / -shm 一起搬，失败回滚，两份都在时保持原样并记日志
- 安装体积继续收窄：不再打包运行时从不会去启动的两个原生 CLI
- officecli 生成文档改为批处理优先，减少逐条往返

#### 修复

- 本地部署的 Ollama 模型现在能保存了。此前保存时要求填 API Key，而本机的 Ollama 根本没有 Key
- Bedrock 拉取模型列表不再要求填 Base URL——它按区域寻址，本就没有这个字段
- Vertex AI 的渠道现在能保存、也能拉到模型列表。真实数据里平台名叫 gemini-vertex-ai，而判断逻辑只认 vertex-ai
- Gemini 渠道的「刷新模型」按钮点了没反应
- 装新版后旧版本并存：上一版的程序目录叫「One Work」、更早的叫「1onecode」，Windows 把它们当成互不相干的程序，于是磁盘上同时躺着两三份，用户看到多个一模一样的图标却打开不同版本。现在安装时会清掉这些没人认领的旧目录（实测释放 2.24 GB），用户数据不在这些目录里，不受影响
- 后端进程意外退出时会告诉用户，而不是只写进日志文件、界面一直转圈
- 生成 PPT 时形状尺寸离谱错位：几何数值不带单位时按 EMU 解析(1 厘米 = 360000)，写 height=3 得到的是三个 EMU 而不是三厘米
- officecli 的自检循环存在没有出口的分支，会一直转下去
- 「最新优先」的列表在同一毫秒内创建的多条记录上顺序随机
- 技能面板在改成网格后丢了搜索框的显示阈值
- 技能网格被 Arco 的 Menu.Item 包裹层撑破
- 按分辨率分档的媒体价格在回传时被丢弃
- 内置与团队技能在数据库元数据陈旧时不显示图标
- 跨域下载时浏览器读不到 Content-Disposition，文件名丢失

### 企业版

上一版说明里那句「公司安全策略在本版仍然不会生效」，从本版起不再成立。

#### 新增

- 公司安全策略真正生效：破坏性命令拦截、外网默认拒绝、终端命令审批、发送限流、模型白名单，以及企业记忆的本机召回。这些执行点都在本机后端，本版把后端提到 v0.1.71-one.4 才包含进来——此前管理员配置的策略会下发到成员本机，后端不认这个接口，静默忽略
- 终端命令审批经公司服务器通道送达成员的桌面客户端
- 模型代理的用量会记到发起它的那次会话上
- 企业技能的分类与标签内联进注册表，并写入下发到成员机器的 SKILL.md frontmatter

#### 优化改进

- 渠道的模型白名单改为服务端强制，不再依赖客户端自觉；同时不再拿客户端传来的 id 当服务端的键使用
- 模型代理补写每次调用的 trace——它本来就在计量，只是没留下可追溯的记录

#### 修复

- 被管理员封禁的节点现在真的停止同步团队资源，并且客户端不发机器标识也一样被拒。此前只要不带 x-dream-machine-id 这个头就会被当成无法判定而放行，封禁只在客户端愿意表明身份时才有效。浏览器后台不受影响，管理员自己那台被封禁时仍打得开解封页面
- 被封禁的机器在花名册里会正确显示为过期，而不是一直保持新鲜
- 退出企业时，加入时下发的九类内容会被逐一收回，此前只收回了其中一部分
- 关闭企业模式后的资源清理改为按证据判断（后端里是否真有企业渠道），不再依赖本地记的一个标记——标记丢了就再也不清理了
- 请求里带上他人所属的会话 id 时返回 4xx 而不是 500

---

## [3.0.3](https://github.com/gaogg521/dream-ui/compare/v3.0.2...v3.0.3) (2026-09-10)

**安装包瘦身一半，媒体产物回到工作区，下载不再变成无名文件。**
本版同时把企业策略落到真正干活的那条路径上。

### 单机版

【安装与更新】

· 安装包从 462 MB 降到 288 MB，装完占用从 2.28 GB 降到 1.38 GB。去掉的是三类装了也不会被加载的东西：已经被打包进渲染层的依赖在 node_modules 里的第二份副本、应用本身不支持的语言的 Chromium 界面语言包、以及 better-sqlite3 的编译中间产物。应用支持的 13 种语言的系统菜单/右键菜单一个没少
· 支持差分更新：以后升级只下载变化的部分，不再每次重下整个安装包。**本版升级仍是一次完整下载**——差分需要本地缓存上一版安装包，从下一版开始生效

【真实缺陷修复】

· 下载的文件不再变成一个没有名字、扩展名是 `.tmp` 的乱码文件。企业文件库、媒体产物、工具输出、预览面板、差异视图、HTML 导出这六处下载全部受影响，文件其实一直在下载目录里，只是认不出来。同名文件不会互相覆盖，会自动编号
· 生成的图片/视频不再落在「应用被启动的那个目录」。打包版里没有指定工作区时的兜底路径一直是失效的，产物落在工作区之外且不报错
· seedream 5 的图片请求会按它的 API 能接受的方式表达尺寸
· 会话历史的批量选择栏不再重复渲染两条
· 被策略拒绝的发送会立刻停下计时并说明原因，不再让对话看起来还在跑
· Windows 上读取机器标识的注册表路径写错了，导致同一台电脑每次重装都被算成一台新机器
· Linux 安装包现在注册 `dream://` 深链。此前只注册了旧的 `aionui://`，浏览器拿到 SSO 回调后无法交还给应用

【界面与本地化】

· 专家市场改为商店式布局，按分类筛选，技能并列展示
· 模型设置里可以看到模型来自哪个渠道，并指定默认的媒体模型
· 模型可以单独指定 OpenAI 兼容接口里 max-tokens 字段的名字
· 「记忆」页面补齐了全部 13 种语言的翻译（此前 11 种语言只有英文）
· 定时任务对话框里，未配置 Dream 引擎渠道的助手选项此前显示的是一串原始的翻译键名，现已修正；同批补上 23 条只有中文硬编码、对非中文用户显示中文的文案

### 企业版

· 成员侧新增「审批」页面：提交、跟踪、读到审批人的意见。服务端一直有这一半，客户端此前完全够不到
· 项目组页面补上成员自助信息：谁在协作、本机在花名册里的状态、以及撤回自己已分享的会话
· 团队技能同步带上分类与标签，技能中心按分类分组
· 被封禁的运行节点会真正停止同步团队资源
· 关闭企业模式后，已下发的公司资源会在重载后被清理
· 渠道令牌在重载后保持，客户端不再让自己的凭据失效
· 客户端侧的用量会上报，公司的资源不再被呈现为成员自己的资源
· **从企业切回个人工作区时，企业下发的模型渠道现在会被清掉。**此前只广播了「部署角色变了」，而清理逻辑监听的是「所属企业变了」，两个事件不通，渠道就一直留着并被当成用户自己的渠道

### 后端

本版沿用 `dreamcore v0.1.71-one.3`，与 3.0.2 相同。

⚠️ **因此公司安全策略在本版仍然不会生效，请不要据此认为已经受控。** 破坏性命令拦截、外网默认拒绝、
终端命令审批、发送限流、模型白名单，以及企业记忆的本机召回，执行点全在 dream-core 里
（`tool_security.rs` / `call_guard.rs` / `team_memory.rs`），这批改动尚未发版。客户端会把管理员
配置的策略 POST 到本机后端的 `/api/tool-security/policy`，老后端没有这个路由，返回 404 被
`syncToolSecurityPolicy` 的 catch 吞掉——**没有任何报错，管理端看起来一切正常**。
客户端这一半（下发链路、成员界面）已经就位，等下一次后端发版即可闭环。

---

## [3.0.2](https://github.com/gaogg521/dream-ui/compare/v3.0.1...v3.0.2) (2026-09-07)

**紧急修复 3.0.1 的升级问题**：升级后应用打开的是一个全新的空档案，
真正的档案原封不动留在旧目录里。数据没有丢失，本版把它接回来。

### 单机版

**紧急修复 3.0.1 的升级问题：升上去之后看起来「什么都没了」。**

数据一个字节都没丢，是应用打开了一个全新的空档案，而真正的档案原封不动留在旧目录里。3.0.1 把正式版数据目录从旧品牌名改成 One Work 并配了首启迁移，但迁移从来没执行过——取父目录那一步会顺手把目标目录建出来，迁移函数随即判定「目标已存在，无需迁移」，旧目录原地不动。会话、模型服务、技能、MCP、授权全在旧目录。

【修复】
· 迁移不再被自己创建的空目录挡住：取父目录改用不会建目录的方式，并且把空目录视为不存在（迁移前先删掉这个占位）。目标里只要有一个文件就仍算真实档案，绝不覆盖
· 已经装过 3.0.1 的用户不会被上面那条自动救到（那时新目录已经不是空的了），所以首次启动会**弹一次窗**，写明旧目录的完整路径，由你决定是否导入
· 选择导入不会当场搬运：先记录选择再重启，真正的搬运在下次启动最开头完成——此时还没有任何进程打开这两个目录（Windows 不允许搬运有打开句柄的目录）
· 被顶替的空白档案会改名保留（`One Work.superseded-<时间戳>`）而**不是删除**；搬运失败会自动回滚，并在日志里打印真实路径
· 选择「暂不导入」后不会再问
· 弹窗语言跟随系统语言——空白档案里没有语言设置，否则中文用户会看到一个英文的「你的数据不见了」对话框

【说明】
· 若你已经自行把旧目录改名回去，本版不会重复询问，直接照常使用
· 若同一台机器上装过更早的旧版客户端（它写入同名的旧目录），弹窗可能会提示导入那一份数据——弹窗里会写清路径，按路径确认后再决定

### 企业版

本版无企业侧功能变更。上面那条数据目录修复对企业成员同样适用——被卡在旧目录里的授权、团队技能与模型渠道会随档案一起回来。

## [3.0.1](https://github.com/gaogg521/dream-ui/compare/v3.0.0...v3.0.1) (2026-09-07)

3.0.0 之后的第一个维护版，收敛了 8 月 31 日以来的全部改动：媒体模型选择搬进对话、
企业接入收敛为三步向导、历史品牌名从安装壳层彻底清除，
以及 macOS 包「已损坏」与一批启动 / 打包 / 企业资源同步上的真实缺陷修复。

### 单机版

【新增】
· 图片 / 视频模型改到对话里直接选：发送框切到媒体模式即可就地换模型，选过的会被记住，顶部下拉与发送框是同一份列表，不会再出现两处对不上
· 模型平台预设改为从后端权威列表同步，模型选择器新增 Ollama
· 免费体验模型新增计量代理供应商与充值入口

【改进】
· 安装后的程序名与安装目录统一为 One Work（此前壳层仍显示上一代品牌名）；正式版用户数据目录一并更名，首次启动自动迁移，迁移失败则原地沿用旧目录，数据不会丢
· 多图结果按张数自适应网格，列数与高度跟着张数走，不再裁掉画面
· 发送框的模型胶囊超长 id 会裁剪并在悬停时滚动，不再挤占整行
· 深色模式下单色的 Agent 图标不再看不见

【修复】
· macOS 安装包「已损坏、无法打开」根治：签名身份配置带前缀时会导致签名失败并静默降级成未签名包，现在签名失败直接中断发布，不会再把未签名包发出去
· 数据库损坏后的自愈会先结束仍占着文件的残留进程，失败后仍可重试——此前在 Windows 上会卡死在「恢复失败」
· 清理残留后端时不再误伤同名的其他进程
· 通过协议链接（dream://）启动时，深链能正确送达已在运行的窗口，而不是被丢弃
· Windows 上主进程拉起子进程不再闪黑框
· 自定义日志目录会如实上报，后端日志级别的重映射恢复生效
· 图片走中转网关时会在协议猜错后自动改用兄弟协议重试；视频的音频参数此前从未透传，中转网关路径生成的视频一律无声
· 安装包在某些机器上解不出主程序（E1010）的根因修复

### 企业版

【新增】
· 企业接入收敛为一个三步向导，连接与登录合并到同一页
· 成员侧企业记忆页
· 数字员工团队同步、组织内会话分享、管理员审计正文上传
· 渠道同步支持逐模型的协议覆盖

【改进】
· SSO 渠道不可用时直接说明原因，不再只是静默置灰
· 企业下发的渠道密钥在客户端一律打码
· 向导的编辑模式补上了上下文说明与退出口，输入框不再看不清
· 登录后跳转会给出完整路径（含 hash），不再只说一半

【修复】
· 服务器不可达在每一个环节都被识别为「连不上」，不再误报成「SSO 未配置」
· 成员被移出组织后，本机的团队技能 / 工具 / 模型渠道与 DLP 规则会被清理；此前只有成员自己点「退出企业」才清
· 401 不再被当成撤权：企业服务器重启会让所有 token 失效，此前这会把每一位成员的团队资源一起清掉
· 「我的场景」跟随当前组织上下文，不再串到别的组织
· 退出企业时站内消息会一并清空，不会把上一家公司的通知留在界面上
· 同一个会话第二次分享会更新快照，此前直接报 500
· 审计记录归属到被审计成员所在的租户，此前落在一个占位值上，管理后台按租户筛选看不到

## [3.0.0](https://github.com/gaogg521/dream-ui/compare/v2.2.0...v3.0.0) (2026-08-30)

**品牌战略升级 —— Dream 作为自有品牌与技术引擎正式确立。**

`3.0.0` 是 One Work 的换代分界。从这一版起，产品完整运行在自有的 **Dream 引擎**之上，
不再跟随任何开源上游，拥有独立的三仓代码库、构建流水线与发布源。围绕 Dream 引擎，
这一阶段收敛了多智能体编排、工具调用与本地运行时的一致性，为后续能力扩展打底。

同时打通新用户的最后一公里 —— **内置模型，开箱即用**：第一次打开无需注册第三方账号、
无需粘贴 API Key，首页一键即可领到可直接对话的模型。企业版架构（治理面 feature 门控、
admin 独立进程、企业主存储切换）的重构也从这一版起步。

> `2.2.0` 是三仓独立化的内部分界版，从未对外发布；`3.0.0` 是新架构的首个公开版本，
> 已涵盖 `2.2.0` 的全部内容。版本号跳到 `3.0.0` 是有意的品牌里程碑，见
> [`docs/contributing/versioning.md`](docs/contributing/versioning.md)。

### Desktop

#### Features

- **trial:** 免费体验模型入口改为角落常驻推广位，更易发现
- **trial:** 体验模型的 provider 平台信息改由签发服务返回，不再前端硬编码
- **i18n:** 一轮对话被系统自行中止时，用用户当前语言解释原因

### Core ([v0.1.71-one.1](https://github.com/gaogg521/dream-core/releases/tag/v0.1.71-one.1))

- **devops:** 内置 embedding 端点，知识库 / RAG 开箱即用（环境变量回落）
- **conversation,memory:** 记忆管线接线（抽取 + 检索注入），个人版零行为变化
- 多项企业版能力（P1 场景授权 / 内容市场 / 节点控制面 / 配置金库 / 安全策略模板等）
  与企业主存储 P3-3 第一阶段基建。完整条目见 dream-core 的 CHANGELOG。

---

## [2.2.0](https://github.com/gaogg521/dream-ui/compare/v2.1.61...v2.2.0) (2026-08-28)

新架构（dream 三仓）的第一个版本。

### Desktop

#### Features

- **provider:** 一键体验免费模型——新用户无需注册 OpenRouter、无需粘贴 API Key，
  在首页空状态横幅或「添加模型 → 手动添加」的卡片点一下，即可领到一把每日 $1 硬顶的
  真实 OpenRouter key 并落成一条可编辑的普通 provider
- **web-host:** 打包桌面版默认接入体验 key 签发服务（`DREAM_TRIAL_BROKER_URL`）；
  dev / `bun run webui` / 自建服务端默认不启用，可用环境变量显式开关

### Infrastructure

- **dream-trial-broker:** 新增独立的云端签发服务（Rust + Axum + SQLite），唯一持有
  OpenRouter Management Key，带 install_id 去重、按 IP 限流与每日额度熔断

## [2.1.59](https://github.com/iOfficeAI/AionUi/compare/v2.1.58...v2.1.59) (2026-08-19)

### Desktop

#### Features

- **explorer:** new file/dir + grouped row menu (#4102)
- **feedback:** add optional contact email field (#4096)
- **explorer:** drag-to-transfer files across the project tree (#4090)

#### Bug Fixes

- **markdown:** keep inline markup at the heading's size inside chat headings (#4104)
- **acp:** render relative images in agent replies (#4103)
- **desktop:** stop renderer launch-failed reload storm with backoff and throttled relaunch (#4100)
- **ui:** make monochrome logos follow the theme color (#3614)
- **security:** block path traversal in HTML renderer resource inlining (#4097)
- **markdown:** render chat KaTeX formulas once in Shadow DOM (#4091)

#### Refactoring

- **media:** read image root from ConversationContext (#4105)

### Core ([v0.1.70](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.70))

#### Features

- **monitor:** add fs/createFile command (#891)
- **monitor:** back explorer drag-transfer with fs/copy and fs/move (#877)
- **session:** distinguish Task subagents from background tasks (#890)

#### Bug Fixes

- **agent:** pair native media blocks with a link to the same file (#876)
- **antigravity:** collapse agy's U+FFFD runs at text_delta joins (#888)
- **antigravity:** route Team over the CLI, which is what agy was already using (#881)
- **app:** bound the graceful-shutdown tail so the data-dir instance lock is released (#884)
- **app:** harden the shutdown watchdog force-exit path
- **app:** harden the shutdown watchdog force-exit path
- **app:** keep backend_binary_path cmd.exe-launchable on Windows (#887)
- **app:** reuse the app-level ConversationService in build_cron_state (#885)

---

## [2.1.58](https://github.com/iOfficeAI/AionUi/compare/v2.1.57...v2.1.58) (2026-08-18)

### Desktop

#### Features

- **renderer:** add math formula rendering support for markdown viewer (#4079)
- **theme:** activate structured token channel and add custom-theme guide (#4081)
- **team:** runtime restart controls, model refresh button and team UX fixes (#3893)
- **i18n:** right-to-left layout for Persian (fa-IR) (#4069)

#### Bug Fixes

- **chat:** align compose actions and draft queue draining (#4082)
- **i18n:** align directory paths to the page direction, not hardcoded end (#4086)
- **web-host:** stop leaking PREBUILDS_ONLY into aioncore agent subprocesses (#4078)
- **i18n:** RTL polish pass — LTR paths/file names, shorthand paddings, mirrored chevrons (#4077)
- **i18n:** locale-aware cron titles and byte sizes, Traditional Chinese mapping (#4075)
- **i18n:** adopt i18next plural forms for count-bearing strings (#4074)
- **i18n:** backfill every missing translation and wire webFsPicker into i18n (#4072)
- **i18n:** quick-wins batch — Arco locales, tray French, hardcoded strings, stale title (#4071)
- **i18n:** format numbers and dates against the app language, not the host locale (#4068)

### Core ([v0.1.69](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.69))

#### Features

- **claude:** label tool steps by what they do (#870)
- **team:** team mode reliability improvements, model switch persistence and runtime restart (#787)

#### Bug Fixes

- **claude:** three follow-ups to the tool-step labels (#872)

---

## [2.1.57](https://github.com/iOfficeAI/AionUi/compare/v2.1.56...v2.1.57) (2026-08-17)

### Desktop

#### Features

- **chat:** mid-turn interjection — allow sending while a turn is in flight (#4012)
- **explorer:** themed file-tree icons and SCM sidebar polish (#4057)

#### Bug Fixes

- **web-host:** pause client socket before splicing to avoid dropping upload bytes (#4066)
- **explorer:** remove duplicate desktop toggle (#4065)
- **web-host:** pick the real LAN IP for the WebUI access URL (#4060)

### Core ([v0.1.68](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.68))

#### Features

- **codex:** auto-name sessions and label command steps (#868)
- **conversation:** mid-turn interjection — deliver messages while a turn is in flight (#836)

#### Bug Fixes

- **acp:** give a first-run npx agent room to install before initialize times out (#854)
- **acp:** stop collapsing agent failures into an opaque -32603 (#869)
- **agents:** launch omp through its local CLI instead of the npx bridge (#855)
- **antigravity:** read the HTTP status before parsing the hook decision (#867)
- **auth:** stop CSRF rejecting agy's PreToolUse callback (#860)
- **runtime:** find agent CLIs installed by bun and by vendor installers (#856)

---

## [2.1.56](https://github.com/iOfficeAI/AionUi/compare/v2.1.55...v2.1.56) (2026-08-14)

### Desktop

#### Features

- **sidebar:** allow marking a conversation as unread (#4028)
- **agent:** show a deferred mode switch as pending instead of switched (#4031)

#### Refactoring

- **theme:** remove deprecated community themes, keep official (#3922)

### Core ([v0.1.67](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.67))

#### Features

- **session:** report a deferred mode switch as pending instead of observed (#846)

#### Bug Fixes

- restore direct CLI Team MCP capabilities (#853)

---

## [2.1.55](https://github.com/iOfficeAI/AionUi/compare/v2.1.54...v2.1.55) (2026-08-13)

### Desktop

#### Features

- **conversation:** surface fork entry point in aionrs chats

#### Bug Fixes

- **update:** reject downgrade offers in update check (#4010)

### Core ([v0.1.66](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.66))

#### Features

- **conversation:** support forking aionrs conversations

#### Bug Fixes

- **session:** retry claude session-title generation with timeout and observability (#843)

---

## [2.1.54](https://github.com/iOfficeAI/AionUi/compare/v2.1.53...v2.1.54) (2026-08-12)

### Desktop

#### Features

- **backend:** honor AIONUI_BACKEND_BIN override in desktop resolver (#3988)
- **channel:** add Discord channel configuration UI (#3956)
- **conversation:** open selected links in built-in or system browser (#3959)
- **preview:** add save button to editable file toolbar (#3964)
- **preview:** enable mermaid pan/zoom controls in markdown viewer (#3958)
- **startup:** dedicated dialog for database created by newer AionUi (downgrade) (#3998)

#### Bug Fixes

- **explorer:** stop React #185 loadMore loop (#3966)
- **preview:** download PDF, DOCX, XLSX, and PPTX (#3973)

### Core ([v0.1.65](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.65))

#### Features

- **db:** dedicated startup stage for database created by a newer app (downgrade) (#834)

#### Bug Fixes

- **antigravity:** parse TSV output from `agy models` (#797)
- **conversation:** tell the client when a turn is cancelled before its agent exists (#827)

---

## [2.1.53](https://github.com/iOfficeAI/AionUi/compare/v2.1.52...v2.1.53) (2026-08-10)

### Desktop

#### Features

- **channel:** add Slack channel configuration UI (#3935)
- **explorer:** add copy relative/absolute path context-menu items (#3929)
- **scm:** add collapsible sections and tree/list view to SCM panel (#3926)

#### Bug Fixes

- **assistants:** let the editor drive Antigravity (#3951)
- **build:** merge React vendors into one chunk to fix white screen (#3938)
- **chat:** copy button copies the whole AI turn, not just its last text segment (#3949)
- **conversation:** render preview on narrow width for project chats (#3934)
- **explorer:** re-subscribe a rejected fs subscribe instead of stranding it (#3954)
- **packaging:** stop requiring bundled claude/codex, generalize drift copy (#3916)
- **preview:** resolve project markdown relative images via fileRef (#3948)
- **sendbox:** let a folder / pe root added to chat produce a chip (#3869)
- **skills:** support skill file browsing in webui (#3946)

#### Refactoring

- **theme:** drop legacy theme migration (#3918)

### Core ([v0.1.63](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.63))

#### Features

- **channel:** add Slack Socket Mode plugin (#806)
- **fs:** add copy-absolute-path endpoint that writes the clipboard server-side (#803)
- **scm:** one-level repository discovery for workspace roots (#800)

#### Bug Fixes

- **agent:** stop the idle scanner from killing agents with live background tasks (#811)
- **project:** emit real-case absolute path to agents, not folded canonical (#809)

#### Refactoring

- **session:** run the user's own claude/codex, with one shared version-drift path (#799)

---

## [2.1.52](https://github.com/iOfficeAI/AionUi/compare/v2.1.50...v2.1.52) (2026-08-07)

### Desktop

#### Features

- **scm:** Changes panel with multi-repo switcher and repo labels (#3894)

#### Bug Fixes

- **guid:** align assistant dropdown search fields with Agent settings (#3903)
- **security:** prevent path traversal in image generation MCP tool (#3906)
- **shortcuts:** use platform-native primary modifier (#3909)
- **theme:** converge appearance attributes and defer arco-theme (#3917)
- **theme:** parse custom CSS via postcss instead of regex (#3915)

### Core ([v0.1.62](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.62))

#### Features

- **scm:** live repository-set changes + pe_name (#790)

---

## [2.1.50](https://github.com/iOfficeAI/AionUi/compare/v2.1.49...v2.1.50) (2026-08-06)

### Desktop

#### Bug Fixes

- **browser:** stop in-app browser MCP commands hanging, and fix Windows spawn EINVAL (#3885)
- **explorer:** publish active project synchronously on conversation switch (#3875)
- **notification:** register Windows AppUserModelID for NSIS toast delivery (#3890)
- **team:** create antigravity team members with an empty model instead of the 'default' placeholder (#3887)
- **theme:** sync webui toggle state immediately (#3892)

### Core ([v0.1.61](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.61))

_Includes AionCore v0.1.59 – v0.1.61._

#### Features

- **acp:** client-hosted terminals — declare clientCapabilities.terminal and serve terminal/\* (#779)
- **agent:** multimodal prompt — native image/audio content blocks gated by promptCapabilities (#774)
- **preview:** backend half of preview v2 — office refresh, overflow marker, content-change signal (#780)
- **session:** AskUserQuestion as a first-class capability (own event, command, counter and endpoint) (#778)
- **team:** add read-only mailbox/task activity API and real-time events (#740)

#### Bug Fixes

- **adoption:** move legacy root assistant-rules to the adopter (#788)
- **ai-agent:** degrade corrupt process registry, atomic writes, and startup-failure child cleanup (#784)
- **antigravity:** drop the 'default' UI placeholder model while discovery is empty (#785)
- **engine:** update rust crate getrandom to 0.4 (#212)
- **session:** stop reporting still-running codex commands as cancelled (#783)

---

## [2.1.47](https://github.com/iOfficeAI/AionUi/compare/v2.1.46...v2.1.47-final) (2026-08-04)

### Desktop

#### Features

- **conversation:** message-level fork entry with capability-gated visibility (#3843)
- **conversation:** tag derived titles with name_source for agent auto-naming (#3839)
- **preview:** add agent-controllable in-app browser over a single-target CDP bridge (#3826)
- **preview:** pdf via stream URL + office ChatFileRef + drop fs/resolve (#3837)
- **preview:** migrate content I/O to ChatFileRef /content endpoints (#3825)
- **update:** discontinue AionUi in-app updates and guide migration to the official website (#3730)

#### Bug Fixes

- **conversation:** keep the anchor rail clear of text and cover full history (#3848)
- **desktop:** silence GPU-process crash noise and surface HW-accel auto-disable (#3838)
- **renderer:** gate database rebuild behind a second confirmation (#3840)
- **renderer:** keep workspace toggle in titlebar (#3845)
- **team:** handle omitted slot work in run state (#3847)

### Core ([v0.1.58](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.58))

#### Features

- **conversation:** agent-driven session auto-naming (ACP session_info_update + claude generate_session_title) (#768)
- **conversation:** fork a conversation into a new one at a chosen message (#772)
- **fs:** add ChatFileRef content endpoints (#757)
- **fs:** pdf stream endpoint + office ChatFileRef resolve + retire fs/resolve & WS fs/read (#762)

#### Bug Fixes

- **agent:** keep the thought-level picker on a resumed conversation (#763)
- **runtime:** add bounded retry to managed node version probe (#771)
- **session:** keep claude session cost cumulative across process respawns (#767)
- **session:** settle cards through teardown and resume so no stored row spins forever (#766)

---

## [2.1.46](https://github.com/iOfficeAI/AionUi/compare/v2.1.45...v2.1.46) (2026-08-03)

### Desktop

#### Features

- **update:** make manual update check CDN-authoritative (#3830)
- **conversation:** add a message anchor rail with a search entry point (#3824)
- **explorer:** add reveal-in-folder context menu (Electron only) (#3820)

#### Bug Fixes

- **startup:** stop misreporting slow backend startup as broken installation (#3831)
- **runtime:** reconcile self-healed install-integrity failures before alerting (#3828)
- **guid:** stop a CLI agent's first turn from using the aionrs provider model (#3827)
- **conversation:** make Antigravity conversations usable in the UI (#3812)
- **preview:** restore multi-tab when opening files from explorer (#3821)
- **office-preview:** degrade gracefully on FILE_WATCH_UNAVAILABLE (#3819)

### Core ([v0.1.57](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.57))

#### Features

- **agent:** add Antigravity (agy CLI) as a direct-CLI agent (#741)
- **fs:** add /api/fs/reveal endpoint (resolve pe-ref + show in folder) (#754)
- **session:** make background work visible — live progress cards and out-of-turn delivery (#758)

#### Bug Fixes

- **conversation:** apply a cancel that arrives while the agent is still building (#747)
- **db:** widen migration-030 pre-repair gate to any pre-030 start point (#756)
- **file-watch:** degrade gracefully when watcher init fails instead of killing backend (#751)
- **file:** strip verbatim \\?\ prefix from non-browse path outputs (#736)
- **process:** reap tool subprocesses that left the process group (#753)
- **runtime:** retry transient bundled-node activation copy and reclassify persistent I/O failures (#760)
- **server:** emit AIONCORE_READY marker once serving begins (#761)

---

## [2.1.45](https://github.com/iOfficeAI/AionUi/compare/v2.1.44...v2.1.45) (2026-07-31)

### Desktop

#### Features

- **explorer:** reveal highlight + @ Tab complete (#3794)

#### Bug Fixes

- **sendbox:** tag loading-window @mention fallback with local chat-ref (#3801)

### Core ([v0.1.56](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.56))

#### Features

- **project:** hide OS-junk and VCS-internal noise from listings (#727)

#### Bug Fixes

- **agents:** persist the catalog the availability probe already fetched (#735)
- **ai-agent:** token usage for the direct-CLI backends (claude / codex) (#733)
- **conversation:** request plaintext thinking from claude, drop blank thought cards (#731)
- **project/monitor:** attribute watched-subdir events to parent so tree reflects dir delete/rename (#734)
- **session:** settle cancelled workflows and stop per-turn pump state leaking across turns (#732)
- **team:** derive team capability from probed MCP transports, not a stored veto (#725)

---

## [2.1.44](https://github.com/iOfficeAI/AionUi/compare/v2.1.43...v2.1.44) (2026-07-30)

### Desktop

#### Features

- **skills:** add file browser to detail page (#3683)
- **search:** filename search + chat-ref (#3784)

#### Bug Fixes

- **preview:** restore file rendering for Explorer opens (#3786)
- **tray:** honor close-to-tray on custom title-bar close (#3717)

### Core ([v0.1.55](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.55))

#### Features

- **agents:** add omp (Oh My Pi) builtin ACP agent (#717)
- **project:** fs/search filename search vertical (#720)

#### Bug Fixes

- **auth:** make AionUi->AionPro data adoption a one-shot event (#716)
- **db:** pre-migration repair for migration-030 startup-blocking CHECK failures (#724)
- prevent silent encryption-key rotation on migration upgrade (ELECTRON-3T0) (#722)
- **project:** add temporary fs/resolve command for preview file paths (#723)
- **session:** carry tool input on permission events so the approval card shows what is being approved (#715)

---

## [2.1.43](https://github.com/iOfficeAI/AionUi/compare/v2.1.42...v2.1.43) (2026-07-29)

### Desktop

#### Features

- **conversation:** restore agent-reported context usage indicator for ACP conversations (#3772)
- **explorer:** sort tree children directories-first (#3775)
- **explorer:** project-scoped Explorer replacing workspace tree (#3763)
- **team:** thread teammate warmup status and trigger to model selector
- **team:** add warmup click-to-wake tooltip copy for all locales
- **team:** add manual warmup entry to AcpModelSelector read-only pill

#### Bug Fixes

- **pet:** source enable switch initial state from authoritative value (#3777)
- **conversation:** persist ThoughtDisplay elapsed timer across conversation switches (#3774)
- **webui:** implement dialog.showOpen so file and folder pickers work (#3766)

#### Refactoring

- **webui:** reduce redundant API refetch and drop dead front-end fs accessors (#3768)

#### Styling

- **team:** apply oxfmt formatting to warmup selector changes

### Core ([v0.1.54](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.54))

#### Features

- multi-account user scope isolation (#669)
- **project:** Project Explorer backend (runtime, WS monitor, HTTP) (#701)
- **scripts:** carry aionrs changelog into the bump PR (#703)

#### Refactoring

- **acp:** upgrade agent-client-protocol SDK 0.11.1 -> 2.0.0 (#708)

---

## [2.1.42](https://github.com/iOfficeAI/AionUi/compare/v2.1.41...v2.1.42) (2026-07-28)

### Desktop

#### Features

- **skills:** explain delete scope in skill delete confirm dialogs (#3761)
- **assistant:** show quick-chat button on enabled tab rows (#3748)
- **tray:** left-click tray icon toggles show/hide on Windows/Linux (#3726)
- **permissions:** submit permission decision in one click for one-off options (#3686)

#### Bug Fixes

- **startup:** skip mkdir for pre-existing backend startup directories (#3759)
- **i18n:** soften empty-turn needs-auth copy and add token-limit tip (#3751)
- **conversation:** wrap long unbroken url/path in user message bubble (#3727)

### Core ([v0.1.53](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.53))

#### Features

- **agents:** add MiMo Code builtin ACP agent (#700)

#### Bug Fixes

- **acp:** tolerate CodeBuddy dialect and stop misreporting empty turns as needs-auth (#692)
- **ai-agent:** resolve cron full-auto mode to backend-native YOLO (ELECTRON-3RQ) (#699)
- **session:** force-kill direct-CLI turns on UserCancelTimeout (#702)
- **session:** preserve codex's real error when systemError precedes the terminal (#694)
- **team:** converge run-scoped wakes into a run at the enqueue choke-point (#690)
- **team:** dispatch native slash commands as bare command turns (#696)

---

## [2.1.41](https://github.com/iOfficeAI/AionUi/compare/v2.1.40...v2.1.41) (2026-07-24)

### Desktop

#### Features

- **notification:** notify on agent turn completion when window is unfocused (desktop) (#3715)
- **shortcuts:** add common UI bindings (#3675)

#### Bug Fixes

- **team:** extend ITeamRunEvent.source with system_lifecycle (#3721)

### Core ([v0.1.52](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.52))

#### Features

- **project:** wire project-bind side branch into owner creation (#676)

#### Bug Fixes

- **agent:** unify CLI probe pipeline with classified failures and adaptive slow-probe recheck (#678)
- **channel:** quiet WeChat poll log noise with state-transition logging and exponential backoff (#683)
- **process:** allow whitespace in workspace cwd segments (#674)
- **session:** restore codex slash commands + recover dead resume anchors on the direct-CLI path (#679)
- **team:** converge system/lifecycle wakes into a team run (#680)

---

## [2.1.40](https://github.com/iOfficeAI/AionUi/compare/v2.1.39...v2.1.40) (2026-07-23)

### Desktop

#### Features

- **session-port:** AionUi frontend support for the direct-CLI claude/codex session path (#3572)
- **assistants:** support reordering enabled assistants (#3696)
- **permissions:** redesign request panel (#3676)
- **team:** dormant teammate UI with lazy warmup and per-member retry-start (#3712)
- **desktop:** support image avatars for custom agents (#3667)
- **cron:** add scheduled-task action to history (#3674)
- **team:** show running state in sidebar (#3666)

#### Bug Fixes

- **i18n:** add discoverability hints to input placeholders (#3658)
- **chat:** restore ACP file change panels (#3665)
- **chat:** bound HorizontalFileList to conversation width to prevent overflow (#3659)
- **update:** allow minimizing active downloads (#3663)

### Core ([v0.1.51](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.51))

#### Features

- **project:** add project-bind foundation (db + aionui-project) (#672)
- **session-port:** route claude/codex through the direct-CLI SessionAgentTask (#609)
- **team:** leader-only warmup with lazy teammate wakeup and per-member attach (#670)

#### Bug Fixes

- **acp:** harden grok startup environment and npx recovery (#662)
- **cron:** use host timezone for conversation cron (#652)
- **skills:** repair butler cron and doc drift (2026-07-22 audit) (#664)
- **system:** release keep-awake on shutdown (#666)

---

## [2.1.39](https://github.com/iOfficeAI/AionUi/compare/v2.1.38...v2.1.39) (2026-07-21)

### Desktop

#### Features

- **settings:** configure model capabilities (#3639)
- **settings:** promote Kimi/Moonshot placement in platform and agent lists (#3629)
- **feedback:** route-aware module preselection and ask-the-butler chip on error surfaces (#3626)
- **github:** automated issue/PR/discussion triage to module owners (#3631)
- **github:** post claim invitation when an issue is labeled bonus (#3649)

#### Bug Fixes

- **startup:** stop false "local data repair failed" alarm from concurrent startup (#3650)
- **conversation:** show sign-in hint for empty ACP turns needing auth (#3644)
- **workspace:** stable file tree — expand state, search, preview panel (#3642)
- **agent-settings:** hide launch path for npx agents and fix repair-panel status banner (#3641)
- **settings:** keep agent repair panel mounted during background revalidation (#3624)
- **preview:** render distinct heading texts in markdown preview (#3630)
- **chat:** restore arrow-up icon on send buttons (#3627)
- **github:** never auto-assign bonus-labeled issues in triage workflow (#3647)
- **github:** use English-only module dropdown with exact-match triage parsing (#3636)

### Core ([v0.1.50](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.50))

#### Features

- **assets:** update Kimi logo to official brand mark (#646)
- **provider:** add per-model capability settings

#### Bug Fixes

- **acp:** bound config RPC timeout and release lease without tearing down connection (#654)
- **agent:** reflect auth failures from real turns into agent availability (#655)
- **agent:** reject and clear launch-path override for npx-bridged agents (#651)
- **agent:** surface sign-in hint on empty ACP turns from auth-gated agents (#653)
- **ai-agent:** enable official kimi k2.7 code image input
- **conversation:** rebuild aionrs sessions from persisted runtime permission (#661)
- **db:** prevent duplicate migration versions
- **provider:** preserve automatic vision detection
- **startup:** make concurrent aioncore startup safe over one data directory (#657)
- **ci:** validate migrations against latest release

---

## [2.1.38](https://github.com/iOfficeAI/AionUi/compare/v2.1.37...v2.1.38) (2026-07-20)

### Desktop

#### Features

- **guid:** task-oriented default prompts with refined suggestion styling (#3622)
- **guid:** expand assistant more dropdown into responsive multi-column panel (#3621)
- **settings:** add agent and assistant search (#3616)

#### Bug Fixes

- **system:** let backend own keep-awake blocker (#3620)
- **installer:** run arch check before registry mutation (#3619)
- **team:** treat idle-stopped session as recoverable, not a draft-box block (#3618)
- **settings:** hide agent search on mobile (#3617)

### Core ([v0.1.49](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.49))

#### Features

- **agents:** sync ACP Registry integrations (#637)
- **ai-agent:** use responses api for gpt-5.6
- **config:** add conversation rename command (#638)
- **idle:** extend idle-cleanup timeouts and make them env-configurable (#643)

#### Bug Fixes

- **ai-agent:** ignore max token limits for aionui requests
- **system:** apply keep-awake client preference (#642)
- **team:** broadcast Stopped status on idle-cleanup team reclaim (#640)

---

## [2.1.37](https://github.com/iOfficeAI/AionUi/compare/v2.1.36...v2.1.37) (2026-07-18)

### Desktop

#### Bug Fixes

- **renderer:** keep team elapsed timer continuous across remount (#3612)
- **bridge:** accept void-param invokes after JSON serialization (#3611)

---

## [2.1.36](https://github.com/iOfficeAI/AionUi/compare/v2.1.35...v2.1.36) (2026-07-17)

### Desktop

#### Features

- **ui:** standardize drag-to-reorder UX for team tabs and pinned conversations (#3606)
- **ui:** add search to skills/MCP submenus and assistant default selects (#3605)
- **skills:** skill detail page with assistant attachment (#3604)
- **skills:** add batch delete for custom skills (#3600)
- **cron:** add queue protection and custom schedules (#3552)

#### Styling

- **skills:** soften batch-mode selected card state (#3603)

### Core ([v0.1.48](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.48))

#### Features

- **agents:** add Pi coding agent as builtin ACP agent (#618)
- **ai-agent:** route image attachments by model capability
- **aionrs:** inline image attachments for Aion CLI
- **team:** add CLI fallback collaboration transport (#629)

#### Bug Fixes

- **acp:** confirm legacy mode/model on ACK instead of awaiting observed update (#635)
- **agents:** honor login PATH and validate builtin CLIs (#622)
- **ai-agent:** pin image-capable aionrs revision
- **assistant:** canonicalize rule file storage (#625)
- **assistant:** stop legacy override sync from clobbering user toggles (#634)

#### Code Refactoring

- **runtime:** remove legacy Bun runtime support (#623)

---

## [2.1.35](https://github.com/iOfficeAI/AionUi/compare/v2.1.34...v2.1.35) (2026-07-14)

### Desktop

#### Bug Fixes

- **renderer:** restrict message file marker parsing (#3590)
- **conversation:** handle busy send conflicts (#3589)
- **packaging:** verify bundled resources from manifest (#3587)
- **feedback:** attach team route context
- **startup:** classify assistant bootstrap failures (#3583)

### Core ([v0.1.47](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.47))

#### Features

- **cron:** deduplicate and protect scheduled executions (#601)
- **diagnostics:** expand feedback runtime evidence (#612)

#### Bug Fixes

- **assistant:** skip dirty assistant bootstrap records (#615)
- **managed-resources:** emit bundled resource manifest (#617)

---

## [2.1.34](https://github.com/iOfficeAI/AionUi/compare/v2.1.33...v2.1.34) (2026-07-13)

### Desktop

#### Bug Fixes

- **team:** show accepted team work as processing (#3576)
- **conversation:** prevent queue drain from racing backend idle state (#3571)

### Core ([v0.1.46](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.46))

#### Bug Fixes

- **acp:** normalize Codex full-access mode (#608)
- **butler:** correct three breaking field mismatches + update rule to CLI model (#607)

---

## [2.1.33](https://github.com/iOfficeAI/AionUi/compare/v2.1.32...v2.1.33) (2026-07-11)

### Desktop

#### Bug Fixes

- **build:** align Codex installer verifier (#3561)

---

## [2.1.32](https://github.com/iOfficeAI/AionUi/compare/v2.1.31...v2.1.32) (2026-07-10)

### Desktop

#### Bug Fixes

- **i18n:** update Russian localization (#3541)

#### Features

- **i18n:** add French locale (#2731)
- **guid:** move mobile home input controls into a + action sheet (#3554)
- **team:** add manual teammate management (#3532)
- **conversation:** rework model selector into a two-level menu (#3550)
- **conversation:** rework message queue into a send draft box (#3547)

#### Refactoring

- **conversation:** fold draft box help into the mode toggle (#3553)

### Core ([v0.1.45](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.45))

#### Features

- **ai-agent:** adapt to aionrs v0.2.2 config changes
- **cli:** add agent-facing config and diagnose commands (#595)

#### Bug Fixes

- **ai-agent:** cap provider health check tokens
- **ai-agent:** set default aionrs thinking cli args
- **model_fetcher:** extract first key from multi-line api_key for HTTP requests (#593)
- **runtime:** update Claude ACP package (#599)
- **runtime:** update managed Codex ACP package (#598)
- stop defaulting aionrs max tokens

---

## [2.1.31](https://github.com/iOfficeAI/AionUi/compare/v2.1.30...v2.1.31) (2026-07-08)

### Desktop

#### Bug Fixes

- **installer:** harden Windows failure reporting and self-lock handling (#3533)
- prepare backend startup directories (#3536)
- **settings:** avoid Arco tooltip crash in skills page (#3535)

#### Features

- **feedback:** attach core diagnostics to reports (#3529)
- **settings:** assistant editor and settings UI polish (#3528)

### Core ([v0.1.44](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.44))

#### Features

- **agent:** use aionrs runtime env API (#586)
- **ai-agent:** surface upstream 429 body in AgentSendError detail (#591)
- **system:** add feedback diagnostics report (#585)

#### Bug Fixes

- **agent:** preserve ACP error cause detail (#581)
- **skills:** correct aionui-config butler skill drift (2026-07) (#584)
- use provider and model protocol to determine llm request

---

## [2.1.30](https://github.com/iOfficeAI/AionUi/compare/v2.1.29...v2.1.30) (2026-07-06)

### Desktop

#### Bug Fixes

- wrong OpenAI SDK param name, throttle cleanup leak, missing alt text (#3512)
- **installer:** harden Windows NSIS update failure handling (#3523)

#### Features

- **guid:** add slash command menu (#3524)
- **assistant:** add thought level defaults to assistant UI (#3522)
- **settings:** add inline link to model config when no image model is available
- **settings:** default to the Agents tab when opening settings

#### Refactoring

- **settings:** describe skill origins per tab instead of per-card badges
- **settings:** split skills/tools entries and unify page header paradigm

#### Styling

- **settings:** match agent availability filter to assistant home tabs

### Core ([v0.1.43](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.43))

#### Features

- **assistant:** persist thought-level defaults (#574)

#### Bug Fixes

- **agent:** project available commands in management rows (#579)
- **assistant:** filter generated assistants by installed agents (#578)
- **cron:** enforce full-auto mode for scheduled tasks (#576)

---

## [2.1.29](https://github.com/iOfficeAI/AionUi/compare/v2.1.28...v2.1.29) (2026-07-03)

### Desktop

#### Bug Fixes

- **assistant:** use management catalog for editor engines (#3511)
- **cron:** improve scheduled task conversation history (#3510)
- show unchecked agents and rotate frontend logs by message date (#3507)
- **assistant:** return to My Assistants after duplicating/creating

#### Features

- **assistant:** promote assistants to a top-level sidebar entry
- **assistant:** unify selection-list ordering, keep CLI agents on top
- **assistant:** rebuild management page into My / Official tabs
- **assistant:** reword official read-only banner and make copy link inline
- **assistant:** custom-empty state, return-to-official on save, field polish

#### Refactoring

- **layout:** move conversation search into the titlebar toolbar

#### Styling

- **assistant:** apply oxfmt formatting to assistant home components

### Core ([v0.1.42](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.42))

#### Bug Fixes

- **agent:** align unchecked availability with team runtime selection (#571)
- **agent:** avoid full availability refresh on reads (#566)
- **cron:** preserve existing conversation jobs across lifecycle changes (#572)
- **mcp:** support aionrs config path subcommand with legacy fallback (#568)
- preserve ACP config catalogs on resume (#570)
- preserve Linux GLIBC baselines (#573)

#### Features

- **assistant:** 官方助手默认关闭 + 固定顺序 + 一次性重置迁移 (#567)

---

## [2.1.28](https://github.com/iOfficeAI/AionUi/compare/v2.1.27...v2.1.28) (2026-07-02)

### Desktop

#### Bug Fixes

- **i18n:** resolve main locale gaps (#3503)
- **startup:** confirm corrupted database rebuild (#3502)
- **team:** pass capabilities to team chat send box (#3501)
- **runtime:** coordinate foreground leases and runtime ensure (#3497)
- **cron:** lock team cron task editing (#3496)
- **desktop:** support dated frontend log layout (#3495)
- **assistant:** render empty avatars consistently (#3493)
- **cron:** support team context job navigation (#3492)
- **acp:** dedupe runtime option requests (#3490)
- **assistant:** correct engine section badge tone to warning
- **cron:** sync manual task assistant selection (#3485)
- **desktop:** wait for macOS update install readiness (#3484)

#### Features

- **i18n:** add Persian (fa-IR) locale support (#3284)
- **i18n:** add complete Spanish (es-ES) translation (#3402)
- **conversation:** keep batch-selection panel pinned while scrolling
- **conversation:** keep project folder header sticky while scrolling
- **conversation:** reveal active conversation by expanding its section and folder
- **conversation:** surface session skills in slash command menu

### Core ([v0.1.41](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.41))

#### Bug Fixes

- **assistant:** normalize avatar storage and identity (#558)
- **conversation:** derive assistant runtime type from metadata (#555)
- **conversation:** partition temp workspaces and logs by date (#560)
- **cron:** apply custom assistant rules in scheduled runs (#495)
- **cron:** lock team cron execution mode (#562)
- **cron:** route skill scheduling through helper (#553)
- **database:** require explicit corrupted database recovery (#563)
- resolve ACP backends from metadata (#559)
- **runtime:** harden managed Node command resolution (#565)
- **runtime:** protect active ACP tasks from idle cleanup (#561)
- **skill:** raise import size limits (#564)
- **skills:** correct AionUi Butler skill drift against current backend (#557)

---

## [2.1.27](https://github.com/iOfficeAI/AionUi/compare/v2.1.26...v2.1.27) (2026-06-30)

### Desktop

#### Bug Fixes

- **team:** reconcile stale run state (#3480)
- **cron:** preserve scheduled task conversations (#3479)
- **cron:** restore scheduled conversations to history (#3478)
- **mcp:** isolate backend cwd for stdio tools (#3476)
- **agent:** show ACP model descriptions (#3463)

### Core ([v0.1.40](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.40))

#### Features

- **team:** add run state snapshot endpoint (#549)

#### Bug Fixes

- **acp:** preserve selectors for partial config snapshots (#548)
- **cron:** restore create command heading (#547)
- **cron:** run jobs through conversation service (#546)
- **skills:** repair butler endpoint drift + add cron scheduling (#550)
- **windows:** handle runtime process lifecycle

---

## [2.1.26](https://github.com/iOfficeAI/AionUi/compare/v2.1.25...v2.1.26) (2026-06-29)

### Desktop

#### Bug Fixes

- **agent:** tighten repair save and test flow (#3470)
- **guid:** remember last selected assistant (#3468)
- **assistant:** prefer runtime config options for defaults (#3466)
- **conversation:** restore team chat full width (#3464)
- **fs:** pass workspace roots to local fs routes (#3451)

#### Styling

- **settings:** clean up assistant card more-button

### Core ([v0.1.39](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.39))

#### Bug Fixes

- **agent:** adapt aionrs compat API (#528)
- **agent:** guard internal Aion CLI command overrides (#538)
- **app:** reuse conversation service for channel messages (#531)
- **assistant:** preserve builtin override selections (#535)
- **file:** trust local workspace roots for fs routes (#527)

---

## [2.1.25](https://github.com/iOfficeAI/AionUi/compare/v2.1.24...v2.1.25) (2026-06-26)

### Desktop

#### Features

- **assistant:** add TalkToButler entry-point infrastructure
- **cron:** add create-via-chat path to scheduled tasks page
- **cron:** use TalkToButlerButton for create + align button styles
- **feedback:** add "solve via chat" to bug report
- **settings:** wire "via chat" into create/add flows
- **web-host:** remove single-chat team upgrade path (#3441)

#### Bug Fixes

- **avatar:** prevent local avatar path rendering (#3439)
- **conversation:** make chat width fluid (#3436)
- **cron:** consume create-via-chat prefill only once per navigation
- **desktop:** classify agent metadata cache repair failures (#3450)
- **guid:** improve dark-mode contrast for inactive agent selector labels (#3430)
- **guid:** load runtime catalog from agent metadata (#3440)
- **guid:** remove static codex runtime catalog (#3443)
- **guid:** resolve assistant skill defaults from config (#3445)
- **guid:** stop showing stale Codex model fallback (#3432)
- **installer:** verify bundled resources (#3444)
- **linux:** align desktop icon name (#3449)
- **settings:** clarify custom agent acp requirement (#3448)

#### Refactoring

- **cron:** hide conversation header entry when no scheduled task exists

### Core ([v0.1.38](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.38))

#### Features

- remove single-chat team upgrade path (#524)

#### Bug Fixes

- **agent:** expose runtime catalogs from metadata (#523)
- **assistant:** expose auto-inject skills and preserve assistant rules (#525)
- repair invalid UTF-8 agent metadata cache fields (#526)
- **skills:** sync AionUi Butler skills + rule with current backend (#520)

---

## [2.1.24](https://github.com/iOfficeAI/AionUi/compare/v2.1.23...v2.1.24) (2026-06-25)

### Desktop

#### Features

- **agent:** connection testing and assistant availability surfacing (phase 2) (#3395)
- **conversation:** add cursor message pagination (#3422)

#### Bug Fixes

- **conversation:** localize structured agent errors (#3426)
- **desktop:** repair legacy database handoff startup (#3423)
- **release:** restore mac zip artifacts (#3415)
- **settings:** prevent capabilities tab flicker (#3414)

### Core ([v0.1.37](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.37))

#### Features

- **agent:** detect availability via session/new probe and assistant-first identity (#500)
- **conversation:** add cursor pagination for messages (#515)

#### Bug Fixes

- **agent:** classify ACP and provider errors (#518)
- **aionrs:** adapt runtime guard config (#510)
- **conversation:** recover dead ACP turns after agent process loss (#514)
- **db:** repair legacy handoff schema drift (#516)
- validate skill frontmatter as yaml (#512)

---

## [2.1.23](https://github.com/iOfficeAI/AionUi/compare/v2.1.22...v2.1.23) (2026-06-23)

### Desktop

#### Features

- **webui:** add browser notifications for permission requests and turn completion (#3401)

#### Bug Fixes

- **preview:** correct OfficeCLI repo slug casing and de-DE install hint (#3399)

### Core ([v0.1.36](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.36))

#### Bug Fixes

- **deps:** update quinn-proto for RustSec advisory (#508)
- load skills in custom workspaces (#506)
- **agent:** support aionrs 0.1.31 (#503)

---

## [2.1.22](https://github.com/iOfficeAI/AionUi/compare/v2.1.21...v2.1.22) (2026-06-22)

### Desktop

#### Features

- **acp:** preserve redacted raw error in AIONUI_INTERNAL_ERROR fallback (#3393)

#### Bug Fixes

- **markdown:** support local file hash line links (#3396)
- **conversation:** localize OpenClaw Gateway startup error (#3392)
- **mcp:** guard message calls against use-after-unmount crash (#3376)
- **preview:** improve file diffs and local file links (#3379)
- **installer:** harden win arm64 install (#3387)

### Core ([v0.1.34](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.34))

#### Bug Fixes

- **agent:** expose aionrs mode config option (#501)
- **agent:** surface OpenClaw Gateway unreachable errors (#498)
- **aionrs:** classify engine errors structurally (#494)
- **aionrs:** drop malformed tool-call events (#486)
- **channel:** reuse stored credentials when re-enabling a plugin (#458)

---

## [2.1.21](https://github.com/iOfficeAI/AionUi/compare/v2.1.20...v2.1.21) (2026-06-18)

### Desktop

#### Features

- **i18n:** add German (de-DE) locale (#3370)

#### Bug Fixes

- **preview:** restore local html and selected file reopen (#3369)
- **preview:** build valid file:// URL for PDF preview on Windows (#3366)
- **i18n:** wire pt-BR into language pickers and main-process loader (#3361)

### Core ([v0.1.32](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.32))

#### Features

- **team:** centralize team MCP prompt governance ([#490](https://github.com/iOfficeAI/AionCore/issues/490))

#### Bug Fixes

- **acp:** recover dead ACP connections ([#487](https://github.com/iOfficeAI/AionCore/issues/487))
- **conversation:** upsert streaming tool calls (AIO-30) ([#484](https://github.com/iOfficeAI/AionCore/issues/484))

#### Documentation

- **skills:** add cross-platform notes so Windows users translate shell examples ([#489](https://github.com/iOfficeAI/AionCore/issues/489))

---

## [2.1.20](https://github.com/iOfficeAI/AionUi/compare/v2.1.19...v2.1.20) (2026-06-17)

### Desktop

#### Features

- **agent:** combine header model thinking selector (#3358)
- **update:** add singleton update notification (#3351)
- **team:** handle queued team runtime metadata (#3349)

#### Bug Fixes

- **team:** wait for solo turn before handoff queue drain (#3353)
- **assistant:** remove leftover gap above assistant list (#3344)

### Core ([v0.1.31](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.31))

#### Features

- **assistant:** add built-in AionUi self-management assistant ([#474](https://github.com/iOfficeAI/AionCore/issues/474))
- **assistant:** expand AionUi assistant into a butler with remote-access ([#481](https://github.com/iOfficeAI/AionCore/issues/481))
- enforce TeamRun ownership for agent turns ([#483](https://github.com/iOfficeAI/AionCore/issues/483))
- **team:** support queued team_send_message semantics ([#479](https://github.com/iOfficeAI/AionCore/issues/479))

#### Bug Fixes

- **acp:** persist runtime model and mode into assistant preferences ([#482](https://github.com/iOfficeAI/AionCore/issues/482))
- harden ACP image path handling ([#477](https://github.com/iOfficeAI/AionCore/issues/477))
- **team:** retry handoff turns after runtime release ([#480](https://github.com/iOfficeAI/AionCore/issues/480))

---

## [2.1.19](https://github.com/iOfficeAI/AionUi/compare/v2.1.18...v2.1.19) (2026-06-15)

### Desktop

#### Features

- **team:** support slot-scoped stop controls (#3334)
- **desktop:** report installation integrity diagnostics (#3333)
- **update:** use CDN metadata for stable auto updates (#3244)
- **acp:** add observed config option selectors (#3324)
- **layout:** make sider wordmark a back-to-chat control in settings (#3320)
- **preview:** actionable server-side install guidance for officecli errors in web mode (#3310)

#### Bug Fixes

- align team workspace display fallback (#3340)
- **team:** prefer assistant avatars in team chats (#3338)
- repair assistant cron and guid metadata flows (#3336)
- **assistant:** remove star office ui remnants (#3329)
- **startup:** hydrate windows path for cli detection (#3308)
- **docker:** install libicu so officecli preview works on Linux server deployments (#3323)
- **agents:** keep disabled custom agents visible in settings (#3319)
- **stt:** keep recording when streaming fails before it establishes (#3317)

### Core ([v0.1.30](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.30))

#### Features

- **acp:** use observed config options for preferences ([#468](https://github.com/iOfficeAI/AionCore/issues/468))
- align team shared workspace resolution ([#475](https://github.com/iOfficeAI/AionCore/issues/475))
- **team:** support slot-scoped team pause and wake flow ([#472](https://github.com/iOfficeAI/AionCore/issues/472))

#### Bug Fixes

- **agent:** send non-empty clientInfo in ACP initialize handshake ([#471](https://github.com/iOfficeAI/AionCore/issues/471))
- **agent:** wait for task shutdown during clear ([#446](https://github.com/iOfficeAI/AionCore/issues/446))
- **assistant:** remove star office helper remnants ([#470](https://github.com/iOfficeAI/AionCore/issues/470))
- **office:** fetch officecli installer from official mirror before GitHub ([#463](https://github.com/iOfficeAI/AionCore/issues/463))
- preserve assistant snapshot and skill wiring for cron ([#473](https://github.com/iOfficeAI/AionCore/issues/473))
- **shell:** reveal file via FileManager1 D-Bus on Linux ([#466](https://github.com/iOfficeAI/AionCore/issues/466))

---

## [2.1.18](https://github.com/iOfficeAI/AionUi/compare/v2.1.17...v2.1.18) (2026-06-12)

### Desktop

#### Features

- **stt:** streaming voice input with live transcript (#3291)
- **assistant:** deliver phase-1 governance settings (#3277)
- stabilize team mode conversation runtime (#3309)

#### Bug Fixes

- **updater:** wait for backend shutdown before install (#3270)
- **windows-installer:** recover from long-path uninstall failures (#3296)
- **macos:** add audio-input entitlement so microphone works (#3294)
- **preview:** drop bare trailing slash from office watch proxy url (#3287)
- **workspace:** float directory picker above team/cron create modals
- **workspace:** enable clickable folder picker in webui

#### Styling

- **titlebar:** nudge feedback icon up to align with neighbors
- **markdown:** tighten desktop paragraph spacing
- **markdown:** tighten desktop chat body line-height
- **conversation:** show AI copy/timestamp row only at turn end
- **display:** tighten factory default font sizes and zoom

### Core ([v0.1.29](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.29))

#### Features

- converge team mode runtime architecture ([#464](https://github.com/iOfficeAI/AionCore/issues/464))
- **stt:** streaming transcription proxy over websocket ([#455](https://github.com/iOfficeAI/AionCore/issues/455))

#### Bug Fixes

- **agent:** validate managed ACP platform binaries ([#462](https://github.com/iOfficeAI/AionCore/issues/462))
- **cron:** retry busy jobs from runtime state ([#459](https://github.com/iOfficeAI/AionCore/issues/459))
- isolate ACP cancel turn completion ([#461](https://github.com/iOfficeAI/AionCore/issues/461))
- **office:** probe star-office preferred_url host as given ([#456](https://github.com/iOfficeAI/AionCore/issues/456))

#### Refactoring

- **assistant:** finalize unified governance storage ([#449](https://github.com/iOfficeAI/AionCore/issues/449))

---

## [2.1.17](https://github.com/iOfficeAI/AionUi/compare/v2.1.16...v2.1.17) (2026-06-11)

### Desktop

#### Features

- **settings:** voice input settings revamp and home page mic button (#3283)
- **titlebar:** add global feedback/report entry to toolbar
- **theme:** add Follow System theme mode to gallery (#3282)
- **settings:** support multi-select models when adding a model platform

#### Bug Fixes

- **webui:** normalize Windows verbatim paths from directory picker (#3286)
- **model-selector:** keep sticky platform title above scrolling items
- **settings:** allow editing Base URL when editing a model platform
- **stt:** send multipart request matching backend /api/stt contract (#3274)

#### Styling

- **model-selector:** sticky platform group titles in scrollable dropdown

### Core ([v0.1.28](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.28))

#### Bug Fixes

- **auth:** allow same-origin framing on office preview proxy routes ([#454](https://github.com/iOfficeAI/AionCore/issues/454))
- **file:** strip Windows verbatim prefix from /api/fs/browse paths ([#453](https://github.com/iOfficeAI/AionCore/issues/453))
- **stt:** STT compatibility fixes for Groq Whisper and AionUI web frontend ([#400](https://github.com/iOfficeAI/AionCore/issues/400))
- **stt:** treat blank base_url as unset and log malformed config ([#448](https://github.com/iOfficeAI/AionCore/issues/448))

---

## [2.1.16](https://github.com/iOfficeAI/AionUi/compare/v2.1.15...v2.1.16) (2026-06-10)

### Desktop

#### Bug Fixes

- **preview:** point OfficeCLI install help to official releases (#3264)
- **http:** read error response body once to avoid double consumption (#3262)
- **ci:** handle empty release prefix check (#3263)

### Core ([v0.1.27](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.27))

#### Bug Fixes

- **ai-agent:** auto approve team mcp permissions ([#447](https://github.com/iOfficeAI/AionCore/issues/447))
- **ai-agent:** trim stderr buffer at UTF-8 char boundary ([#443](https://github.com/iOfficeAI/AionCore/issues/443))
- **office:** resolve officecli shim from node_modules/.bin after npm prefix install ([#440](https://github.com/iOfficeAI/AionCore/issues/440))
- **office:** restore OfficeCLI installer resolution ([#444](https://github.com/iOfficeAI/AionCore/issues/444))

---

## [2.1.15](https://github.com/iOfficeAI/AionUi/compare/v2.1.14...v2.1.15) (2026-06-09)

### Desktop

#### Features

- enforce agent runtime policy and turn-aware UI state (#3253)
- render localized ACP empty-turn info tips (#3251)
- **conversation:** hide all conversation export UI entries
- make log directory configurable (#3233)

#### Bug Fixes

- **conversation:** align header model label with selector (#3257)
- **sendbox:** stop button glow clipped by mobile panel corner
- **login:** move mobile language selector to its own row to avoid logo overlap
- **desktop:** pass parent pid to bundled backend (#3250)

### Core ([v0.1.26](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.26))

#### Features

- enforce agent runtime policy and turn-aware state ([#436](https://github.com/iOfficeAI/AionCore/issues/436))

#### Bug Fixes

- **app:** use process synchronize access for parent watcher ([#438](https://github.com/iOfficeAI/AionCore/issues/438))
- **acp:** preserve confirmed model selection ([#437](https://github.com/iOfficeAI/AionCore/issues/437))
- **app:** stop backend when desktop exits ([#433](https://github.com/iOfficeAI/AionCore/issues/433))

---

## [2.1.14](https://github.com/iOfficeAI/AionUi/compare/v2.1.13...v2.1.14) (2026-06-08)

### Desktop

#### Bug Fixes

- **bootstrap:** block wrong macOS package architecture at startup (#3232)

### Core ([v0.1.24](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.24))

#### Bug Fixes

- **acp:** prefer config options catalogs ([#425](https://github.com/iOfficeAI/AionCore/issues/425))
- expose managed resource preparation failure details ([#430](https://github.com/iOfficeAI/AionCore/issues/430))
- handle Hermes yolo fallback correctly ([#428](https://github.com/iOfficeAI/AionCore/issues/428))
- harden managed ACP bundle preparation and builtin CLI availability ([#426](https://github.com/iOfficeAI/AionCore/issues/426))
- scope bundled ACP output under tool directories ([#431](https://github.com/iOfficeAI/AionCore/issues/431))
- **shell:** support UNC paths in Windows terminal ([#411](https://github.com/iOfficeAI/AionCore/issues/411))
- validate managed ACP packages via real entrypoints ([#429](https://github.com/iOfficeAI/AionCore/issues/429))

#### Refactoring

- **app:** organize CLI command boundaries ([#423](https://github.com/iOfficeAI/AionCore/issues/423))

---

## [2.1.13](https://github.com/iOfficeAI/AionUi/compare/v2.1.12...v2.1.13) (2026-06-07)

### Desktop

#### Features

- **appearance:** configurable font sizes & display→appearance rename (#3223)
- **theme:** unify theme system into a single Theme concept (#3219)

#### Bug Fixes

- **messages:** keep message list scrollbar flush to window edge (#3226)
- **preview:** default zoom to 100% and hide snapshot/history entry (#3222)
- **bootstrap:** preserve backend startup error codes (#3218)
- **runtime:** validate packaged node runtime layout (#3221)
- **runtime:** align installation integrity dialogs (#3220)
- **realtime:** canonicalize boundary errors (#3217)

#### Refactoring

- stabilize conversation runtime view contract (#3224)

### Core ([v0.1.23](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.23))

#### Features

- **cli:** canonicalize CLI and bootstrap boundary errors ([#417](https://github.com/iOfficeAI/AionCore/issues/417))

#### Bug Fixes

- **error:** canonicalize boundary errors ([#415](https://github.com/iOfficeAI/AionCore/issues/415))
- **runtime:** report bundled resource installation failures ([#420](https://github.com/iOfficeAI/AionCore/issues/420))
- **team:** inherit workspace for spawned agents ([#413](https://github.com/iOfficeAI/AionCore/issues/413))

#### Refactoring

- centralize agent runtime session context building ([#419](https://github.com/iOfficeAI/AionCore/issues/419))
- centralize runtime turn lifecycle ([#421](https://github.com/iOfficeAI/AionCore/issues/421))

---

## [2.1.12](https://github.com/iOfficeAI/AionUi/compare/v2.1.11...v2.1.12) (2026-06-05)

### Desktop

#### Features

- **i18n:** add Brazilian Portuguese (pt-BR) translation (#3209)
- **preview:** native Streamdown markdown rendering + full theming (#3204)

#### Bug Fixes

- **conversation:** align workspace path availability handling (#3207)
- **preview:** dedupe @codemirror/language so markdown source highlight survives (#3206)

### Core ([v0.1.22](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.22))

#### Bug Fixes

- **acp:** stabilize mode and model source of truth ([#409](https://github.com/iOfficeAI/AionCore/issues/409))
- **conversation:** align workspace path availability handling ([#410](https://github.com/iOfficeAI/AionCore/issues/410))
- **file:** lazy load browse roots ([#406](https://github.com/iOfficeAI/AionCore/issues/406))
- prepare managed acp tools locally without cdn ([#408](https://github.com/iOfficeAI/AionCore/issues/408))

#### Refactoring

- **error:** finish ApiError phase3 ([#398](https://github.com/iOfficeAI/AionCore/issues/398))

---

## [2.1.11](https://github.com/iOfficeAI/AionUi/compare/v2.1.10...v2.1.11) (2026-06-04)

### Desktop

#### Features

- **preview:** unify code viewing & editing on CodeMirror 6 (#3194)
- **preview:** unify code view font and fix view-mode/line-height regressions (#3185)
- **workspace:** VSCode-style file tree icons + smoother preview browsing (#3181)
- add managed acp artifact mirror workflow (#3182)

#### Bug Fixes

- **web-host:** use aioncore reported backend port (#3193)
- **settings:** apply UI scale only on slider release (#3190)

### Core ([v0.1.20](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.20))

#### Bug Fixes

- **app:** bind backend before startup services ([#397](https://github.com/iOfficeAI/AionCore/issues/397))
- stabilize agent runtime terminal lifecycle ([#396](https://github.com/iOfficeAI/AionCore/pull/396))

#### Refactoring

- **error:** ACP error classification ([#393](https://github.com/iOfficeAI/AionCore/issues/393))
- **error:** migrate phase2 service errors ([#395](https://github.com/iOfficeAI/AionCore/issues/395))

---

## [2.1.10](https://github.com/iOfficeAI/AionUi/compare/v2.1.9...v2.1.10) (2026-06-02)

### Desktop

#### Bug Fixes

- **runtime:** show runtime-specific MCP missing command hints (#3167)
- **startup:** add health polling diagnostics (#3168)
- **acp:** show model switch feedback
- **acp:** avoid duplicate runtime sync requests
- **acp:** wait for warmup before runtime sync
- **sentry:** split incomplete install diagnostics (#3164)
- normalize workspace path error handling (#3158)
- **acp:** fix model state sync after session recovery (#3162)
- **desktop:** persist close-to-tray setting (#3150)

### Core ([v0.1.19](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.19))

#### Bug Fixes

- **aionui-ai-agent:** classify aionrs API connection errors ([#389](https://github.com/iOfficeAI/AionCore/issues/389))
- classify missing MCP launcher runtimes ([#387](https://github.com/iOfficeAI/AionCore/issues/387))
- enforce workspace path whitespace errors across create and runtime ([#381](https://github.com/iOfficeAI/AionCore/issues/381))
- **startup:** add startup phase diagnostics ([#388](https://github.com/iOfficeAI/AionCore/issues/388))

---

## [2.1.9](https://github.com/iOfficeAI/AionUi/compare/v2.1.8...v2.1.9) (2026-06-01)

### Desktop

#### Bug Fixes

- **web-host:** skip fetch-blocked backend ports (#3146)
- **i18n:** clarify incomplete installation recovery (#3145)
- **conversation:** map 409 already-processing to CONVERSATION_BUSY (#3142)
- **i18n:** localize MCP check strings (#3141)

#### Features

- Allow importing skill folders and zip archives (#3144)

### Core ([v0.1.18](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.18))

#### Bug Fixes

- **agent:** classify Bedrock 'model identifier is invalid' as model-not-found (AIO-12) ([#377](https://github.com/iOfficeAI/AionCore/issues/377))
- **agent:** preserve process-group cleanup after leader exit ([#369](https://github.com/iOfficeAI/AionCore/issues/369))
- **agent:** tighten send_error classifier (AIO-87, AIO-89, AIO-90) ([#375](https://github.com/iOfficeAI/AionCore/issues/375))
- **aionui-ai-agent:** strip HTML body from sanitized error detail (AIO-13) ([#380](https://github.com/iOfficeAI/AionCore/issues/380))
- recover deleted conversation workspaces ([#379](https://github.com/iOfficeAI/AionCore/issues/379))

---

## [2.1.8](https://github.com/iOfficeAI/AionUi/compare/v2.1.7...v2.1.8) (2026-05-30)

### Desktop

#### Bug Fixes

- **desktop:** improve incomplete backend install diagnostics (#3121)
- **web-host:** enrich backend health timeout diagnostics (#3120)
- **feedback:** preserve structured live error tips (#3116)

### Core ([v0.1.17](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.17))

#### Bug Fixes

- **agent:** make codex sandbox sync non-fatal ([#370](https://github.com/iOfficeAI/AionCore/issues/370))

---

## [2.1.7](https://github.com/iOfficeAI/AionUi/compare/v2.1.6...v2.1.7) (2026-05-29)

### Desktop

#### Features

- **mcp:** move MCP management to conversation scope (#3109)

#### Bug Fixes

- **feedback:** tag agent error reports (#3113)
- **conversation:** render structured agent errors (#3093)
- **web-host:** reuse backend port after crash restart (#3111)
- **webui:** auto-open local url on startup (#3110)
- **startup:** ignore cancelled backend startup (#3108)
- **mcp:** validate json imports (#3106)
- **team:** avoid sidebar confirmation fan-out (#3105)
- **web-host:** add health timeout diagnostics (#3102)
- **settings:** avoid blue switch during image generation loading (#3091)

### Core ([v0.1.16](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.16))

#### Features

- **agent:** classify structured agent send errors ([#356](https://github.com/iOfficeAI/AionCore/issues/356))
- **mcp:** support session scoped MCP injection ([#363](https://github.com/iOfficeAI/AionCore/issues/363))

#### Bug Fixes

- channel reply stream cold start ([#366](https://github.com/iOfficeAI/AionCore/issues/366))
- **mcp:** clean up stdio test process trees ([#368](https://github.com/iOfficeAI/AionCore/issues/368))

---

## [2.1.6](https://github.com/iOfficeAI/AionUi/compare/v2.1.5...v2.1.6) (2026-05-28)

### Desktop

#### Bug Fixes

- **model-selector:** trust backend current model and persist preferences (#3084)
- **build:** align bundled aioncore target arch (#3092)
- **settings:** use provider health check probe (#3090)
- **settings:** use health check error message (#3080)
- **backend:** handle incomplete bundled aioncore installs (#3078)

#### Performance

- lazy-load full tool message content (#3086)
- improve message startup latency (#3082)

### Core ([v0.1.15](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.15))

#### Bug Fixes

- **agent:** add provider health check probe ([#358](https://github.com/iOfficeAI/AionCore/issues/358))

---

## [2.1.5](https://github.com/iOfficeAI/AionUi/compare/v2.1.4...v2.1.5) (2026-05-27)

### Desktop

#### Features

- **settings:** use backend MCP settings source (#3069)
- **settings:** rename capabilities tab + collapse speech/image-gen when disabled
- **settings:** clarify builtin assistant readonly state in editor
- **update:** add install warning on downloaded state in UpdateModal
- **tools:** allowlist image-gen models and document supported set

#### Bug Fixes

- **acp:** surface raw send errors (#3067)
- **guid:** use startsWith('custom:') to detect preset agent on New Chat reset
- **guid:** preserve CLI agent selection on New Chat, only reset preset agents
- **guid:** restore last selected agent on initial render without flash
- **guid:** include user skills in action-row Skills count
- **update:** polish downloaded state — remove desc text, drop icon from warning
- **startup:** show incompatible backend runtime (#3062)
- **image-gen:** strip response_format from gpt-image requests + remove double-save
- **tools:** use Form.Item tooltip prop for image model help icon
- **tools:** align help icon vertically with image model label
- **sendbox:** map workspace file paths for mentions (#3060)
- **settings:** route provider health check via aionrs (#3058)
- **settings:** localize sentence terminator on builtin readonly banner
- **electron:** tolerate pending backend startup (#3057)
- recover pending permission prompts (#3059)
- preserve timezone for scheduled tasks (#3056)

### Core ([v0.1.14](https://github.com/iOfficeAI/AionCore/releases/tag/v0.1.14))

#### Bug Fixes

- preserve cron timezone on legacy schedule updates ([#344](https://github.com/iOfficeAI/AionCore/issues/344))
- **startup:** add backend readiness diagnostics ([#346](https://github.com/iOfficeAI/AionCore/issues/346))

#### Refactoring

- four-layer architecture (connect / conv / biz) ([#349](https://github.com/iOfficeAI/AionCore/issues/349))

---

## [2.1.4](https://github.com/iOfficeAI/AionUi/compare/v2.1.3...v2.1.4) (2026-05-27)

### Desktop

#### Bug Fixes

- **messages:** ignore non-renderable stream events (#3053)
- **messages:** stabilize stream scrolling and initial loading (#3042)

---
