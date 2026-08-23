# 企业控制台内容模型设计：管理员定义 → 下发 → 成员机并集

> 作者：接手 AI（2026-07-08 第二十三轮续）。仓库 `D:\aionui-m0\AionUi`(one-main)。
> 缘起：用户指出企业控制台目前展示的是「本机用户自己的东西」（如本地 MCP 数），语义错误。
> 企业入口应只反映**企业团队管理员定义/额外增加**的内容；成员机同步后看到的是**自己 ∪ 团队**，
> 管理员没加则成员看到的就只是自己的。本文把整条链路的数据模型、已具备能力、缺口与分阶段方案定清，
> 供用户拍板后再动手。**先设计后编码，避免返工。**

## 1. 纠正后的核心模型

```
┌─────────────────────────┐        ┌─────────────────────────────┐
│  企业控制台 / 后台        │  定义   │  团队层 (租户隔离, 存服务端)   │
│  (管理员, server 模式)   │ ─────▶ │  oneDevops.* 注册表           │
└─────────────────────────┘        │  skills / mcp-registry / rag  │
                                    │  pipelines / milestones ...   │
                                    └──────────────┬──────────────┘
                                                   │ 传输层自动下发
                                                   │ (client 模式 getBaseUrl→远端)
                                                   ▼
┌───────────────────────────────────────────────────────────────┐
│  成员机 (client 模式)                                            │
│    最终呈现 = 本机自己的 ∪ 团队下发的                             │
│    · 本机层: /api/skills/* (FS 技能) + /api/mcp/* (本机 MCP)     │
│    · 团队层: oneDevops.listSkills / listMcpRegistry (=服务器的)  │
│    管理员没加 → 团队层为空 → 成员只看到自己的                     │
└───────────────────────────────────────────────────────────────┘
```

**一句话**：控制台是管理员的「团队内容编排台」；成员机是「本机 ∪ 团队」的消费端。两者的团队层是**同一份** `oneDevops` 租户注册表，只是访问角色不同。

## 2. 三层数据源对照（均为已确认的真实 API）

| 维度                              | 本机层（个人，留在本机）                                                                            | 团队层（管理员定义，存服务端租户）                                                                       |
| --------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 技能                              | `/api/skills/*`（`listAvailableSkills` / `materializeSkillsForAgent` / `importSkill`，FS 技能文件） | `oneDevops.listSkills` `/api/one/devops/skills`（`SkillRegistryEntry`，含 `scope`/`teamId`/`createdBy`） |
| MCP                               | `mcpService.*` `/api/mcp/*`（本机 MCP server 配置）                                                 | `oneDevops.listMcpRegistry` `/api/one/devops/mcp-registry`（`McpRegistryEntry`，含 `scope`/`teamId`）    |
| 知识库 RAG                        | —（本机无对应）                                                                                     | `oneDevops.listRagDocuments` `/api/one/devops/rag/documents`                                             |
| 记忆                              | `/memory`（`~/.claude/projects/*/memory`，纯本机）                                                  | —（记忆是纯个人，不入团队层）                                                                            |
| 流水线 / 里程碑 / 测试计划 / 需求 | —（本机无）                                                                                         | `oneDevops.listPipelines` / `listMilestones` / `listTestPlans` / `requirementsTree`                      |
| 组织治理                          | —（本机无）                                                                                         | `oneOrg.*`（context/create/join）+ `oneAdmin.*`（users/invites/audit/sso）                               |

关键点：`SkillRegistryEntry` / `McpRegistryEntry` 带 `scope` + `teamId` 字段 → 天然是租户/团队级；`createdBy` 记录是哪个管理员加的。这正是「管理员额外定义」的载体。

## 3. 传输层机制——「下发」其实已实现（最重要的发现）

`packages/desktop/src/common/adapter/httpBridge.ts`：

- `getBaseUrl()`：**企业远程(client)模式 → 返回配置的远端服务器 URL（带 Bearer token）**；否则本地 `127.0.0.1:port`。
- `oneDevops.*` / `oneOrg.*` / `oneAdmin.*` 全走 `httpGet`/`httpPost`（= `getBaseUrl()`）→ **成员机在 client 模式下调 `listSkills`，读到的就是服务器上管理员定义的团队注册表**。
- `getLocalBaseUrl()` / `preferLocalBackend` / `httpGetLocal`：永远打本地 co-located 后端，注释明确「个人数据（数字员工、记忆）即便在远程模式也留本机」。

**结论**：团队内容的「下发」= 成员机 client 模式下 `oneDevops` 请求自动路由到服务器。**不需要单独造同步通道**。缺的是「消费端 UI 把团队层和本机层并起来展示」，以及「运行时把团队技能/MCP 真正注入 agent」。

## 4. 现状盘点：已具备 vs 缺口

**已具备**：

- 团队注册表后端（`oneDevops` skills/mcp/rag/pipelines…）+ 管理端 UI（`superAssistant/registries/*Section`）。
- client 模式传输层自动路由到服务器（团队内容对成员机可见的机制）。
- 控制台门户骨架（`EnterpriseConsole.tsx`）+ 深链 + 部署角色判定（`useDeploymentRole`）。

**缺口**：

