# 企业版商业化待办（活文档 · 跨会话交接）

> **这份文档是权威待办清单**，会话上下文会丢，它不会。开新会话时先读这份。
> 最后更新：2026-07-30
>
> ## ✅ 2026-07-30：§2 的 5 项待办已全部落地
>
> P0-1 续 / P0-2 / P0-3 / P1-1 / P1-2 全部完成并通过真机 CDP 验证。
> 完整交接见 [`session-2026-07-30-enterprise-backlog-and-hybrid-rag.zh-CN.md`](session-2026-07-30-enterprise-backlog-and-hybrid-rag.zh-CN.md)。
>
> **⚠️ 两处本文档原有结论已作废，不要再按它执行：**
>
> 1. **P0-3 的"移植 AnythingLLM UI + 换 LanceDB 内核"作废**。LanceDB 实测让
>    `aioncore.exe` 从 94.3 MB 涨到 **299.3 MB**（+205 MB），且需要 CI 额外安装
>    `protoc`。最终改用 **SQLite 内置 FTS5**（BM25 + 向量 cosine，RRF 融合），
>    体积只 +3.1 MB。取舍与 LanceDB 的三个坑见交接文档 §1。
> 2. **P1-2 说的"统一 `created_by`"是错的**。实际是两套字段，其中五张看板表
>    还有个冗余的 `creator_name` 必须同改，且 `one_test_cases` 本文档漏列了。
>    详见交接文档 §2。
>
> **剩余待办**：§2 已清空；仍未做的是 §2 末尾的 **P2 三项**（用户明确"暂缓"）。
> 另有两件非代码事项见交接文档 §7：1oneCore 尚未合并主干、License 公私钥
> 轮换需人工离线执行。
>
> 背景：P0/P1/P2 商业化路线图（多成员/SSO/计费/审计/成本管控/组织架构/各类预留框架）
> 已在 2026-07-24~25 全部落地并随 v2.1.50 发布。本文档记录的是**那之后**，
> 以"能不能真的卖出去"为标准做的缺口盘点与后续工作。
>
> ## 📌 2026-08-08：本文档只覆盖「功能维度」的待办
>
> 以"客户为什么不掏钱"重新排的序在
> [`enterprise-china-market-gtm.zh-CN.md`](enterprise-china-market-gtm.zh-CN.md)。
> 那份的结论是：**卡签单的是交付形态与数据安全，不是功能数量**——所谓服务器
> 模式目前是某台员工的 Windows 电脑当服务器，有 IT 的公司走不进采购流程。
> 排期请以那份的 §七 为准，本文档的 P2 三项在那里被判定为"明确不做"。

---

## 一、已完成（本轮）

### ✅ P0-1 License Key 离线激活 — 后端已完成并提交（1oneCore `ce4c2bdd`）

**解决的问题**：此前 `PUT /api/one/billing/tier` 的门控是 `is_billing_admin`，
即**客户自己公司的管理员**。也就是说客户装完私有化部署，自己打一个请求就能
把 tier 设成 `enterprise`，席位无限、功能全开。功能门控和席位上限本身是真拦
得住的（已核实 `tier_allows` 在 one-org/one-sso/one-devops 都真调了，席位在
`one-enterprise/service.rs:124` 真读 billing 表拦截），但**"授权"这个动作是
自助的**——锁很结实，钥匙插在门上。

**已实现**：

- `crates/one-billing/src/license_key.rs` — Ed25519 签名授权码
  `ONEWORK-<base64url(payload)>.<base64url(sig)>`，payload 含
  `lid/customer/tier/seats/exp/iat`
- 按用户决策**不绑机器指纹**，客户可自由迁移服务器，**到期时间是唯一管控杠杆**
- 迁移 `billing_003_license_activation` — 记录激活历史，按 `lid` 幂等
- `activate_license()` 是**唯一能升档的路径**；`set_tier()` 改为**仅降级**，
  升档返回 `UPGRADE_REQUIRES_LICENSE`
