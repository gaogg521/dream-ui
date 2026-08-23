<h1 align="center">One Work</h1>

<p align="center">
  <img src="./resources/app.png" alt="One Work" width="72">
</p>

<p align="center">
  <strong>团队协作 · 极致高效 · 简单好用 · 隐私与信息安全优先</strong><br>
  <em>一个人用是创作引擎，一个团队用是交付平台</em>
</p>

<p align="center">
  本仓库 <code>dream-ui</code>：桌面客户端 / WebUI 前端
</p>

<p align="center">
  <img src="https://img.shields.io/github/v/release/gaogg521/dream-ui?display_name=tag&sort=semver&style=flat-square&color=32CD32" alt="Version">
  &nbsp;
  <img src="https://img.shields.io/badge/license-Apache--2.0-32CD32?style=flat-square" alt="License">
  &nbsp;
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-6C757D?style=flat-square" alt="Platform">
  &nbsp;
  <img src="https://img.shields.io/badge/Electron-37-47848F?style=flat-square&logo=electron&logoColor=white" alt="Electron">
  &nbsp;
  <img src="https://img.shields.io/badge/React-19-149ECA?style=flat-square&logo=react&logoColor=white" alt="React">
</p>

<p align="center">
  <a href="https://github.com/gaogg521/dream-ui/releases">
    <img src="https://img.shields.io/badge/⬇️%20立即下载-最新版本-32CD32?style=for-the-badge" alt="Download" height="45">
  </a>
  &nbsp;&nbsp;
  <a href="https://work.1oneclaw.com/">
    <img src="https://img.shields.io/badge/🌐%20官网-work.1oneclaw.com-0369a1?style=for-the-badge" alt="Website" height="45">
  </a>
</p>

<p align="center">
  后端仓库：<a href="https://github.com/gaogg521/dream-core">gaogg521/dream-core</a>
  &nbsp;·&nbsp;
  开发指南：<a href="./docs/guides/fork-dev-onboarding.zh-CN.md">fork-dev-onboarding.zh-CN.md</a>
</p>

---

## 目录