- ❌ **控制台读错源**：MCP KPI 读本机 `mcpService.listServers`；「我的技能/记忆/团队 MCP」卡跳本机 `/skills` `/mcp` `/memory`。应全部改指团队层 `oneDevops.*`，纯本机项移出企业后台。
- ❌ **成员机并集 UI**：本机 `/skills`、`/mcp` 页面只显示本机自己的，没把团队下发（`oneDevops` 注册表）并进来标注「团队」。
- ❔ **运行时消费**：agent 实际执行时是否加载团队 `oneDevops` 技能/MCP（还是只加载本机 FS 技能）？需查后端 aioncore 的 skill/mcp 装配链路（本文档暂标未确认，进阶段 C 时先勘察后端）。

## 5. 分阶段方案

### 阶段 A（本轮，范围可控可提交）——控制台改对

只动**管理员编排台这一侧**，让它只反映团队(`oneDevops`)内容：

- KPI 卡改真实团队数：MCP→`listMcpRegistry`、RAG→`listRagDocuments`、流水线→`listPipelines`、技能→`listSkills`（现在流水线/RAG/仓库是 `--` 占位，MCP 是本机数）。
- 宫格：移除纯本机卡（「我的技能→/skills」「记忆管理→/memory」）；「团队 MCP 工具」「团队知识库」等改指向 `superAssistant?tab=registries&section=*`（管理端团队面）而非本机 `/mcp`。
- 空态：管理员没加时 KPI 显 0 / 宫格显「暂无，去添加」，不再拿本机数充数。
- 门槛：仅 `showAdminTabs`（server 模式 + org 管理员）可见（现状已是）。

### 阶段 B（下一轮）——下发落地 + 成员机并集呈现（用户 2026-07-08 强化）

**关键升级**：下发不是「远程实时读」，而是「**拉取-落地到本机-离线可用 + 受控删除同步**」。

用户四条硬规则：

1. **企业入口（控制台）里的 /skills、/mcp、/memory = 团队管理员下发的**，绝不是本机自己的。
2. **下发通过后合并进用户自己的 /skills、/mcp、/memory**，团队项加**绿色「团队」字体标识**（区分来源）。
3. **落地即本地持久化**：下发内容 sync 到本机存储后，**服务器挂了默认不影响使用**（离线可用）。→ 不能用 client 模式远程实时读实现，必须真正物化到本机。
4. **受控删除同步**：仅当**服务端通讯正常**且管理员在控制台删除某项时，客户端才**同步清除**对应团队项；服务器不可达时保留本地已下发内容。

实现要点：

- 成员机需一个 **team-sync 落地层**：定期/触发时拉 `oneDevops.listSkills`/`listMcpRegistry`（+ 未来 team-memory），物化到本机 skill FS / MCP 配置 / 记忆目录，并打 `origin=team` 标记。
- `/skills`、`/mcp`、`/memory` 页面读「本机 ∪ 已落地团队项」，团队项渲染绿色「团队」标签、只读（成员不可删/改，只能用）。
- 删除对账：sync 时对比服务器团队集与本地已落地团队集，**服务器可达**才移除服务器已删的项；不可达则保留（离线兜底）。
- 管理员没加 → 团队集为空 → 页面等同现状（只有自己的）。完全向后兼容。

> ⚠️ 记忆（/memory）目前**无团队后端**（`oneDevops` 只有 skills/mcp/rag，没有 memory）。team-memory 下发需先在 aioncore 加租户级 memory 注册表/接口，属阶段 B 的后端前置。

### 阶段 C（后续，需先勘察后端）——运行时真正消费

确认并打通 agent 执行时装配团队技能/MCP：读 aioncore skill/mcp 注入链路，若只认本机 FS 则需让团队注册表参与 materialize。**这是「策略分发」真正生效的一环**，工程最深，单独立项。

## 6. 阶段 A 具体改动（文件级，待用户确认后执行）

| 文件                                     | 改动                                                                                                                                                                                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pages/enterprise/EnterpriseConsole.tsx` | ① MCP KPI：`mcpService.listServers` → `oneDevops.listMcpRegistry`；② 新增 RAG/流水线/技能 KPI 走 `oneDevops.*`；③ FOUNDATION 宫格删 `skills→/skills`、`memory→/memory`、`mcp→/mcp` 三张纯本机卡（或改指 registries 团队面）；④ 空态文案 |
| `locales/{zh-CN,en-US}/common.json`      | 调整/新增 `enterpriseConsole.*`（删掉本机卡文案，补团队 KPI 文案 + 空态）                                                                                                                                                               |

验证：`bunx tsc --noEmit` + `oxlint` + `frontend-dev.ps1` 热更 → server 模式建测试企业 → 进 `/enterprise/console` 确认 KPI/宫格全是团队维度、无本机数据串入 → 截图。

## 7. 开放问题的最终决议（用户 2026-07-08 拍板）

1. **skills/mcp/memory 卡**：✅ **保留**，但语义改为「团队管理员下发的」，指向团队维度（registries 团队面），不再指本机 `/skills` `/mcp` `/memory`。（否决了「移除」方案。）
2. **KPI**：只留有真实团队数据源的（团队 MCP / RAG / 流水线 / 团队技能），「制品/代码库」等 fork 无后端的进宫格标「即将推出」。
3. **阶段顺序**：A 本轮 → B 下轮（含下发落地/绿标/删除同步）→ C 立项。
4. **团队记忆**：无后端 → 阶段 A 控制台里「团队记忆」卡标「即将推出」，后端补齐后再打通（阶段 B 前置）。

> 用户方针（必守）：企业管理是大工程，每块做完必桌面端自测，重点自测**策略分发 + 用户登录**；老架构这两块有 BUG，别照抄。