- **到期在 `license_of()` 单点判定**：所有门控都经这里读，一处生效全局降级，
  不需要后台任务；过期同时失效席位覆盖值
- 路由 `GET/POST /api/one/billing/license`
- `examples/license_tool.rs` — 厂商侧签发工具（`keygen`/`issue`/`inspect`），
  不随产品分发
- 测试 14 绿，含三个锁死：禁止自助升档、到期自动降级（含席位覆盖失效）、
  非厂商签发的码必须拒绝

**⚠️ 上线前必做**：当前内置的 `LICENSE_PUBLIC_KEY_B64` 是开发占位值，
其私钥曾在 AI 会话中打印过，**必须视为已泄露**。上线前跑
`cargo run -p one-billing --example license_tool -- keygen`，
替换公钥常量，私钥离线保管（绝不要让任何 AI 会话看到）。

---

## 二、待办（按优先级）

### 🔴 P0-1（续）License Key 前端激活入口

- `BillingTab` 加激活码输入框 + 当前授权展示（客户名/档位/席位/到期）
- 到期提醒（临期 N 天高亮）
- 升档被拒时的引导文案（`UPGRADE_REQUIRES_LICENSE` → "请联系厂商获取授权码"）
- 后端已可用，可先用 `curl -X POST /api/one/billing/license` 验证

### 🔴 P0-2 管理员移除成员 + 席位回收

**这是安全合规硬伤**：核实过 `/api/one/admin/users/*` 只有 `role` 和
`department` 两个端点，**没有移除**。成员离职只能自己调 `leave` 且需要退出
口令 —— 管理员没有任何手段把离职员工踢出组织、收回席位。任何客户 POC
第一周就会踩到。

- one-org：`DELETE /api/one/admin/users/{user_id}`（删 `one_user_org` 行 +
  清 `one_active_tenant` + 轮换该用户 jwt 使其会话立即失效）
- one-enterprise：公司管理员移除公司成员（删 `one_enterprise_members` 释放席位）
- 守住：最后一个管理员不能被移除（复用 `LastAdminCannotLeave`）、不能移除
  自己（要用 leave）、system_admin 保护
- 前端 `UsersTab` 加移除按钮 + 二次确认；审计留痕

### 🔴 P0-3 知识库重做（**方案已定：移植 AnythingLLM UI + 换 LanceDB 内核**）

**背景**：核查发现团队知识库是个孤岛——全仓唯一自动引用点是
`one-devops/routes.rs:295`（只在"派发任务给数字员工"时注入 top-3），
**员工日常聊天时 Agent 完全不知道公司有知识库**
（`aionui-conversation`/`aionui-ai-agent` 对 rag 零引用）。
且用户判断现有 RAG "很初级"（暴力余弦全表扫、固定切片、无重排）。

**选型经过（重要，避免重复调研）**：
| 方案 | 结论 |
|---|---|
| RAGFlow (86k) | ❌ 要 Docker + MySQL/Redis/ES/MinIO，与"桌面应用开箱即用"定位冲突 |
| Dify (150k) | ❌ 许可证禁止多租户 + 禁止移除 LOGO；且是完整平台，与本产品功能重叠 |
| LangChain/LlamaIndex/Haystack (Python) | ❌ 要装 Python 运行时 |
| LlamaIndexTS | ❌ 2026-03 后停更 |
| MaxKB | ❌ GPL-3.0 传染 |
| **AnythingLLM (64k, MIT)** | ✅ **UI 移植来源**（React 18 + Vite + Tailwind，与我们同栈，MIT 可合法移植） |
| **LanceDB (Rust crate)** | ✅ **检索内核**（v0.33，77万下载，活跃；ANN + BM25 + 混合检索 + reranker；编译进 aioncore，零部署） |

关键佐证：**AnythingLLM 自己的默认向量库就是 LanceDB**
（`VECTOR_DB="lancedb"`），而 Chroma 在它那里反而是要连 endpoint 的服务型选项。

