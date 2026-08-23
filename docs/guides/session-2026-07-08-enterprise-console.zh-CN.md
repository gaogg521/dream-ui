# 2026-07-08：企业部署模式迁移 + 企业管理后台控制台首页

> 读者：后续接手的 AI / 开发者。仓库 `D:\aionui-m0\AionUi`(one-main)。**纯前端改动,未 commit、未打包。**

## 背景（用户两个需求）

1. 「企业部署模式」(本机作为服务器/客户端切换)原来在**远程连接 → WebUI** 页里,应移到**企业**功能里,且开关跟 WebUI 无关。
2. 本机切「作为服务器」时,要能看到**企业管理员后台**入口,进去配置只有超管才有的功能。

## 需求 1 — 部署模式卡片迁移（已 dev 实测通过 ✅）

- `components/settings/SettingsModal/contents/WebuiModalContent.tsx`：删除 `EnterpriseDeploymentModeCard` 的 import + 渲染(保留 `useDeploymentRole`/`hideLocalAdmin`,WebUI 页仍需据客户端模式隐藏本地登录信息)。
- `pages/enterprise/index.tsx`：企业页顶部固定区渲染 `<EnterpriseDeploymentModeCard />`(组件原文件位置不动,只改渲染位置)。
- 组件本身只用 `useDeploymentRole`+`useOrgContext`+`configService`,**不读 WebUI 状态**,迁移后彻底解耦。
- **实测**:dev 里侧栏「企业」→ 顶部即为部署模式卡片,远程连接页不再有。

## 需求 2 — 企业管理后台控制台首页（代码完成,tsc/lint 过,动态自测进行中）

### 关键澄清（踩坑,别再犯）

- 第一版我误把 `http://127.0.0.1:25809`(本地 WebUI 聊天页)当「企业管理后台」放进 `OverviewTab`——**错的**。已撤销,`OverviewTab.tsx` 恢复净零。
- 真正的「企业管理后台」是老架构 `D:\1one-command` 的 `pages/enterprise/EnterpriseHome.tsx`(深蓝头部 + KPI 卡 + 宫格门户)+ 整套 `EnterpriseLayout`/`EnterpriseNavSidebar`/`enterpriseNav`/`enterpriseRoutes` + `pages/admin/*`(十几个子页:CMeas 效能洞察 / CPack 制品 / CCode 代码库 / 流水线 / RAG / MCP / Skills / 用户 / 团队 / 认证 / 版本规划 / Issues 看板 / 测试 / 运行时)。
- **fork 没迁这套完整后台**(当初「精简形态」决策)。但 fork 的**超级助手页 `/super-assistant` 已聚合大部分研发能力**:Issues看板/数字员工/流水线/RAG/MCP/Skills/版本规划/测试/运行时(tab + registries section);企业治理(成员/邀请码/审计/SSO)在企业页。**fork 完全没有的只剩:效能洞察 DORA / 制品仓库 / 代码库。**

### 用户确认的方案：独立门户 + 精准跳转

新建**独立路由 `/enterprise/console`** 控制台首页,把散落功能聚合成图3那样的宫格门户,已有功能精准深链,缺的标「即将推出」。

