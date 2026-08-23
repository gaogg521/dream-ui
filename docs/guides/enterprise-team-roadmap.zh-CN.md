# 企业 / 项目团队方向 — 竞品对标与迭代路线图（living backlog）

> 面向商业化。基于当前代码库现状 + 对成熟竞品的对标，梳理「守什么、补什么、先做什么」。改动落地后请回来勾掉 / 更新状态。
> 相关落地记录：[`session-2026-07-22-company-tier-direction-b.zh-CN.md`](session-2026-07-22-company-tier-direction-b.zh-CN.md)（企业三层 Phase 1）。

## 0. 已完成（成果基线）

- **组织三层骨架**：个人 ⊂ 项目组(one-org) ⊂ 真实企业(one-enterprise)。企业显式设立、公司成员与角色、企业管理员代建多个项目组、SSO 配置迁入企业后台。真机 CDP 全流程验证过，个人单机版零影响（有锁死测试）。
- **企业身份/项目组解耦**（07-20）+ 登录卡死修复 + 身份 approach-B 修复（本会话早段）。
- SSO：飞书/钉钉/企业微信/LDAP。部署：本地优先，客户端/服务器双模式，桌面 + WebUI。

## 1. 我们的差异化（要守住、要放大，别乱拼）

1. **本地优先 + 自托管**：个人数据/agent 执行在本机，服务器只管治理，离线可用 → 数据主权/信创/regulated 行业的稀缺优势（Cursor/Copilot/Claude 全云端）。
2. **国产 IdP 深度集成**：飞书/钉钉/企业微信/LDAP（西方 AI 工具几乎都没有）。
3. **AI-native 团队层**：数字员工、团队技能/MCP 下发、协作看板、流水线（比 Notion/Linear 更 AI 原生）。
4. **清晰的组织三层模型**（刚搭好）。

> 战略：不跟 Cursor 拼云端 coding，不跟 Notion 拼协作。主线 = 「**自托管的、国产 IdP 打通的、AI 数字员工团队平台**」，后续迭代都强化这条 + 补企业级 IAM/可观测。

## 2. 代办（按优先级）

### P0 — 不做就进不了真实企业 / 卖不动

- [x] **P0-1 多成员模型（Phase 2）**✅ 2026-07-23 落地：`one_user_org` 主键 `user_id` → `(user_id, tenant_id)`（迁移 007），一人可在多个项目组；引入 **active-tenant（当前作用项目组）服务端按用户存储**（新表 `one_active_tenant`），`tenant_of`/`effective_role`/`OrgActor` 签名不变、自动解析激活组；前端徽标加切换器（`useMyTenants` + 「我的项目组」下拉）。个人版零影响（锁死测试全绿）。后端单测全绿，真机 CDP + 打包待做。详见 [`session-2026-07-23-multi-membership-phase2.zh-CN.md`](session-2026-07-23-multi-membership-phase2.zh-CN.md)。（对标：Slack/Linear/Notion/飞书均天然多工作区）
- [~] **P0-2 通用 SAML / OIDC + SCIM**：现只支持国产 IdP → 补标准 SAML/OIDC（Okta/Azure AD/Google Workspace）+ SCIM 自动 provisioning（离职自动回收权限，企业合规红线）。打开出海/外企市场。
  - [x] **OIDC**✅ 2026-07-23：新 `one-sso/providers/oidc.rs`（discovery + 授权码流 + userinfo，套飞书 provider 模式，无迁移）+ 前端设置页 OIDC 卡片 + 登录页 OIDC 按钮。一个 provider 覆盖 Okta/Azure AD/Google。one-sso 53 单测全绿（7 新 wiremock）。个人版零影响。真机 CDP + 打包待做。详见 [`session-2026-07-23-oidc-sso.zh-CN.md`](session-2026-07-23-oidc-sso.zh-CN.md)。
  - [ ] **SAML**（XML 规范化+签名验证+metadata，覆盖只支持 SAML 的老 IdP）。
  - [ ] **SCIM 2.0 入站 provisioning**（IdP 推送用户增删改，离职自动回收，合规红线）。
  - [ ] OIDC 硬化：id_token 签名校验（JWKS）。
- [ ] **P0-3 席位 / license + 用量成本看板**：席位/套餐/计费 + license 管控（free/pro/enterprise）；管理员用量看板（谁用了多少、哪个模型、花了多少）。商业化闭环 + 管理员刚需。
- [ ] **P0-4 细粒度 RBAC + 资源分权**：现只有 member/org_admin/system_admin 三档 → 细粒度权限（谁能建技能/下发 MCP/看哪个知识库）；知识库(RAG)从团队级 → 按文档/按角色分权。

### P1 — 企业信任

- [ ] **P1-1 agent 运行审计**：每次 agent 调了哪些工具、碰了哪些文件、跑了什么命令，企业管理员可见 + 可导出。把「本地优先」从治理短板变成「**可审计的本地优先**」卖点。
- [ ] **P1-2 模型管控**：按团队 allowlist + 成本上限 + 用量分析（对标 Cursor Business / Copilot Enterprise）。
- [ ] **P1-3 部署 / 备份 / 升级**：容器化（docker-compose/helm）+ 一键备份恢复 + HA 路线（对标 Dify/Coze 企业版）；运行时节点从心跳 → 配额 + 健康看板。
- [ ] **P1-4 安全策略**：MFA 强制、会话策略、IP 白名单、设备信任；审计日志保留期 + SIEM 导出。
- [ ] **P1-5 DLP / 出网管控**：自托管本地数据上 agent 行为的密钥扫描 / 数据外泄防护。

### P2 — 协作深度 + 生态

- [ ] **P2-1 集成而非重造**：GitHub/GitLab/Jira/飞书双向同步，接住团队既有工作流（别在协作看板/流水线上重造轮子）。
- [ ] **P2-2 实时协同**：多人同一会话/工作区、@提及/评论/线程、看到队友 agent 跑出的结果。
- [ ] **P2-3 组织层级**：项目组内子团队/部门树（部门→团队→项目）。
- [ ] **P2-4 onboarding**：批量邀请 / 域名自动入伙 / 邮件邀请（现只有邀请码）。

### 技术债 / 收尾

- [ ] 其余 11 语言 `common.company.*` 精翻（现回退 en/defaultValue）。
- [ ] 企业三层 Phase 1 打包发版（重编 + bump 版本）。
- [ ] `backend-rebuild.ps1` 第 2 步 `prepareAioncore.js` 偶发 exit 1（版本校验/文件锁），值得排查。
- [ ] `one-org/service.rs:873` 既有 `too_many_arguments`（ratchet，暂不动）。

## 3. 一句话

组织三层骨架已搭好；要真正打进企业、支撑商业化，重心从「做功能」转向「**做治理与信任**」——多成员、通用 SSO+SCIM、细粒度权限、agent 可审计、用量成本可见、席位可计费。独特主线（自托管 + 国产 IdP + AI 数字员工）配上企业级 IAM 与可观测，形成别人短期抄不动的组合。
