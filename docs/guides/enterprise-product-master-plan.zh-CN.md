# 企业能力产品主规划（PM 视角逐模块完善方案）

> 2026-07-08 第二十三轮续。作者：接手 AI（PM 视角）。
> 目标：以老架构（`D:\1one-command`，Node/Electron 版）为**产品需求底稿**，把 fork（`D:\aionui-m0`，Rust AionCore 版）里被精简/未迁/做得不够好的企业能力，逐模块补成「做对做全」的形态。
> 铁律：老架构是**参考不是照抄**——它策略分发 + 登录两块有 BUG（用户明确），且最深的运行时消费它也没接。我们要做对的版本。

---

## 一、定位：两端架构（用户已拍板）

```
网页管理后台 (浏览器, 管理员权限登录)              桌面端 (成员的 app)
─────────────────────────────────              ────────────────────────
真正的"配置"都在这里:                             纯"消费"视图:
· 组织/用户/团队/邀请码/SSO/平台配置              · 我获得的团队工具(下发到本地,绿标"团队",离线可用)
· 定义要下发的团队 技能/MCP/知识库               · 派给我的协同任务(Issues 看板指派)
· 流水线/版本规划/制品/代码库/效能洞察            · 无任何配置按钮
        │ 下发(scope=team/org) + 落地            ▲
        └────────────────────────────────────────┘
```

**平台门控机制老架构已有**（`common/auth/enterpriseRoutes.ts` 的 `platformPolicy: 'all'|'desktop'|'browser'` + `canAccessEnterprisePlatform`），只是老架构把 18 条路由**全设成了 `'all'`**，没真正把配置限制到网页——这是"做得不够好"的第一个具体点。

---

## 二、参考架构：老架构的三大机制（可直接移植）

### 1. 资源作用域分发（策略分发的本体）

`src/process/webserver/routes/resourceScope.ts`：

- scope 三级：`personal` / `team` / `organization`（`ResourceScopeFields.tsx` 的下拉）。
- 写入校验 `resolveResourceScope`：team 要求调用者是该团队成员；organization 仅管理员。
- 读取可见性 `VISIBLE_RESOURCE_WHERE`：成员自动看到「组织资源 ∪ 自己个人 ∪ 所在团队」。**这就是"下发"在数据层的实现**——管理员把技能设 team/org，成员 list 时即可见。
- 管理权限 `canManageScopedResource`：owner / 团队 owner-admin / 企业 admin 可改删。
- 落表：`skills_registry` / `mcp_registry` / `rag_documents` / `artifact_repos` / `code_repos` 都带 `scope/team_id/created_by`。

### 2. 角色 + 平台双门控（每条路由）

`common/auth/enterpriseRoutes.ts`：

- 角色 `member/admin/system_admin` + `canAccessEnterpriseRouteRole`。
- 平台 `all/desktop/browser` + `canAccessEnterprisePlatform`。
- `getVisibleEnterpriseNavKeys(role, isDesktop)` 一次算出该角色该平台可见的导航。

### 3. 完整模块套件（18 模块）

`enterpriseNav.ts` + `pages/admin/*` + `pages/enterprise/*`：概览/企业设置/用户/团队与组织/团队运行时/企业认证/邀请码/Issues 规划看板/团队知识库/团队 MCP/团队 Skills/流水线编排器/版本规划/制品仓库/代码库/效能洞察/使用统计/安全与审计。

---

## 三、核心缺口（fork 缺的 = 运行时消费；老架构也弱的 = 同一处）

| 层                                                             | 老架构                  | fork                                                       | 缺口性质                         |
| -------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------- | -------------------------------- |
| 管理后台 UI（18 模块）                                         | ✅ 完整                 | ⚠️ 只迁了部分（用户/邀请码/审计/SSO + registries CRUD 壳） | fork **未迁**                    |
| scope 分发（写校验+读可见）                                    | ✅ 完整                 | ❌ 有字段无逻辑                                            | fork **未迁**                    |
| role + platform 门控                                           | ✅ 机制在（但全 'all'） | ❌ 路由无门                                                | fork **未迁** + 老架构**没配对** |
| **运行时消费（agent 真加载团队技能/连团队 MCP/检索团队 RAG）** | ❌ **也没接**           | ❌ 没接                                                    | **两边都缺——真正要新建的核心**   |
| 下发落地（sync 到本机+离线+受控删除）                          | ❌ 无                   | ❌ 无                                                      | **全新**                         |