⚠️ 注意：豆包曾推荐过 `ivangfr/local-rag`、`daidr/node-rag-kb`、
`langchain4j/langchain-js`、`peterw/rag-simple` —— **这四个仓库经 GitHub API
核实全部不存在**，是幻觉，不要再去找。

**权限模型融合**（已核实两边同构，映射不难）：
| AnythingLLM | 我们 |
|---|---|
| `workspaces` | `one_tenants`（项目组） |
| `workspace_users` | `one_user_org` |
| `users.role` (admin/manager/default) | `one_user_org.role` |
| `invites` | `one_tenant_invites` |

**实施要点**：

1. **只移植 UI**，不跑 AnythingLLM 的服务（避免双用户体系 + 包体积 + 进程生命周期）
2. 后端换 LanceDB crate 替换手写的 `pack_embedding`/`cosine_similarity`/`search_rag`
3. **保留**：`officeparser` 文档解析（PDF/Word/Excel/PPT，这层不差）、
   上传管理 UI 逻辑、P0-4 权限 ACL
4. **接进 Agent**（这才是缺口本质，任何框架都替不了）：把检索做成 Agent
   可调用工具，复用 ACL 让成员只搜到有权看的
5. 个人版红线：无知识库时零影响

### 🟠 P1-1 企业数据备份/恢复

采购尽调必问项，现在完全没有。

- `GET /api/one/admin/backup/export` 打包企业侧数据为带版本号的 JSON
  （tenants/成员/active_tenant/departments/邀请码/enterprises/license/SSO配置/devops registries）
- `POST .../import` 校验版本 + 幂等恢复
- 前端备份页（导出下载 + 导入上传 + 上次备份时间）
- 边界：不含用户会话/消息（体量大且属个人数据），文档写清

### 🟠 P1-2 离职成员资源接管

团队资产不能随人走。`one-devops` 三个 registry + pipelines/milestones/test_plans
的 `created_by` 指向离职者时无人可管。

- `transfer_ownership(from_user, to_user, tenant_id)` 批量改 `created_by`
- 移除成员时提示"该成员名下有 N 项团队资源，转交给谁？"
- 测试锁死跨租户不能转

### 🟡 P2 提升续费率（暂缓，有余力再做）

- 席位回收建议（"这 3 人 30 天未登录，可回收"）
- 审计日志保留策略（现在无限增长会撑爆库）
- ROI 看板（用量看板有数字，但缺"本月团队节省了多少"的价值叙事）

---

## 三、已核查确认没问题的（不用重复查）

**下发链路端到端**（用户特别点名要查的）：
| 下发内容 | 结论 |
|---|---|
| 技能 SKILL | ✅ 通（`useTeamResourceSync` 在 `Layout.tsx:144` 真挂载，启动+5分钟轮询，本地物化） |
| MCP 工具 | ✅ 通（同上路径） |
| 任务派发→数字员工 | ✅ 通（且是唯一自动引用知识库处） |
| 知识库 | ⚠️ 半通 → 见 P0-3 |

- P0-4 ACL 默认值安全（`scope='org'`/`visibility='all'`，不误伤成员）
- 席位上限是真拦的（`one-enterprise/service.rs:124` 真读 billing 表）
- 功能门控是真调的（`tier_allows` 在三个 crate 都有调用点）

---

## 四、交接注意事项

- **1oneCore 有其他会话留下的未提交改动**（`aionui-assistant`/`aionui-db`/
  `aionui-team`/`aionui-app/router/state.rs`），提交时用
  `git commit -- <指定路径>` 只提交自己的部分，别混进去
- 改完 Rust 必须 `scripts/backend-rebuild.ps1` 重编进 bundled 才生效；
  **重编前要关掉 dev app**，否则 bundled 文件被锁报 EPERM
- 打包发布流程见 `packaging-release-playbook.zh-CN.md`
  （含 COS 上传改用本地 aws-cli 的教训）
