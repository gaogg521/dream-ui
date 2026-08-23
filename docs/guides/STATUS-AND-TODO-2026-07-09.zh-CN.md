# 当前状态 + 待办清单（2026-07-09）

> 下个会话**先读这份**，再按需读 `session-2026-07-09-team-skill-distribution.zh-CN.md`（实现细节）和 `enterprise-system-audit-2026-07-09.zh-CN.md`（审计缺陷全表）。
> 两仓：`D:\aionui-m0\AionCore`(1oneCore) + `D:\aionui-m0\AionUi`(1oneUI)，分支 `one-main`。**均已 commit + push，工作区干净。当前版本 2.1.34，未打包。**

---

## 🖥️ 桌面 dev 实机验证（同日续，重编后端+真实点点点测出的问题）

重编 AionCore release + 启动 `frontend-dev.ps1`，用真实数据库（`1one-Dev`）+ 磁盘 + HTTP API 逐项核对，**不是自动化测试，是真人操作走查**。发现并修复 3 个真实 bug（`b9c12d0`）：

1. **身份徽标下拉菜单文案写死**：已加入企业的管理员点自己头像，看到的是"访客模式/加入团队"提示——`SiderEnterpriseEntry` 没挂载主导航，这个徽标是唯一入口却给错误引导，连"进入管理后台"的链接都没有。已按 `context.isEnterprise` 分支修复。
2. **MCP/Skills 编辑表单竞态丢数据**（较严重）：`openEdit` 命令式 `form.setFieldsValue()` 抢跑 Modal 挂载，导致编辑时 Select/Switch/TextArea 字段显示默认值而非真实数据；**新建 MCP 时凭据 JSON 因此从未真正落库**（实测验证 `secrets_json` 始终为 null，直到修复后才正确物化进 `transport.headers`）。已改声明式 `key`+动态 `initialValues` 根治。
3. **组织状态变更后徽标不刷新**：join/create/exit 后各 `useOrgContext()` 独立实例互不通知。照搬既有 `DEPLOYMENT_ROLE_CHANGED_EVENT` 模式加了 `ORG_CONTEXT_CHANGED_EVENT`。

**实测证据**（全部现场验证，非推测）：

- D3：创建第二企业收到服务端真实 403 FORBIDDEN。
- 团队技能下发：`SKILL.md` 磁盘内容逐字匹配表单输入；`.team-auto` 标记确认必选技能免勾选自动加载；Skills Hub 绿色"团队·自动"标签正确渲染。
- 团队 MCP 凭据（修复后）：本机 `transport.headers` 真实带上了下发的 `Authorization`。
- D2：退出企业后 `team-skills` 目录清空、MCP 连接消失；`chrome-devtools` 等个人/内置资源完全不受影响（选择性清理，非一刀切）。
- 后台地址直达 + 管理后台宫格全部真实渲染（团队技能/MCP/知识库/流水线 KPI）。

**vitest 全量**：2054 passed / 5 failed（失败均与本轮改动无关，最后改动提交早于本会话，已逐一核实）。

---

## ✅ 当前已完成（全部提交推送，含 E2E 实测）

**企业「策略下发」端到端打通并实测验证（非空壳）：**

1. **团队技能下发**：管理员在 registry 定义 → 成员桌面端拉取 → 物化本机 `{data}/team-skills/{id}/SKILL.md` → agent 加载 → Skills Hub 绿标只读。离线可用 + 受控删除对账。
2. **混合模型（用户拍板）**：registry 加 `auto_active`（迁移 007）；管理端「成员自动启用（必选）」开关；必选技能 agent **免勾选自动加载**（`.team-auto` 标记），可选技能 opt-in。徽标区分「团队·自动」/「团队」。
3. **团队 MCP 下发（含凭据）**：`sync_team_servers` 物化进本机 MCP 配置（归属标记 + 个人同名冲突保护 + 对账）；迁移 008 `secrets_json` 随 sync 分发，物化进 transport env/headers，离线可用。⚠️ 凭据分发到每台成员机（离线的必然代价），管理端 UI 已提示。
4. **任务协同 RAG**：需求派发数字员工时自动检索团队知识库注入上下文（best-effort，不阻塞）。
5. **本地优先路由（D1，架构地基）**：`httpBridge.ts::routesToRemote` 路径感知——仅治理面（`/api/one/org|admin|sso|devops`）在客户端模式走远端；会话/agent/技能/MCP/个人数据**一律本地**；WS 事件流改本地。成员 agent 本地跑，吃本地物化的团队资源，真正离线。
6. **安全修复**：F1 注册表写接口管理员门（此前任意成员可下发指令给全员）、F2 三处 id 截断碰撞、D2 退出清理下发资源、D3 一服务器一企业、D4 邀请码熵 4→8 字节、D6 协作/注册表审计、D7 名称唯一约束。