**PM 判断**：老架构给了我们「管理后台 + 分发可见性」的成熟蓝图（直接移植），但**「团队资源真正被 agent 用起来」这条命脉，老架构也只到可见列表为止**。这解释了为什么整套东西"看着全、其实空"。**真正的产品价值增量 = 补上运行时消费 + 下发落地**，这也正是用户反复点名的「策略分发」。

---

## 四、逐模块矩阵（产品意图 / 处置 / 落点）

处置：**KEEP**=真功能保留；**PORT**=从老架构移植到 fork；**REBUILD**=补运行时消费；**KEEP-ON-WEB**=仅网页后台配置；**CUT/DEFER**=撤下或延后。

| 模块                  | 产品意图                 | 老架构             | fork       | 处置                                    | 落点                |
| --------------------- | ------------------------ | ------------------ | ---------- | --------------------------------------- | ------------------- |
| 概览 home             | 成员消费仪表盘           | ✅                 | ⚠️控制台壳 | **REBUILD** 成消费视图                  | 桌面                |
| 企业设置 settings     | 企业名/退出口令/基础配置 | ✅                 | ❌         | PORT                                    | 网页                |
| 用户管理 users        | 成员账号/角色            | ✅                 | ✅         | KEEP-ON-WEB                             | 网页                |
| 团队与组织 teams      | 团队结构/成员/归属       | ✅                 | ❌         | **PORT**（分发依赖 team_memberships）   | 网页                |
| 企业认证 auth SSO     | 飞书/钉钉/LDAP           | ✅(有BUG)          | ✅         | KEEP-ON-WEB + 修登录                    | 网页                |
| 邀请码 invites        | 成员邀请                 | ✅                 | ✅         | KEEP-ON-WEB                             | 网页                |
| 安全与审计 security   | 审计日志                 | ✅                 | ✅         | KEEP-ON-WEB                             | 网页                |
| **团队 Skills**       | 管理员下发技能           | 分发✅/消费❌      | 壳         | **REBUILD**（分发 PORT + 运行时新建）   | 网页配置 / 桌面消费 |
| **团队 MCP**          | 管理员下发 MCP           | 分发✅/消费❌      | 壳         | **REBUILD**                             | 网页配置 / 桌面消费 |
| **团队知识库 RAG**    | 团队共享向量知识         | 管线✅/对话检索❌  | 半壳       | **REBUILD**（接入对话检索）             | 网页配置 / 桌面消费 |
| Issues 规划看板 cteam | 需求协同/派活            | ✅端到端(dispatch) | ✅后端在   | **KEEP**（桌面显"派给我" + 网页全看板） | 两端                |
| 版本规划 milestones   | 里程碑                   | ✅                 | ✅CRUD     | KEEP-ON-WEB                             | 网页                |
| 流水线编排器 pipeline | CI 编排                  | ✅                 | ✅CRUD     | KEEP-ON-WEB（评估真实度）               | 网页                |
| 测试管理 test         | 测试计划/用例            | ✅                 | ✅CRUD     | KEEP-ON-WEB                             | 网页                |
| 制品仓库 cpack        | 制品/资产                | ✅(artifactRepo)   | ❌占位     | **DEFER/PORT**（老架构有后端）          | 网页                |
| 代码库 ccode          | 代码资产接入             | ✅(codeRepo)       | ❌占位     | **DEFER/PORT**                          | 网页                |
| 效能洞察 cmeas        | DORA 指标                | ✅(metricRepo)     | ❌占位     | **DEFER/PORT**                          | 网页                |
| 团队运行时 runtimes   | 运行时节点               | ✅薄               | ✅薄       | KEEP-ON-WEB / 评估                      | 网页                |
| 使用统计 usage        | 席位/用量                | ✅(gateway)        | ❌         | DEFER                                   | 网页                |

> 注：cpack/ccode/cmeas 在 fork 里标"即将推出"，但**老架构其实建了后端**（artifact/code/metric repository）——所以是"未迁"，不是"永久砍"。是否移植看优先级。

---

## 四·五、fork 架构实勘修正（2026-07-08，直接影响 M1-M3 打法）

深入 AionCore 后发现 fork 与主规划初始假设有关键差异，据此优化打法：