| 文件                                                | 改动                                                                                                                                                                                                                       |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pages/enterprise/EnterpriseConsole.tsx` 🆕         | 深蓝头部(租户名 `useOrgContext` + 返回主工作台快捷键) + 4 KPI 卡(MCP 真实数 `mcpService.listServers`,其余占位「数据接入中」) + 研发智能工作台宫格 + 组织管理宫格。宫格配置数组驱动,已有→`navigate(path)`,缺失→`comingSoon` |
| `components/layout/Router.tsx`                      | lazy import + `<Route path='/enterprise/console'>`                                                                                                                                                                         |
| `pages/enterprise/index.tsx`                        | 服务器模式+管理员(`showAdminTabs`)时顶部「进入企业管理后台」按钮跳 console;读 `?tab=` 初始化 activeTab                                                                                                                     |
| `pages/superAssistant/index.tsx`                    | 读 `?tab=` 初始化 activeTab(6 tab:overview/agents/issues/registries/runtimes/settings)                                                                                                                                     |
| `pages/superAssistant/registries/RegistriesTab.tsx` | 各 section 包 `id="registry-section-<x>"`,读 `?section=` 后 `scrollIntoView`(120ms 兜异步高度)                                                                                                                             |
| `locales/{zh-CN,en-US}/common.json`                 | 补 `enterpriseConsole.*` 全套 + `enterprise.openConsole`                                                                                                                                                                   |

**宫格深链映射**:协作看板→`/super-assistant?tab=issues`;数字员工→`?tab=agents`;流水线/RAG/版本规划/测试→`?tab=registries&section=<x>`;运行时→`?tab=runtimes`;用户/邀请码/认证/审计→`/settings/enterprise?tab=<x>`;技能→`/skills`;MCP→`/mcp`;记忆→`/memory`。效能洞察/制品仓库/代码库/企业设置/团队与组织/使用统计→「即将推出」。

## 策略分发（用户点名的核心,fork/老架构都没有,待做）

**定义(用户 2026-07-08 澄清)**:超级管理员在企业后台给**接入企业的成员机**下发 skills、MCP 等工具。即 admin→成员机的工具分发/管控。fork 和老架构前端都没有叫这名字的现成模块,是待补核心能力(控制台宫格暂无此卡)。

## 用户方针（必须遵守）

- 企业管理重构是**大工程**,每做完一块**必须自己桌面端实测**,不甩用户。
- 重点自测两块:**策略分发** + **用户登录**(SSO/邀请码/账号)。
- 老项目企业管理这两块**有 BUG,正是重构原因**——参考老架构时警惕,别照抄逻辑。

## 验证 / 加载

- 纯前端:`bunx tsc --noEmit` 过、`oxlint` 5 文件 0/0、两个 common.json 合法、`i18n:types` unchanged。
- 改动仅 `packages/desktop/src/renderer/**` → `frontend-dev.ps1` 热更新即可,**不用重编后端**。
- dev 单实例锁:安装版在跑时 dev 会 exit code 5(`Another instance`),需先关安装版。
- computer-use 授权:dev 窗口是 `electron.exe`(路径 `d:\aionui-m0\...\electron.exe`),不是安装版 `1onecode.exe`——授权时传 basename `electron.exe`。

## 自测进度 / 下一步

- ✅ 需求 1 dev 实测通过（企业页顶部部署卡片，已复验仍在）。
- ✅ 需求 2 dev 实测通过（测试企业「欢乐盾」server 模式 + 系统管理员进 `/enterprise/console`，宫格+深链齐活）。
- ✅ **内容模型纠正（2026-07-08 第二十三轮续，本轮核心）**：用户指出控制台原先展示的是**本机用户自己的东西**（MCP KPI 读本机 `mcpService.listServers`、「我的技能/记忆/MCP」卡跳本机 `/skills` `/mcp` `/memory`），语义错误。企业入口应只反映**管理员定义的团队内容**。已改：
  - KPI 全改团队维度（`oneDevops.listSkills/listMcpRegistry/listRagDocuments/listPipelines`）——实测团队技能/MCP/知识库=0（管理员没加，不再拿本机数充数）、团队流水线=1（真实团队数据，证明读的是租户级 `oneDevops`）。
  - 三张本机卡改团队维度：团队技能→`registries&section=skills`、团队 MCP 工具→`registries&section=mcp`、团队记忆→「即将推出」（无团队 memory 后端）。深链实测跳团队 Skills 注册表，非本机 `/skills`。
  - 改动文件：`EnterpriseConsole.tsx` + `locales/{zh-CN,en-US}/common.json`。tsc/oxlint 全过。
  - **整体设计文档**（管理员定义→下发落地→成员机并集的完整模型 + 三阶段 + 用户四条硬规则）见 `docs/guides/enterprise-console-content-model-design.zh-CN.md`。
- ⏳ 待提交（**提交等用户确认**）：只 `git add` 本轮改动文件（**绝不 `git add -A`**，fork 有他人未提交改动）→ 中文 commit 无 AI 签名 → bump 版本 + `dist:win`(不删旧 .exe)。
- 后续大工程：阶段 B **下发落地**（拉取-物化到本机-离线可用+绿标「团队」+受控删除同步）+ 阶段 C 运行时消费 + 核查**用户登录**链路。详见内容模型设计文档 §5。

## 后续待办(下一个会话接手,按优先级)

1. **⚠️ WebUI 浏览器后台可访问(用户 2026-07-08 新方向,安全考虑)**:企业「组织管理与平台配置」出于安全**必须能在 WebUI 浏览器后台配置**,不能只在桌面 app。**现状**:控制台 `/enterprise/console` + 企业入口在**桌面 app 已可见,但浏览器 WebUI 里看不见**。需查:①WebUI 模式(`!window.electronAPI`)下侧栏「企业」入口是否渲染(`components/layout/Sider/**` + `SiderEnterpriseEntry`);②`/enterprise/console` 路由与 `EnterpriseConsole` 组件在 web 是否可达/无 desktop-only gate;③企业页各 tab 在 web 的显示。目标:超管用浏览器访问 WebUI(`http://IP:25809`)登录后能进企业管理后台配置组织/用户/认证等。
2. **策略分发 / 阶段 B 下发落地**(超管→成员机下发 skills/MCP,拉取-物化本机-离线可用+绿标+受控删除同步;fork/老架构前端都无此模块,待新建)。详见 `enterprise-console-content-model-design.zh-CN.md` §5 阶段 B。
3. **用户登录**链路核查(SSO/邀请码/账号;老架构有 BUG,别照抄)。
4. ✅ 控制台动态自测收尾已完成(见「自测进度」需求2 + 内容模型纠正)。