**测试全绿（企业相关，2026-07-09 全量复核）：**

| 范围                                                | 结果    |
| --------------------------------------------------- | ------- |
| one-devops                                          | 20/20   |
| one-org                                             | 8/8     |
| aionui-mcp team_sync                                | 4/4     |
| aionui-extension team_sync（单测）                  | 7/7     |
| aionui-extension team_skill_sync_e2e                | 4/4     |
| **aionui-app team_distribution_e2e（HTTP 全链路）** | **2/2** |

**HTTP E2E 实测**（`crates/aionui-app/tests/team_distribution_e2e.rs`，穿真实路由：auth 中间件 → one-devops → skills/mcp team-sync → 本机列举）：

- 管理员建 `auto_active` 技能 → 成员同步物化 → `/api/skills` 出现 `source=team` + `is_auto_inject=true` → 空集对账删除。
- 管理员建带凭据 MCP → 成员同步物化 → `/api/mcp/servers` 出现且凭据真的进了 `transport.headers`。

**单机零影响**：所有企业逻辑门控在企业上下文；无 org 行 = 单机 = 放行；fail-safe 兜底；逐项复核未发现回归。

**提交清单（`one-main`，均已 push）：**

- **1oneCore**：`9a1c279` `52bb7f0` `3e5f833` `720d64d` `e049f7f` `d111378` `bcfa303` `1e24a5a` `08b1b83` `6caab9e`(D1) `c513236`(D5后端) `c4ed4e0`(E2E实测)
- **1oneUI**：`6219386` `a754b63`(bump 2.1.34) `e013ab9` `9180104` `f2324c3` `161f028` `008d33a` `096d1bc`(D2) `65c1a5c` `d9d39e0`(D5前端) `aeeb5cf` `ec729a1`(文档)

---

## 📋 剩余待办（低优先级收尾，无阻塞项）

1. **打包 `dist:win`**：`scripts/backend-rebuild.ps1`(cargo release + 内嵌) → `npm run dist:win`。**用户可随时下令执行**——审计已过目、D1 已定、E2E 已通过，无待拍板项。
2. **邀请码速率限制**（低优）：D4 已把熵从 2^32 提到 2^64，速率限制是纵深防御的锦上添花。
3. **M1b teams 三级 scope**（低优）：`personal/team/organization`（现在 registry 全 `org` 一级，够用；`team_id` 字段已预留）。老架构参考 `1one-command/src/process/webserver/routes/resourceScope.ts`。

---

## ⚠️ 铁律（必守，后续会话继续遵守）

1. **企业版坏也绝不影响单机版**：所有企业逻辑门控在企业上下文；无 org 行=单机=放行；fail-safe 兜底。
2. **不删任何旧 .exe**（打包脚本已内建保护，只清 `win-unpacked` 中间目录）。
3. **不许空壳**：每模块必须真实测试数据实证——本轮见证：45 项企业测试 + 1 条 HTTP 全链路 E2E。
4. **提交**：中文 commit、无 AI 签名、直接 `one-main`、精确 `git add`（**绝不 `git add -A`**，fork 有他人改动 + temp/out_old 垃圾）。**注意**：`cargo fmt -p <crate>` 会顺手重排该 crate 里他人未提交的文件——提交前务必 `git status` 核对，把非本人改动 `git checkout --` 撤销（本轮踩过两次坑）。
5. 运行的 app 在 fork `D:\aionui-m0`，不是 `D:\1one-command`（老架构，仅作参考）。

---

## 📁 关键文档

- 本文 = 状态快照 + 待办总入口
- `session-2026-07-09-team-skill-distribution.zh-CN.md` = 技能下发实现细节 + §9 审计修复记录 + 关键入口速查
- `enterprise-system-audit-2026-07-09.zh-CN.md` = 审计全表（F1-F4 + D1-D7，现已**全部修复**，每条附证据位置）
- `enterprise-product-master-plan.zh-CN.md` = PM 主规划（M1/M2/M3 三机制、逐模块矩阵）