1. **fork 无企业级 `team_memberships`**：现有 "team"（`aionui-team`、`teams` 表）是 Team Mode 多 agent 协作，**不是「企业团队 + 人成员」**。→ `team` scope 需先建地基（M1b 真的要新建 teams+成员关系）；`personal`/`org` 两级现在可做。
2. **fork 单租户模型**：`one-devops` 的 list/insert **没有 tenant_id**——每个企业服务器 = 一个租户。`list_skills` 直接返回**全部行（无 scope 过滤）**，`upsert_skill` 硬编码 `scope='org'`。→ org-scope 技能**其实已对成员可见**（client 模式读到全部）。缺口不在"可见"，在**消费（M2）+ 落地离线（M3）**。
3. **本机技能链路**：磁盘存于 `aionui-extension/skill_service`（`/api/skills`），agent 经 `aionui-ai-agent/capability/skill_manager` 加载。→ **M3 把团队技能物化进这个磁盘目录后，现有 agent 加载路径自动消费——M2 的技能/MCP 部分顺带交付**，真正独立的 M2 只剩 RAG 对话检索。

**优化后的执行序**：M1a(personal/org scope + 可见性过滤，防个人项外泄) → M1c(前端门控) → **M3(物化落地，顺带交付 M2-技能/MCP)** → M2-RAG(对话检索) → M1b+team scope(建 teams 地基后)。

## 五、要在 fork 建的跨切面机制（三件，按依赖排序）

### M1. scope 可见性 + 双门控（移植老架构，纯搬运）

- AionCore `one-devops`：list 接口加 `VISIBLE_RESOURCE_WHERE` 等价逻辑（成员看 org∪个人∪团队），写入加 `resolveResourceScope` 校验。依赖 `team_memberships`（先 PORT teams 模块）。
- fork Router：移植 `enterpriseRoutes` 的 role+platform 门控；配置类路由设 `platformPolicy='browser'`，消费类留桌面。**顺带修**上一轮发现的：企业后台地址直达 `/#/enterprise/console`、`/enterprise/console` 加 org-admin 角色门。

### M2. 运行时消费（真正的核心，两边都没有——新建）

让 agent 跑的时候真用上团队资源：

- 技能：成员对话/agent 装配时，把「可见团队技能」纳入 enabledSkills（或先物化到本机 FS 再走现有 injectSkills 路径）。
- MCP：成员 agent 的 MCP 客户端连接「可见团队 MCP」。
- RAG：agent 对话检索「可见团队知识库」（把 `searchRag` 接进对话增强）。

> **本次会话完整实现记录（后端+前端+测试+提交+未决点）见 `session-2026-07-09-team-skill-distribution.zh-CN.md`——后续 AI 先读那份。**

### M3 实施进度（2026-07-08）

- ✅ **离线地基（Rust）已建**：`AionCore/crates/aionui-extension/src/team_sync.rs`——`sync_team_skills(team_skills_dir, payloads, authoritative)` 把团队技能物化成 `{data_dir}/team-skills/{id}/SKILL.md`（带 frontmatter）+ `.team-origin` 标记；`authoritative=true`（服务端可达）才对账删除服务器已删项，`false`（离线）保留缓存；只动带标记的自有目录。`SkillPaths::team_skills_dir()` 方法派生路径（零构造点改动）。6 个单测全过（写入/passthrough/对账删除/离线保留/不碰外来目录/防穿越）。
- ✅ **列举接入 + 同步路由（Rust）已建**：
  - `SkillSource::Team` 变体全链路（枚举 + `SkillSourceResponse::Team` serde + `skill_routes` 映射 + agent `skill_manager` 两处 match 加载/读内容都按 Custom 处理）。
  - `list_team_skills_from_disk` 并入 `list_available_skills` **和** `list_available_skills_with_repo`（生产 DB 路径）→ **agent loader（`skill_manager` 调 `list_available_skills`）自动加载团队技能 = M2-技能顺带交付**；Skills Hub UI 也能拿到（source=team 可绿标）。同名覆盖 builtin。
  - `POST /api/skills/team-sync`（body `{skills:[{id,name,description,content}], authoritative}`）→ 调 `team_sync::sync_team_skills` 物化+对账，返回 `{written,removed,kept}`。成员前端拉 `oneDevops.listSkills`（远端）→ POST 到本地后端物化。
  - 验证：`cargo build` 干净；`team_sync` 6/6；`skill_service` 81/82（唯一失败 `import_skills_replaces_dangling_link_with_copy` 是 Windows 符号链接权限的既有环境问题，测 `import_skills`，与本改动无关）。
