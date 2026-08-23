# 交接文档：企业团队技能下发（M3 skills）——本次会话完整记录

> 日期：2026-07-09。读者：后续接手的 AI / 开发者。
> 一句话：把「企业管理员定义的团队技能」端到端下发到成员机、离线可用、被 agent 加载、绿标只读，**后端(Rust)是主体，前端是薄触发层**。
> 涉及两仓：`D:\aionui-m0\AionCore`(1oneCore, Rust 后端) + `D:\aionui-m0\AionUi`(1oneUI, 前端)。**均已提交 + 推送 `one-main`。版本 2.1.34（未打包，用户暂停）。**

---

## 0. 先读这些（背景 + 决策链）

- `docs/guides/enterprise-product-master-plan.zh-CN.md` —— **PM 主规划**：两端架构、三机制(M1/M2/M3)、逐模块矩阵、路线图。本次只完成 M3 的 skills 部分。
- `docs/guides/enterprise-capability-audit-real-vs-shell.zh-CN.md` —— 审计：为什么老架构「看着全其实空」（registry 存了但 agent 不消费）。
- `docs/guides/enterprise-console-content-model-design.zh-CN.md` —— 内容模型：下发落地/绿标/离线/受控删除四规则的来源。
- 本文 = 上面规划的**本次实现记录**。

---

## 1. 做了什么（端到端机制）

```
管理员在企业 registry 定义团队技能 (one-devops: skills_registry, 已有)
        │  成员桌面端(客户端模式)拉 oneDevops.listSkills → 远端服务器
        ▼
POST /api/skills/team-sync  →  本地 aioncore (httpPostLocal, 客户端也打本地)
        │  team_sync::sync_team_skills 物化
        ▼
{data_dir}/team-skills/{registry_id}/SKILL.md  +  .team-origin 标记
        │  list_available_skills 扫这个目录 (source=Team)
        ├──▶ agent skill_manager 自动纳入可加载集 (M2-技能顺带交付)
        └──▶ Skills Hub / 助手技能选择器 显示 (绿标「团队」, 只读)
```

**四条硬规则的落点**：

1. **下发落地** = 物化成真 `SKILL.md`（`build_skill_md`：无 frontmatter 则合成 name/description）。
2. **离线可用** = 落盘后与服务器无关，agent 读本机。
3. **受控删除** = `sync_team_skills(..., authoritative)`：`true`(服务端可达) 才对账删除服务器已删项；`false`(离线/拉取失败) 保留缓存。
4. **只碰自己的** = 只删带 `.team-origin` 标记的目录，绝不动用户手建技能；id 清洗防路径穿越。

---

## 2. 后端改动（1oneCore，本次核心，commit `9a1c279` + fmt `52bb7f0`）

| 文件                                                         | 改动                                                                                                                                                                                                                 | 作用                   |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `crates/aionui-extension/src/team_sync.rs` 🆕 235行          | `TeamSkillPayload`/`TeamSyncReport`/`sync_team_skills(dir, payloads, authoritative)` + `build_skill_md`/`sanitize_id` + 6 单测                                                                                       | **物化 + 对账核心**    |
| `crates/aionui-extension/src/skill_service.rs` +54           | `SkillSource::Team` 变体；`SkillPaths::team_skills_dir()` 方法(从 data_dir 派生,**零构造点改动**)；`list_team_skills_from_disk`；并入 `list_available_skills` **和** `list_available_skills_with_repo`(生产 DB 路径) | 让团队技能被列举/加载  |
| `crates/aionui-extension/src/skill_routes.rs` +69            | `POST /api/skills/team-sync` handler(在 auth_middleware 之后)                                                                                                                                                        | 成员触发同步           |
| `crates/aionui-extension/src/constants.rs`                   | `TEAM_SKILLS_DIR_NAME = "team-skills"`                                                                                                                                                                               | 目录名                 |
| `crates/aionui-extension/src/lib.rs`                         | `pub mod team_sync;`                                                                                                                                                                                                 | 模块注册               |
| `crates/aionui-api-types/src/skill.rs`                       | `SkillSourceResponse::Team`(serde "team")                                                                                                                                                                            | 前端契约               |
| `crates/aionui-ai-agent/src/capability/skill_manager/mod.rs` | 两处 match 臂加 `SkillSource::Team`(按 Custom 处理:加载 + 读内容)                                                                                                                                                    | **agent 消费团队技能** |
| `crates/aionui-extension/tests/team_skill_sync_e2e.rs` 🆕    | 3 条 E2E 集成测试                                                                                                                                                                                                    | 真数据实证             |

**验证**：`cargo build` 干净 · `team_sync` 6/6 · `team_skill_sync_e2e` 3/3 · `skill_manager` 23/23(无回归) · clippy 干净 · fmt 通过。`skill_service` 81/82（唯一失败 `import_skills_replaces_dangling_link_with_copy` 是 Windows 符号链接权限的**既有环境问题**，测 `import_skills`，与本改动无关）。