- [这是什么](#这是什么)
- [和竞品比什么](#和竞品比什么)
- [核心能力](#核心能力)
- [企业版设计](#企业版设计)
- [架构（v2）](#架构v2)
- [3 分钟上手](#3-分钟上手)
- [打包发行版](#打包发行版)
- [文档索引](#文档索引)
- [FAQ](#faq)
- [参与贡献](#参与贡献)
- [致谢](#致谢)

---

## 这是什么

**One Work** 不是「又一个 AI 聊天窗口」，而是一套 **Agent Cowork 平台**——AI Agent 在你的电脑上读文件、写代码、跑工具、按计划自动执行；你看得见它在做什么，并始终掌握批准权。产品定位就五件事：

| 定位                  | 说明                                                                                                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🌉 **官方 CLI 桥接**  | **Codex CLI / Claude Code 官方客户端，一键切到你自己配置的任意模型**（MiniMax/Kimi/DeepSeek/Gemini/自建网关…），不再被绑死 ChatGPT/Anthropic 官方账号，本地起兼容端点全程转发            |
| 🤝 **团队协作**       | Team Mode 多 Agent 编队，一个人也能调度一整支专家团队；企业版叠加 Issues 协作看板、需求一键拆单、数字员工编排、团队技能与 MCP 统一下发                                                   |
| ⚡ **极致高效**       | 一句话创作（游戏/PPT/开发任务/角色扮演）、**AI 出图出片（文生图/图生图/文生视频/图生视频，花费实时可见、可随时取消）**、Cron 24/7 自动化、MCP 工具一次配置全员复用，把重复劳动交给 Agent |
| 😊 **简单好用**       | 内置引擎安装即用、38 款主流 CLI Agent 自动识别、**22 个官方助手 + 252 位行业专家**开箱即用、桌面/WebUI/手机/IM 随处访问、记忆管理免去每次重新交代项目背景                                |
| 🔒 **隐私与信息安全** | 会话、配置、加密后的模型 API Key 全部落在本机磁盘不外传；自建后端不依赖第三方数据中台；企业版组织隔离 + SSO + 授权许可 + 内容审计/DLP + 审计日志                                         |

**One Work** 是平台整体对外名字，涵盖个人版、团队协作、企业管理后台在内的完整能力面，桌面客户端与 WebUI 都以这一身份出现。

与旧版单仓 [1ONE ClaudeCode](https://github.com/gaogg521/1ONE-Claude-Code) 不同，v2 采用 **前端 + 后端分离**：

| 仓库                                                 | 职责                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------ |
| **dream-ui**（本仓库）                               | Electron 桌面、React UI、WebUI 静态资源、安装包              |
| **[dream-core](https://github.com/gaogg521/dream-core)** | Rust 本地服务：`dreamcore` 进程，会话/助手/Agent/MCP/企业 API |

桌面启动时自动拉起 bundled 的 `dreamcore`；浏览器 WebUI 通过 HTTP + WebSocket 访问同一套后端。

**一句话区分**：

- Cursor 帮你写下一行代码
- Copilot 帮你补全一个函数
- **One Work 帮你统管一整支 AI 队伍，并把产出写进团队交付流程**

---

## 和竞品比什么

| 对比维度                            | **One Work**                | Cursor  |   Copilot   | 原生 Claude Code |
| ----------------------------------- | ---------------------------- | :-----: | :---------: | :--------------: |
| 开源                                | ✅ Apache-2.0                |   🔒    |     🔒      |        🔒        |
| **官方 CLI 桥接自定义模型**         | ✅ **Codex/Claude 一键桥接** |   ❌    |     ❌      | ❌ 只能官方账号  |
| 内置 Agent（零配置开箱）            | ✅ **1ONE CLI**              |   ❌    |     ❌      |    ⚠️ 需 CLI     |
| 多 Agent 并存                       | ✅ 38 款自动发现             | ⚠️ 有限 |    ⚠️ 弱    |     ❌ 单一      |
| Team 多 Agent 协作                  | ✅ Leader + Teammate         |   ❌    |     ❌      |        ❌        |
| 独立 WebUI + 手机访问               | ✅                           |   ❌    |     ❌      |        ❌        |
| IM 渠道（飞书/钉钉/微信/Telegram…） | ✅                           |   ❌    |     ❌      |        ❌        |
| 定时任务 Cron                       | ✅ 24/7 无人值守             |   ❌    |     ❌      |     ⚠️ 有限      |
| 专业助手 + 行业专家                 | ✅ **22 + 252**              |   ❌    |     ❌      |     ⚠️ 有限      |
| 企业 / Issues / DevOps（fork 扩展） | ✅ `one-*` crates            |   ❌    |     ❌      |        ❌        |
| 离线团队知识库（RAG）               | ✅ 全离线混合检索            |   ❌    |     ❌      |        ❌        |
| 席位计费 / 授权许可 / 模型成本管控  | ✅ 三档 + 离线激活           |   ❌    | ⚠️ 仅订阅制 |        ❌        |
| 内容审计 / DLP                      | ✅ 结构化拒绝理由            |   ❌    |     ❌      |        ❌        |
| 部门预算 / 通讯录同步 / 生成物账本  | ✅ 三线一致治理              |   ❌    |     ❌      |        ❌        |
| 私有化 / 内网部署                   | ✅ 含独立服务端 Docker       |   ❌    | ⚠️ 企业可选 |    ⚠️ 大客户     |

---

## 核心能力

> 以下截图均为真实产品界面（dream-ui 桌面客户端 / WebUI），非效果图。四组能力对应上面「这是什么」定位表格的顺序。

### 🌉 模型自由 — 官方 CLI 也能用你自己的模型

**这是 One Work 相比其他 AI 编程工具最大的差异化能力。** OpenAI 官方的 **Codex CLI** 和 Anthropic 官方的 **Claude Code**，都被各自厂商锁死只能连自家的 ChatGPT / Anthropic 账号——想用国产模型、自建网关或第三方中转，官方客户端无路可走。One Work 在本机起一个**兼容协议的本地端点**，把 Codex/Claude 官方 CLI 的请求原样接住再转发给你自己配置的任意模型服务商，开关一键切换，全程不出本机：

<p align="center">
  <img src="./resources/CODEX和Claude一键桥接.png" alt="Codex / Claude 官方 CLI 一键桥接自定义模型" width="900">
</p>

桥接生效后，会话顶部的模型徽标会直接标出「已桥接」并锁定（避免实时切模型绕过桥接），对话过程中随时能确认当前用的是自己配置的模型，而不是官方默认账号。

- **Codex 桥接**：`设置 → Codex 桥接`，选择服务商与模型（MiniMax / Kimi / DeepSeek / Gemini 等），保存后本机已安装的 Codex CLI 自动改走这里。
- **Claude 桥接**：`设置 → Claude 桥接`，同样的思路接管 Claude Code 官方客户端的模型来源。
- 两者都是**纯本地转发**，不经过第三方中转服务器，符合项目「隐私与信息安全优先」的一贯原则。

### 🤝 协作与随处访问

从桌面到浏览器、从一个人到一整支团队，覆盖这三个维度：

#### Cowork 桌面工作台

不只是聊天——Agent 可**读写工作区文件**、执行多步任务、在权限对话框里等你批准（或使用 YOLO / Full-Auto 一键放行）。个人版与企业团队版共用同一套界面，顶部一键切换：

<p align="center">
  <img src="./resources/首页.png" alt="Cowork 桌面首页" width="900">
</p>

工作区采用三栏布局：左侧历史会话/团队列表，中间对话，右侧实时展示当前项目的文件与改动，边聊边看 Agent 到底改了什么：

<p align="center">
  <img src="./resources/工作空间.png" alt="工作区三栏布局：历史会话 + 对话 + 项目文件" width="900">
</p>

右侧项目面板分「文件 / 变更」两个视图，可以直接搜索定位文件；让 Agent 通读整个仓库做架构分析这类重活，结论就在左边输出、证据在右边随时点开核对：

<p align="center">
  <img src="./resources/工具使用.png" alt="Agent 通读仓库产出架构分析，右侧项目面板可搜索文件与查看变更" width="900">
</p>

模型平台配置一次，支持自定义 API 地址、多个 API Key 轮询、一次勾选多个模型；Agent 也会真的在你的电脑上执行文件操作（整理文件、删除、创建、写入内容等）：

<table>
  <tr>
    <td width="50%"><img src="./resources/模型添加.png" alt="添加/编辑模型平台"></td>
    <td width="50%"><img src="./resources/会话执行本地电脑的操作.png" alt="Agent 执行本地电脑操作"></td>
  </tr>
</table>

所有历史会话与团队作战记录集中在「会话中心」，随时找回、继续：

<p align="center">
  <img src="./resources/历史会话.png" alt="历史会话中心" width="720">
</p>

#### 多 Agent 指挥台 + Team Mode 编队

本机已安装的 CLI Agent **自动检测、统一界面**：内置支持列表覆盖 **38 款**主流 AI 编程 Agent（Claude Code · Codex CLI · Cursor · Amp · Auggie · CodeBuddy · Copilot · Cortex Code · Corust Agent · Qwen Code · Gemini · 1ONE CLI 等），已安装的自动识别为「可用」，未安装的一键跳转安装指南，可并行多会话：

<p align="center">
  <img src="./resources/AGENGT助手1.png" alt="Agents 页：38 款 CLI Agent 自动检测可用状态" width="900">
</p>

开启 **Team Mode** 后，从助手库勾选成员、指定一名 Leader 即可组队：

<p align="center">
  <img src="./resources/团队多任务角色.png" alt="创建团队：选择成员与 Leader" width="720">
</p>

Leader 拆任务、Teammate 并行执行，共享工作区与任务看板——下图是 1ONE CLI 担任 Leader、调度 Claude Code 与专属 Word 撰写助手协作产出一份调研报告的真实过程，覆盖任务分配到最终导出 PDF/HTML 的完整链路：

<p align="center">
  <img src="./resources/团队AGENT测试.png" alt="Team Mode 多 Agent 协作" width="900">
</p>
<p align="center">
  <img src="./resources/团队AGENT测试2.png" alt="团队协作产出多格式报告" width="900">
</p>

团队里每个成员的完整作战过程都能一键导出成**离线单文件 HTML**——分列视图复刻界面多列布局、全局时间线按时间轴合并全员消息，工具调用详情全量保留（默认折叠），不依赖任何在线服务即可归档，或直接发给没装本产品的同事看结果。

Leader 也可以针对更复杂的目标（如一份跨领域调研报告）现场组建团队、按依赖关系分配任务：

<table>
  <tr>
    <td width="33%"><img src="./resources/团队任务.png" alt="团队任务分配"></td>
    <td width="33%"><img src="./resources/团队任务1.png" alt="Leader 拆解任务"></td>
    <td width="33%"><img src="./resources/团队任务2.png" alt="团队组建方案"></td>
  </tr>
</table>

#### 随处 Cowork：WebUI + IM 渠道

浏览器 / 手机 / 局域网 / 服务器均可访问同一套后端，扫码或密码登录，把 One Work 当作 7×24 小时在线的远程助手：

<table>
  <tr>
    <td width="50%"><img src="./resources/远程访问.png" alt="启用 WebUI 远程访问"></td>
    <td width="50%"><img src="./resources/远程访问设置.png" alt="WebUI 账号与权限设置"></td>
  </tr>
</table>

同时可打通即时通讯软件，配对成功后直接在聊天窗口里指挥 Agent——**Telegram、飞书（Lark）、钉钉、微信**已可用，企业微信 / Slack / Discord 即将上线：

<p align="center">
  <img src="./resources/渠道配置.png" alt="渠道配置：Telegram / Lark / 钉钉 / 微信已上线，企业微信 / Slack / Discord 即将上线" width="900">
</p>
<p align="center">
  <img src="./resources/通讯渠道控制.png" alt="微信设备配对与实时对话" width="720">
</p>

### ⚡ 效率与自动化

把创作和重复劳动都交给 Agent：

#### 一句话创作

不会写代码、不会画分镜也能出成品——一句话生成小游戏、沉浸式故事角色扮演、专业 PPT、甚至完整的开发任务交付：

<p align="center">
  <img src="./resources/一句话完成开发任务.png" alt="一句话完成开发任务" width="720">
</p>

游戏创作支持 3D 平台跳跃、2D 横版闯关、FPS 射击、消除类等多种类型，一句话描述即可生成可玩 Demo——下图是「模仿三角洲行动做一个枪战游戏，HTML 能玩」的真实生成过程，右侧预览面板里生成的 `delta_shooter.html` 直接可玩，顶部模型徽标同样标着「已桥接」：

<p align="center">
  <img src="./resources/一句话游戏.png" alt="一句话生成 HTML5 射击游戏 Demo，实时预览可玩" width="900">
</p>

<table>
  <tr>
    <td width="50%"><img src="./resources/一句话做游戏2.png" alt="3D 平台跳跃小游戏"></td>
    <td width="50%"><img src="./resources/一句话做游戏3.png" alt="2D 横版闯关小游戏"></td>
  </tr>
  <tr>
    <td width="50%"><img src="./resources/一句话游戏4.png" alt="FPS 射击游戏全屏预览"></td>
    <td width="50%"><img src="./resources/一句话做游戏4.png" alt="消除类小游戏"></td>
  </tr>
</table>

故事角色扮演支持三种起点：自然语言直接对话创建角色、直接粘贴角色卡 PNG、或打开完整角色包（PNG/JSON）；生成的角色设定与世界观会落地为可复用的 `character.json` / `world-info.json`：

<p align="center">
  <img src="./resources/一句话创作2.png" alt="一句话创作：生成角色设定与世界观文件" width="900">
</p>

#### AI 出图与出片

四条路都通：**文生图、图生图、文生视频、图生视频**。在发送框把模式切到「图片生成」或「视频生成」，选好模型直接说要什么；要改一张已有的图或让一张图动起来，就把它作为参考图一起发出去。

<p align="center">
  <img src="./resources/文生图.png" alt="文生图：结果卡片显示状态、模型、提示词与本次花费" width="720">
</p>

生成结果是一张**结果卡片**，不是一行文件路径：出图后可以直接复制、下载、引用回输入框继续追问、或重新生成一次；卡片上还标着**本次实际花费**。发送前也会先给预估——读不到你渠道真实价格时会明说「费用未知」，而不是显示一个像真的一样的 `$0.00`。

给一张参考图，就是**图生图**——卡片会把这次用的参考图和产出图一起显示，回头翻记录时不用猜「这张是拿什么改的」：

<p align="center">
  <img src="./resources/图生图.png" alt="图生图：卡片同时显示参考图与产出图，以及复制/打开目录/重新生成与本次花费" width="720">
</p>

<p align="center">
  <img src="./resources/文生视频.png" alt="文生视频：完成后内联播放，卡片标注模型与花费" width="900">
</p>

同样，给一张图当首帧就是**图生视频**——让一张静态图动起来：

<p align="center">
  <img src="./resources/图生视频.png" alt="图生视频：以一张图作首帧生成 5 秒视频，卡片显示参考图、内联播放器与本次花费" width="720">
</p>

视频走的是异步任务：提交后可以随时**取消**（取消是真的少花钱，不是只把界面关掉），应用重启后已经提交出去的任务会继续把结果收回来——已经付过费的任务不会因为你重启就白花。

一次要多张**互相独立**的图也可以（上限 9 张）。有的模型的接口一次只回一张，这种情况下应用会自动多发几次凑够张数，而不是把这个能力藏起来；中途失败就停下并把已经出好的交给你。

<p align="center">
  <img src="./resources/文生多图.png" alt="一次生成 4 张互相独立的图片，花费按张数累计" width="720">
</p>

<p align="center">
  <img src="./resources/文生连环图图.png" alt="用提示词直接要求四格连环画，模型在一张图内完成排版" width="640">
</p>

> 上图是另一件事：提示词直接要求「四格连环画」，模型**在一张图里**排好四格。它和「一次要 4 张独立图片」是两种不同的东西，别混。

几个容易被忽略的点：

- **专家也能用**。图片/视频生成是内置 MCP 工具，助手和行业专家可以自己调用它出图出片，不必你手动切模式。
- **网页端可以发起**。用手机或另一台电脑打开 WebUI，同样可以发起生成、取消任务、看到进度与花费。⚠️ 但生成出来的**图和视频目前只在桌面端能看**——网页端的预览还没接通（跟踪中），要看结果请回到桌面端，或直接打开工作目录里的文件。
- **生成物落在你选的工作目录**，和这个会话的其他产物放在一起，卡片上的「打开所在目录」直接带你过去。
- **模型是你声明的**，不是我们写死的白名单。在模型设置里把某个模型标成「图片模型」或「视频模型」，它就会出现在生成模式的可选项里——不用等我们把它加进内置目录。

#### 定时任务

把重复的日报、巡检、情报汇总交给 Cron：指定执行助手（可以是任意官方助手或行业专家）、执行指令与频率即可。支持**新建会话**（每次干净上下文，适合日报巡检）与**持续会话**（沿用上下文，适合长期跟进）两种模式，并可开启「队列保护」避免上一次还在跑就被新触发打断：

<p align="center">
  <img src="./resources/定时任务.png" alt="创建定时任务：执行助手 + 执行模式 + 频率 + 队列保护" width="480">
</p>

#### MCP 工具

标准 MCP 协议接入外部工具与数据源，随包内置浏览器自动化（`chrome-devtools`）、团队检索（`team-search`）、PDF 导出（`one-export-pdf`）与行情金融数据（`ftshare`，覆盖 A 股 / 港股 / 美股行情、龙虎榜、财报三表、宏观与财经日历等 170+ 工具）等默认连接，也可自行添加任意 MCP Server。连接测试会**逐个工具**校验 schema 合法性，只隔离有问题的那一个工具而不牵连整个 Server：

<p align="center">
  <img src="./resources/MCP工具.png" alt="MCP 工具配置：内置默认连接 + 逐工具 schema 校验" width="900">
</p>

> MCP 配置读写与用户自己的 Claude Code / Codex 安装**完全隔离**——在本应用里装删 MCP 不会改到你系统里的 `~/.claude.json` 或 `~/.codex/config.toml`。

### 😊 助手、专家与个性化

开箱即用的角色库，加上让 Agent 越用越懂你的细节：

#### 内置引擎、官方助手与专家市场

自带完整 Agent 引擎（品牌名 **1ONE CLI**，底层 `dream-engine`），无需单独安装 CLI；粘贴任意模型 API Key 即可开聊。「助手与专家」页把可直接上岗的角色分成三档，全部配好技能与工具，启用后即可用于对话、开团与定时任务：

| 分档         |  数量   | 说明                                                                                                           |
| ------------ | :-----: | -------------------------------------------------------------------------------------------------------------- |
| **我的助手** |  自建   | 一键复制官方助手改造，或自己组合 Agent + 技能 + 规则从零创建                                                   |
| **官方助手** | **22**  | Word / PPT / Excel / 可填表单 / 数据仪表盘 / 财务建模 / 学术论文 / 3D 游戏生成 / 故事角色扮演等                |
| **专家市场** | **252** | 覆盖云运维、金融投研、法务、销售、设计、游戏开发、公益、医疗合规等各行业岗位，带真实中文名与头像，一键添加即用 |

<p align="center">
  <img src="./resources/专家市场.png" alt="助手与专家：我的助手 / 官方助手 22 / 专家市场 252，一键添加即用" width="900">
</p>

252 位专家随安装包一起分发（人设编译期打进后端二进制），**不联网、不额外下载**，全新装机也能看到完整目录；搜索时会自动合并「已安装」与「市场目录」，点未安装的条目即自动安装并选中。

装进「我的助手」后就是一个可直接开聊的专家，标题栏会显示当前对话绑定的是哪位专家，会话里同样可以用上第三方 MCP 工具——左边云资源巡检专家接入腾讯云 CloudQ 五维巡检，右边股票专家实时拉取行情数据做估值分析：

<table>
  <tr>
    <td width="50%"><img src="./resources/专家对话.png" alt="云资源巡检专家：标题栏显示当前绑定的专家身份，桥接模型徽标同步可见"></td>
    <td width="50%"><img src="./resources/股票专家咨询.png" alt="股票专家：接入实时行情 MCP 做估值筛选与横向对比"></td>
  </tr>
</table>

每个助手背后是可复用的技能库——20+ 内置技能覆盖社交招聘发帖（小红书 / X）、故事角色扮演、微信文件回传、OpenClaw 部署、PDF 处理、Office 文档（Word 表单 / Excel / PPT）等场景；也支持导入自定义技能（技能目录、父目录或 zip，单文件 50 MB、单技能 200 MB，同名导入覆盖）：

<p align="center">
  <img src="./resources/内置技能.png" alt="内置技能库" width="900">
</p>
<p align="center">
  <img src="./resources/skills技能.png" alt="技能中心：内置技能 + 自定义导入规则" width="900">
</p>

#### 记忆管理

三层记忆架构——自动记忆（`MEMORY.md`）、全局 `CLAUDE.md`、项目 `CLAUDE.md`——与你在 Claude Code 里使用的仓库根目录自动对齐，跨会话沉淀项目上下文与团队协作角色定位，AI 越用越懂你的项目：

<p align="center">
  <img src="./resources/记忆.png" alt="三层记忆架构：自动记忆 / 全局 / 项目 CLAUDE.md" width="900">
</p>

#### 预览面板

PDF、Word、Excel、PPT、代码、Markdown、图片、HTML、Diff 等 **10+ 格式** 在应用内直接预览，无需来回切换软件。

#### 多语言与主题

简体中文、繁体中文、英语、日语、韩语、法语、德语、西班牙语、葡萄牙语（巴西）、俄语、土耳其语、乌克兰语、波斯语，共 13 种语言随时切换，方便跨地区团队统一使用同一套工作台；界面同时支持浅色 / 深色主题与多套主题色：

<p align="center">
  <img src="./resources/多语言.png" alt="语言切换菜单：13 种语言" width="720">
</p>

---

## 企业版设计

企业版不是另起一套产品，而是在**同一套个人版 UI** 上叠加的治理层，模型是「**个人 ⊂ 项目组 ⊂ 企业**」三层，每一层都按**数据作用域**划清边界：

| 层级       | 谁能建                     | 管什么                                                                      |
| ---------- | -------------------------- | --------------------------------------------------------------------------- |
| **个人**   | 任何人，零配置             | 自己的会话、模型、助手、技能——单机可用，数据不出本机                        |
| **项目组** | 局域网内任何人，邀请码加入 | 团队成员与角色、共享技能 / MCP / 知识库 / 流水线、组织架构、审计日志        |
| **企业**   | 管理员显式设立 + SSO 接入  | 跨项目组治理、企业认证（SSO）、订阅与席位、授权许可、备份恢复、模型成本管控 |

对应后端 [dream-core](https://github.com/gaogg521/dream-core) 的 `one-org` / `one-enterprise` / `one-employee` / `one-devops` / `one-billing` / `one-platform` / `one-sso` 系列 crate。**个人单机版零影响**——上述能力全部由管理员显式配置，默认关闭且有测试锁死。

### 🗂️ 项目组 — 局域网内开箱即用的协作底座

无需实名、无需公网，局域网内创建项目组后即可用邀请码拉人。同一时间只有一台机器作为服务器托管数据，其余自动作为客户端连接，随时可切换角色（切换前有二次确认，服务器地址带历史记录）：

<p align="center">
  <img src="./resources/项目组.png" alt="项目组：部署模式切换 + 6 个页签 + 操作/Agent 双审计" width="900">
</p>

页签按数据作用域重新收敛为 **概览 / 成员 / 邀请码 / 组织架构 / 审计日志 / 运行时与集成** 六项（此前 13 个页签会把表格挤出可视区），旧的深链保留别名映射不会失效：

<p align="center">
  <img src="./resources/项目组2.png" alt="项目组概览：管理后台地址、角色、成员数" width="900">
</p>

点「进入项目组管理后台」是完整的**研发智能工作台**——团队技能、团队 MCP 工具、团队知识库文档、团队流水线四项统计一眼可见，下面依次是协作看板、数字员工、流水线编排、团队知识库、版本规划、测试计划、运行时节点，以及效能洞察 / 制品仓库 / 代码库（即将推出）：

<p align="center">
  <img src="./resources/项目组总后台.png" alt="项目组管理后台：研发智能工作台 + 组织管理与平台配置" width="900">
</p>

### 🏢 企业 — 组织与安全治理

企业管理员在项目组之上正式设立企业身份、接入 SSO，做租户隔离与全局治理。企业页同样是部署模式 + 概览 / 成员 / 邀请码 / 审计日志 / 运行时节点 / SSO 设置：

<p align="center">
  <img src="./resources/企业模式.png" alt="企业页：部署模式（服务器/客户端）+ 企业概览与 SSO 设置" width="900">
</p>

企业管理后台是「信息安全中心」，结构与项目组后台一致但作用域是整个企业：

<p align="center">
  <img src="./resources/企业版后台.png" alt="企业管理后台：信息安全中心 + 研发智能工作台全景" width="900">
</p>

- **组织与安全治理**：登录鉴权、成员与角色管理、**移除成员**（离职即时失效会话并归因到操作者）、租户隔离、操作与 Agent 双维度审计日志。
- **数字员工**：可绑定专家人设 + 运行后端 + 具体模型，按计划自动执行并留下运行历史。
- **团队知识库**：**全离线**语义 + 词法混合检索（BM25 与向量 RRF 融合，支持中文分词），并以 MCP 工具形式接进 Agent，三种运行后端通吃，权限自动复用 ACL。
- **团队技能与 MCP 下发**：管理员统一下发，成员开箱即用。
- **内容审计与 DLP**：发送前策略引擎拦截敏感内容，拒绝理由结构化（点名命中的规则与模型，而非一句模糊的 "Forbidden"），13 语言全覆盖。
- **通讯录同步**：对接飞书 / 钉钉通讯录，自动映射部门与人员、检测离职并即时收回权限与失效会话，不必手工维护成员名单。
- **部门预算与成本分摊**：在企业级成本上限之下再加一道**按部门**的预算闸门；成本按调岗时点的部门归属结算，历史支出不会因为后来调岗而被倒灌重算。
- **生成物账本**：图片 / 视频等媒体生成物逐条计入企业账本，与聊天用量统一可追溯，随整库备份一起导出。
- **细粒度资源权限**：读写权限按**项目组 + 角色**双维度收敛，不是「加入项目组就能看见全部资源」。
- **备份与恢复**：企业数据整库导出 / 导入，往返幂等且导出时自动脱敏密钥字段（如飞书 `appSecret` 被剥离而 `appId` / `redirectUri` 保留）。仅**系统管理员**可操作。

登录与权限视角、超级管理员后台：

<table>
  <tr>
    <td width="50%"><img src="./resources/企业版后台登录.png" alt="企业版登录与权限"></td>
    <td width="50%"><img src="./resources/企业团队版的超级管理员后台.png" alt="超级管理员后台"></td>
  </tr>
</table>

研发智能工作台各模块的实际入口——CCI 流水线、MCP 工具连接、RAG 离线语义知识库、CCode 仓库绑定、制品仓库、代码库、效能洞察：

<p align="center">
  <img src="./resources/团队版后台功能预览.png" alt="企业控制台：研发智能工作台模块入口" width="900">
</p>

### 🔐 企业认证（SSO）

支持飞书 / 钉钉 / 企业微信 / LDAP，以及标准 **OIDC**——一次接通 Okta、Azure AD、Google Workspace 等国际主流 IdP。同公司 SSO 登录可自动入伙，密钥字段出于安全永不回显：

<p align="center">
  <img src="./resources/企业认证2.png" alt="企业管理后台：企业认证 SSO 配置（飞书/钉钉/OIDC）" width="900">
</p>

### 💳 授权许可、订阅席位与模型成本管控

企业管理后台的「订阅与用量」把商业化与成本风险一并收口：

<p align="center">
  <img src="./resources/企业版后台2.png" alt="订阅与用量：授权许可激活、三档订阅与席位、模型管控、用量看板" width="900">
</p>

- **授权许可**：粘贴厂商签发的授权码（`ONEWORK-…`）**离线激活**，无需回连任何许可服务器；签名校验是唯一的升档路径——管理员自己改不了档位。
- **订阅与席位**：`free` / `team` / `enterprise` 三档，功能按档位门控（`sso`、`audit_log`、`team_resource_scope`、`admin_only_visibility`、`fine_grained_rbac`），席位用量实时可见；手动下拉只能**下调**档位。
- **模型管控**：设置近 30 天**成本上限**（超限后成员无法再发起对话，直到管理员上调）与**模型 allowlist**（留空=全部允许），从源头卡住失控的模型开销。
- **用量看板**：近 30 天用量与成本趋势。

### 📋 需求协作看板与超级助手

需求协作看板（Issues）支持产品需求与团队任务双视图，看板拖拽流转，并可发起 **AI Agent 需求一键拆单**——描述一句宏观业务需求，AI 自动拆解出 Feature/User Story 卡片分别落入对应看板：

<table>
  <tr>
    <td width="50%"><img src="./resources/团队需求面板.png" alt="新建 Issue"></td>
    <td width="50%"><img src="./resources/团队需求面板2.png" alt="Issues 看板视图"></td>
  </tr>
</table>
<p align="center">
  <img src="./resources/企业版后台登录上帝视角.png" alt="CTeam 敏捷协同看板 + AI 需求一键拆单" width="900">
</p>

「超级助手」把 Issues 与 Agent 执行直接打通：从 Issues 选中任务，一键发起处理，在调度视图里管理多智能体并行执行、查看运行时进度；同时统一管理团队员工、协作看板与协作资源（里程碑、测试计划、流水线）。**数字员工可以绑定任意专家人设 + 运行后端 + 具体模型**——创建时直接从 22 个官方助手与 252 位行业专家里挑一个当他的"专业身份"，未启用的会自动启用、未安装的会自动安装：

<table>
  <tr>
    <td width="50%"><img src="./resources/团队版的超级助手.png" alt="超级助手：Issue 一键交给 Agent 处理"></td>
    <td width="50%"><img src="./resources/超级助手.png" alt="超级助手：协作资源（里程碑/测试计划/流水线）"></td>
  </tr>
</table>

协作任务看板：

<p align="center">
  <img src="./resources/任务看板.png" alt="协作任务看板" width="720">
</p>

---

## 架构（v2）

桌面客户端（Electron 渲染进程）通过 HTTP + WebSocket **直连** `dreamcore`；远程 WebUI 走的是另一条路径——独立的 Node 静态服务器托管前端构建产物，并把 `/api/*`、`/ws`、`/login`、`/logout` 反向代理到同一个 `dreamcore`，两条路径最终落在同一套后端服务与数据库上：

```mermaid
flowchart TB
  Desktop["桌面客户端(One Work)<br/>Electron + React<br/>渲染进程"]
  WebHost["WebUI 静态服务器<br/>Node（@dream/web-host）<br/>托管 SPA + 反代 /api /ws /login"]
  Browser["浏览器 / 手机<br/>远程访问 One Work"]
  Core["dream-core · dreamcore<br/>Rust 本地服务"]
  DB["SQLite<br/>会话 / 助手 / 消息 / 企业"]
  Agents["Agent 运行时<br/>1ONE CLI · ACP 子进程 · Team"]
  Channels["渠道 / Cron / MCP"]

  Desktop -->|HTTP + WebSocket，直连| Core
  Browser --> WebHost
  WebHost -->|反向代理| Core
  Core --> DB & Agents & Channels
```

| 层级       | 技术                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------- |
| 客户端 UI  | Electron 37 + React 19 + TypeScript + Arco Design                                                         |
| WebUI 网关 | Node 静态服务器（`@dream/web-host`），托管构建产物 + 反向代理到 dreamcore                                 |
| 本地后端   | **dream-core**（Rust，`dreamcore` 二进制，30+ 领域 crate）                                                   |
| 企业扩展   | `one-org` · `one-enterprise` · `one-sso` · `one-billing` · `one-employee` · `one-devops` · `one-platform` |
| 存储       | SQLite（`%APPDATA%` 下按环境隔离；知识库用内置 FTS5 + 向量做混合检索）                                    |
| 协议       | ACP 多 Agent、MCP、Extension SDK                                                                          |

后端也可完全脱离 Electron 独立部署——Docker 镜像或 tarball 直接跑在团队自建的常驻服务器上，一个进程对外提供完整 API，桌面客户端与 WebUI 都能以「客户端模式」连过去，不需要每个人都装一遍。

---

## 3 分钟上手

### 下载安装（用户）

[Releases](https://github.com/gaogg521/dream-ui/releases) → Windows `One-Work-*-win-x64.exe` / macOS `.dmg` / Linux `.deb`。Windows / Linux 双击安装即可。

<details>
<summary>🍎 macOS 首次打开被 Gatekeeper 拦截？点此展开解决方法</summary>

当前 `.dmg` 未经 Apple 签名与公证，首次打开会被 Gatekeeper 拦截。典型弹窗是**「未打开 "One Work"——Apple 无法验证...是否包含恶意软件」**（只有「完成 / 移到废纸篓」两个按钮），**不要**点「移到废纸篓」，按下面任一方法放行即可。

先双击 `.dmg`，把 **One Work** 拖入 **Applications**，然后：

**方法 A · 终端命令（最稳，所有 macOS 版本通用，推荐）**

打开「终端」，执行下面这条命令抹掉隔离标记后再双击打开即可：

```bash
xattr -cr "/Applications/One Work.app"
```

> 若提示找不到路径（安装包 `.app` 实际名称可能不同），直接在命令里输 `xattr -cr `（末尾留一个空格），再把「应用程序」里的 App 图标拖进终端窗口自动补全路径，回车即可。

**方法 B · 系统设置放行（纯点鼠标）**

- **macOS 15 (Sequoia) 及更高**：先双击 App 触发一次上面的拦截弹窗，点「完成」；再打开 **系统设置 → 隐私与安全性**，滚到底部「安全性」区，会看到一行"已阻止 One Work..."，点右侧 **「仍要打开」** → 再确认一次并输入密码即可。（Sequoia 已移除右键打开入口，必须走这里）
- **macOS 14 (Sonoma) 及更早**：在「应用程序」里右键（或按住 Control 点击）**One Work** → 选 **打开** → 弹窗里再次点 **打开**。

> 两种方法本质相同：都是告诉系统信任这个来源。仅适用于你自己分发给已知用户的场景。彻底免弹窗需为安装包配置 Apple 开发者证书做代码签名 + 公证。

</details>

### 个人用户

1. 打开 **会话** → 选择助手（推荐 **1ONE CLI** 或本机已安装的 Claude Code）
2. **设置 → 模型** → 配置 API Key
3. 想直接用行业专家：**助手与专家 → 专家市场** → 搜索并「添加到我的助手」
4. 想让 Codex CLI / Claude Code 走自己的模型：**设置 → Codex 桥接 / Claude 桥接**
5. 需要远程：**设置 → WebUI** 开启服务（手机扫码登录）
6. 需要定时任务：**定时任务** 页或对话里让 Agent 创建 Cron

### 开发者（双仓库）

```powershell
# 推荐工作区布局
# D:\dream\dream-ui    ← 本仓库
# D:\dream\dream-core  ← 后端

git clone https://github.com/gaogg521/dream-ui.git
git clone https://github.com/gaogg521/dream-core.git

cd dream-ui && bun install
# 只改前端
bun run dev

# 改了 dream-core 后必须先编译并内嵌后端，详见：
# docs/guides/fork-dev-onboarding.zh-CN.md
```

完整说明：[开发者上手指南](./docs/guides/fork-dev-onboarding.zh-CN.md)

---

## 打包发行版

```powershell
cd dream-ui
$env:DREAM_BACKEND_LOCAL_PATH = '..\dream-core\target\release\dreamcore.exe'  # 先 cargo build
bun run dist:win    # 或 dist:mac / dist:linux
```

产物：`out/One-Work-<version>-win-x64.exe`

---

## 文档索引

| 文档                                                                             | 说明                      |
| -------------------------------------------------------------------------------- | ------------------------- |
| [fork-dev-onboarding.zh-CN.md](./docs/guides/fork-dev-onboarding.zh-CN.md)       | 克隆、dev、打包、Release  |
| [ai-handoff-conventions.zh-CN.md](./docs/guides/ai-handoff-conventions.zh-CN.md) | 改完必写文档 + 前后端加载 |
| [contributing/development.md](./docs/contributing/development.md)                | 通用开发环境（上游参考）  |
| [AGENTS.md](./AGENTS.md)                                                         | 代码规范、lint、测试      |

---

## FAQ

**产品定位**

<details>
<summary><strong>和旧版 1ONE ClaudeCode（单仓）什么关系？</strong></summary>

v2 用 **dream-ui + dream-core** 双仓库重写本地后端；旧仓 <code>D:\1one-command</code> 仅维护遗留问题，新功能在 <strong>本仓库 + dream-core</strong> 开发。

</details>

<details>
<summary><strong>和 Cursor / Copilot 什么关系？</strong></summary>

One Work 是指挥台：可挂载 Cursor Agent、Claude Code 等 CLI，并统一管理会话、渠道、定时任务与企业协同；不替代 IDE，而是 orchestrate 整支 AI 队伍。

</details>

<details>
<summary><strong>Codex / Claude 桥接是什么原理？会不会绕过官方限制被封号？</strong></summary>

桥接是在本机起一个协议兼容的本地端点，Codex CLI / Claude Code 官方客户端把请求发到这个本地端点，再由它转发给你自己配置的模型服务商——本质是**换掉模型来源**，不涉及破解、逆向或伪造官方账号鉴权，也不代理官方 API 请求。关闭开关即可随时切回官方账号原有行为。

</details>

**功能细节**

<details>
<summary><strong>252 位专家需要联网下载吗？</strong></summary>

不需要。全部人设在编译期打进后端二进制，随安装包分发，全新装机、断网环境都能看到完整目录并直接安装使用。

</details>

<details>
<summary><strong>企业版要连你们的服务器吗？授权怎么发？</strong></summary>

不用。企业数据托管在你自己局域网内的那台"服务器角色"机器上，**授权许可是离线激活**——粘贴厂商签发的授权码即可完成升档，全程不回连任何许可服务器。个人版与项目组不需要授权码。

</details>

<details>
<summary><strong>个人单机用户会被企业版功能干扰吗？</strong></summary>

不会。SSO、席位计费、模型管控、审计等能力全部需要管理员显式配置，默认关闭；不建项目组、不设企业时行为与纯个人版完全一致（代码里有锁死测试保证这条红线）。

</details>

**疑难排查**

<details>
<summary><strong>为什么助手页看不到 Cursor？</strong></summary>

需要本机安装 <strong>Cursor Agent CLI</strong>（命令 <code>agent</code>），并在 <strong>设置 → Agent → 扫描本地 Agent</strong> 后才会显示。在 Cursor IDE 里聊天 ≠ 已安装 CLI。

</details>

<details>
<summary><strong>LAN 打开 WebUI 样式异常？</strong></summary>

WebUI 走构建产物 <code>out/renderer/</code>，改前端后需重新 <code>bun run dist:win</code> 或 dev 构建，浏览器 <strong>Ctrl+F5</strong> 强刷。

</details>

---

## 参与贡献

- 🐛 [Issue](https://github.com/gaogg521/dream-ui/issues)
- 📦 [Releases](https://github.com/gaogg521/dream-ui/releases)
- 🌐 [官网](https://work.1oneclaw.com/)
- 🔧 [后端仓库 dream-core](https://github.com/gaogg521/dream-core)

### 联系作者

有问题、建议或合作意向，欢迎扫码加微信直接交流：

<p align="center">
  <img src="./resources/作者微信.png" alt="作者微信二维码" width="220">
</p>

---

## 致谢

**One Work** 基于开源项目 [AionUi](https://github.com/iOfficeAI/AionUi)（配套后端 [AionCore](https://github.com/iOfficeAI/AionCore)）二次开发而来。感谢 iOfficeAI 团队与所有上游贡献者的开源工作，为本项目打下了坚实的基础。

<p align="center">
  <sub>Built by <a href="https://github.com/gaogg521">gaogg521</a> · Apache-2.0</sub>
</p>