- ✅ **前端串联（技能）已建**：
  - `ipcBridge.fs.syncTeamSkills`（`httpPostLocal`，客户端模式也打本地）+ `listAvailableSkills` source 加 `'team'`。
  - `utils/enterprise/teamSkillSync.ts`：拉 `oneDevops.listSkills`(远端)→POST 本地 `team-sync`；**服务器不可达→返回 null 不动本地缓存**（离线优先）。
  - `hooks/enterprise/useTeamResourceSync.ts`：**门控 `context.isEnterprise`——单机直接 return，不发请求、不建目录**；企业下首次 + 每 5 分钟同步。挂在 `Layout.tsx`。
  - Skills Hub：`source==='team'` → **绿色「团队」标签**；删除按钮仍只对 `custom` 显示 → 团队技能**只读**。共享 `SkillSource` 类型 + `SkillSourceResponse` + settings.json(zh/en) 加 `team`。
  - 验证：`bunx tsc` 通过；`oxlint` 0 error。
  - **单机安全**：全链路门控在企业上下文；`skill_service` 81 个单机测试全绿；team 目录不存在时列举逐字节不变。
- ⏳ **下一片**：①MCP 物化（团队 MCP → 本机 MCP 配置，同 team_sync 模式）②team 技能 auto-active vs opt-in 产品定调 ③桌面端 E2E 实测（建团队技能→成员同步→绿标+agent 加载）。

### M3. 下发落地（离线可用 + 受控删除，全新——用户强需求）

- 成员机把可见团队资源 **sync 物化到本机**（技能→FS、MCP→本机配置、知识→本地缓存），打 `origin=team` 绿标、只读。
- 服务器挂了默认不影响使用；仅服务端可达且管理员删除时，客户端对账清除。

> M1 是搬运（老架构有），M2/M3 是新建（老架构也没有）——**M2/M3 才是把"空壳"变"真功能"的关键，也是这个项目相对老架构的正向增量。**

---

## 六、分阶段路线图（PM 排期）

**P0 先扭方向（小、快、可提交）**

- 修地址直达后台 + `/enterprise/console` 角色门（上一轮已定位）。
- 桌面企业区降级：概览改成消费视图骨架（「我的团队工具（暂空）+ 派给我的协同任务（接 Issues 真数据）」），撤下配置宫格。

**P1 网页管理后台成形（PORT 为主）**

- PORT teams 模块（分发的地基）→ users/settings/auth/invites/security 收进网页后台 + role/platform 门控。
- 团队 Skills/MCP/RAG 的**管理端**（scope 定义 + VISIBLE 可见性）移植到 fork。

**P2 打通一条真消费链路（样板）**

- 选「团队技能」端到端：定义(网页) → scope=team → 成员 M3 落地本机 → M2 agent 真加载 → 桌面绿标显示。跑通验收后复制到 MCP、RAG。

**P3 铺开 + 补齐**

- MCP/RAG 消费；cpack/ccode/cmeas 按需 PORT；usage/runtimes 收尾。

**贯穿**：每模块做完**桌面端自测**，重点**策略分发 + 用户登录**（用户方针）。

---

## 七、每模块"done-right"验收标准（PM 验收视角）

- **团队 Skills**：管理员在网页设 scope=team 的技能 → 成员桌面「我的技能」出现该技能带绿标「团队」→ 成员开会话，agent 真的能用这个技能 → 断网后仍可用 → 管理员删除且服务端可达时成员端消失。
- **团队 MCP**：同上，成员 agent 真连到团队 MCP 并可调用其工具。
- **团队 RAG**：成员对话时 agent 真检索到团队知识库内容并引用。
- **Issues 看板**：管理员/成员在网页建需求并 dispatch → 数字员工真跑；成员桌面「派给我的任务」看到指派。
- **配置类模块**：桌面端**不可见/不可达**（platform=browser 生效），网页端管理员登录后可配。

---

## 附：关键证据路径（复核用，别重复侦察）

- scope 分发：`1one-command/src/process/webserver/routes/resourceScope.ts`、`ResourceScopeFields.tsx`
- 双门控：`1one-command/src/common/auth/enterpriseRoutes.ts`
- 模块套件：`1one-command/src/renderer/pages/enterprise/enterpriseNav.ts` + `pages/admin/*`
- 消费断链证据：`skills_registry`/`mcp_registry` 仅见于 `devopsRoutes`/`migrations`/`schema`/`resourceScope`，agent 注入走 `conversationSendService.injectSkills`（另一条 FS 路径）
- fork 现状审计：`enterprise-capability-audit-real-vs-shell.zh-CN.md`
- 内容模型（下发落地四规则）：`enterprise-console-content-model-design.zh-CN.md`