---

## 3. 前端改动（1oneUI，薄触发层 + UI，commit `6219386`/`e013ab9`/`9180104`）

| 文件                                                                    | 改动                                                                                                         |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `packages/desktop/src/common/adapter/ipcBridge.ts`                      | `fs.syncTeamSkills`(`httpPostLocal`,客户端也打本地) + `listAvailableSkills` source 加 `'team'`               |
| `renderer/utils/enterprise/teamSkillSync.ts` 🆕                         | 拉 `oneDevops.listSkills`(远端)→POST 本地 `team-sync`；**服务器不可达返回 null 不动本地缓存**(离线优先)      |
| `renderer/hooks/enterprise/useTeamResourceSync.ts` 🆕                   | 门控 `isEnterprise && isElectronDesktop()`；企业桌面端首次+每 5 分钟同步；**单机/浏览器瘦客户端直接 return** |
| `renderer/components/layout/Layout.tsx`                                 | 挂载 `useTeamResourceSync()`                                                                                 |
| `renderer/pages/settings/SkillsHubSettings.tsx`                         | `source==='team'` → 绿色「团队」标签；删除按钮仍只对 `custom` 显示 → 团队技能**只读**                        |
| `renderer/pages/settings/AssistantSettings/types.ts`                    | 共享 `SkillSource` 加 `'team'`                                                                               |
| `locales/{zh,en}/settings.json` + `common.json`                         | `skillsHub.team` + 控制台团队维度文案 + i18n-keys.d.ts 重新生成                                              |
| `pages/enterprise/EnterpriseConsole.tsx` + `components/OverviewTab.tsx` | (阶段A/P0)控制台改团队维度 + org-admin 角色门 + 后台地址直达 `/#/enterprise/console`                         |

---

## 4. ⚠️ 唯一未决的设计点（需产品拍板）

团队技能当前是 **opt-in**：下发后出现在 Skills Hub + 助手技能选择器（绿标），但**成员要在助手里勾选才会被 agent 加载**，不会自动激活。

- **A. 保持 opt-in**：成员自主。
- **B. auto-active**：自动注入所有助手（像内置 auto-inject，改 `skill_manager` 的 keep 逻辑让 Team 默认保留）。
- **C. 混合**：registry 给技能加「必选/可选」字段，必选 auto-active。（推荐，最贴近企业管控，需小改 registry schema + UI）

未定前保持 A。

---

## 5. 铁律（本次严格遵守，后续必须延续）

- **企业版坏也不影响单机版**：所有企业逻辑门控在企业上下文；团队目录不存在时列举逐字节不变；扫描/同步失败 fail-safe(`unwrap_or_default`/返回 null)。E2E 有专门 `standalone_listing_has_no_team_skills`。
- **不删旧 .exe**：打包脚本 `cleanupWindowsPackOutput` 只清 `win-unpacked`，保留所有旧安装包（版本号命名不冲突）。
- **不许空壳**：每个已交付模块都有真实测试数据验证（技能链路 6 单测 + 3 E2E；控制台桌面实测团队 KPI）。
- **提交规范**：中文 commit、无 AI 签名、直接 `one-main`、精确 `git add`(**绝不 `git add -A`**，fork 有他人改动 + temp/out_old 垃圾)。

---

## 6. 剩下的工作（下一个会话，按优先级）

1. **opt-in/auto-active 定调**（见 §4）→ 若选 B/C 改 `skill_manager` + 可能 registry。
2. **MCP 下发消费**：团队 MCP → 本机 MCP 配置。难点：MCP 存 SQLite(`IMcpServerRepository`) 需加 origin 字段做对账；带密钥(`hasKeys`)的团队 MCP 客户端无法完整物化(密钥在服务端)。**别硬塞成空壳。**
3. **RAG 下发消费**：agent 对话检索团队知识库（`oneDevops.searchRag` 已有向量管线，缺对话接入）。
4. **M1 scope 细化 + M1b teams**：`personal/team/organization` 三级 scope（fork 现在全 `org`，无 `team_memberships`；老架构参考 `1one-command/src/process/webserver/routes/resourceScope.ts`）。
5. **桌面 E2E 实测**：建团队技能→成员同步→绿标+agent 加载（走 cargo/API 或桌面 dev，**别启动裸 Electron**——新架构核心是 AionCore 后端 + WebUI）。
6. **打包**：`scripts/backend-rebuild.ps1`(cargo release + 内嵌) → `npm run dist:win`（用户暂停中）。

---

## 7. 关键入口速查

- 后端物化核心：`AionCore/crates/aionui-extension/src/team_sync.rs`
- 列举接入：`skill_service.rs::list_available_skills` / `list_available_skills_with_repo`
- API 路由：`skill_routes.rs::sync_team_skills_handler`（`/api/skills/team-sync`）
- agent 消费：`aionui-ai-agent/src/capability/skill_manager/mod.rs`（两处 `SkillSource::Team` match 臂）
- 前端触发：`teamSkillSync.ts` + `useTeamResourceSync.ts`（挂在 `Layout.tsx`）
- 绿标：`SkillsHubSettings.tsx`（`source==='team'`）
- registry 数据源（团队技能定义）：`AionCore/crates/one-devops`（`oneDevops.listSkills` = `/api/one/devops/skills`）

---

## 8. 续轮补记（同日，用户拍板混合模型后）

- ✅ **混合模型落地**：registry 加 `auto_active`（迁移 007）→ 管理端「成员自动启用（必选）」开关 → `.team-auto` 标记 → agent 对必选团队技能**免勾选自动加载** → Skills Hub「团队 · 自动」徽标。
- ✅ **团队 MCP 下发**：`McpConfigService::sync_team_servers`（original_json 存归属标记、个人同名冲突保护、authoritative 对账）+ `POST /api/mcp/team-sync` + 前端 `syncTeamMcp` 并入同步轮。
- ✅ **任务协同 RAG 消费**：需求派发数字员工时自动检索团队知识库注入任务上下文（best-effort）。
- ✅ **安全修复**：注册表写接口管理员门（F1，最严重）+ 三处 id 截断碰撞（F2）。
- 📋 **全面审计报告**：`enterprise-system-audit-2026-07-09.zh-CN.md`（F1-F4 + D1-D7）。

## 9. 审计缺陷 D1-D7 全部修复（同日续，用户拍板「本地+团队附加」原则）

**D1 是地基**：原则从头就是「本地为主 + 团队附加」，不存在瘦客户端。

| 缺陷                            | 修复                                                                                                                                                                                                                                                         | 提交(1oneCore/1oneUI) |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| **D1 本地优先路由**（架构核心） | `httpBridge.ts::routesToRemote` 路径感知：治理面(`/api/one/org\|admin\|sso\|devops`)走远端，会话/agent/技能/MCP/个人**一律本地**；WS 改本地。成员 agent 本地跑，吃本地物化的团队技能(auto_active 自动加载)+团队 MCP，**天然离线**。单机/服务器宿主不受影响。 | `6caab9e`             |
| D2 退出清理下发资源             | `clearTeamResources` 退出后空集 authoritative 清空团队技能/MCP                                                                                                                                                                                               | `096d1bc`             |
| D3 一服务器一企业               | `create_tenant` 已有租户拒建（表无 tenant_id 会共享）                                                                                                                                                                                                        | `d111378`             |
| D4 邀请码熵                     | 4→8 字节(2^64)+按4分组                                                                                                                                                                                                                                       | `bcfa303`             |
| D5 带凭据团队 MCP               | 迁移 008 `secrets_json`，凭据随 sync 物化进 env/headers，离线可用。**⚠️ 凭据分发到每台成员机（离线必然），UI 已提示**                                                                                                                                        | `c513236`/`d9d39e0`   |
| D6 协作/注册表审计              | `DevopsService::audit` 写 one_audit_logs，接入注册表写/派发/breakdown，表缺静默跳过                                                                                                                                                                          | `08b1b83`             |
| D7 名称唯一约束                 | 团队技能/MCP upsert 重名拒绝，防 last-wins 遮蔽                                                                                                                                                                                                              | `1e24a5a`             |

**测试**：one-devops 20/20、aionui-mcp 全绿、one-org 8/8、one-employee 6/6、team_sync 7/7、e2e 4/4。**单机零影响**全程复核（企业上下文门控 + fail-safe + 无 org 行=放行）。

## 10. HTTP 全链路 E2E 实测（同日续，`c4ed4e0`）

新增 `crates/aionui-app/tests/team_distribution_e2e.rs`——穿**真实路由**（auth 中间件 → one-devops → skills/mcp team-sync → 本机列举），不碰 Electron：

- **技能链路**：管理员 POST 建 `auto_active` 团队技能 → 成员 `team-sync` 物化 → `GET /api/skills` 出现 `source=team` + `is_auto_inject=true`（D1 混合模型验证成立）→ 空集 authoritative 对账删除。
- **MCP+凭据链路**：管理员建带凭据 sse 连接 → 成员 `team-sync` → `GET /api/mcp/servers` 出现且凭据真的进了 `transport.headers`（D5 验证成立）。

2/2 通过。**踩坑记录**：测试用的 `build_app_with_skill_paths` harness 走 `create_router_with_states`，它不像 `create_router` 那样自动跑 one-devops 迁移——测试里需手动 `one_devops::run_one_devops_migrations` 补上，否则注册表表不存在直接 500。

**剩余收尾（均为低优，无阻塞）**：打包 `dist:win`（可随时执行）；邀请码速率限制(低)；M1b teams 三级 scope(低)。

> 全部提交推送 `one-main`。状态总入口见 `STATUS-AND-TODO-2026-07-09.zh-CN.md`。
