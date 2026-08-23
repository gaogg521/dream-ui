# 真实企业作为治理层（方向 B / Phase 1）— 个人 ⊂ 项目组 ⊂ 企业

**日期**：2026-07-22-23
**状态**：三仓源码全部改完，编译/测试/lint 通过；**未重编 aioncore、未打包、未提交**。
**上下文**：承接同会话对"企业身份 vs 项目组后台混在一起"的澄清——用户拍板走**方向 B（商业化方向）**：真实企业 = 项目组之上的治理层（一个公司拥有多个项目组、有公司成员与角色、公司级 SSO 策略、独立企业管理后台）。三项已确认决策：①项目组**可独立可归属**；②企业**显式设立**；③企业后台 v1 含**全部四项**（概览/成员角色/项目组列表新建/迁入 SSO）。

## 核心难点与解法（Phase 1 不动成员主键）

`one_user_org` 主键=`user_id`（一个用户只能在一个项目组）+ `create_tenant` 的 D3"一台服务器一个 tenant"守卫，直接挡住"企业管理员管多个项目组"。**解法=代建空项目组**：Phase 1 保持 `one_user_org` PK 与 `create_tenant`/D3 **逐字节不动**；企业管理员的权限来自**企业层** `one_enterprise_members.role='admin'`；新增 `create_tenant_for_enterprise` 按 `enterprise_id` 计数、**不自动把创建者入组**（PK 永不被压）、可选 `initial_admin`（无 org 行时单条 INSERT）、自动发邀请码。多成员模型（PK→`(user_id,tenant_id)`+active-tenant）**推迟 Phase 2**。

## 后端改动（1oneCore）

- **迁移**：`one-org/migrations/006_tenant_enterprise_link.sql`（`one_tenants` 加可空 `enterprise_id`+索引）；`one-enterprise/migrations/enterprise_002_company_origin.sql`（`one_enterprises` 加 `origin NOT NULL DEFAULT 'sso'`）。行模型 `TenantRow`/`EnterpriseRow` 各加字段。显式公司写 `provider='manual'`/`external_id=id`/`origin='manual'`（避开改 NOT NULL 重建表）。
- **one-enterprise**：新 `rbac.rs`(`RequireCompanyAdmin`)；service 加 `setup_company`（显式设立，system_admin 门控，一服务器一公司，能收编已存在的 SSO 公司）/`company_overview`/`list_members`/`set_member_role`(防移除最后管理员)/`company_of`/`is_company_admin(_of)`；**扩 `sync_member`**：有 manual 公司则任何 SSO 登录都挂进它（即使无 tenant_key），保留 ON CONFLICT 不动 role 不降级 admin；无公司无 tenant_key → no-op。routes 加 `/api/one/enterprise/company`(GET)/`/company/setup`(POST)/`/company/members`(GET,RequireCompanyAdmin)/`/company/members/{id}/role`(PUT)。
- **one-org**：新 `bridge.rs`(`CompanyAdminResolver` trait，Option 挂 state)；service 加 `create_tenant_for_enterprise`/`list_tenants_by_enterprise`；`create_tenant`+D3 **原样**。routes 加 `/api/one/org/enterprise/{id}/tenants`(GET/POST，门控 system_admin 或 company-admin)。加 `async-trait` 依赖。
- **one-sso**：`enterprise.rs` 加 `CompanyAdminCheck` trait；state 加 `with_company_admin_check`；`RequireSsoAdmin` **先认 company-admin，再兜底 one_user_org 的 is_admin_role**（`system_default_user→system_admin` 本地配置不变）。
- **aionui-app**：加 `CompanyAdminResolverAdapter`(→one-org)/`CompanyAdminCheckAdapter`(→one-sso)，`one_enterprise_service` 前移构造后挂到 `one_org_state`/`one_sso_state`。

## 前端改动（1oneUI）

- 类型 `orgTypes.ts`：`CompanyOverview`/`CompanyMember`/`EnterpriseTenant`。
- ipcBridge：`oneEnterprise.company/setupCompany/companyMembers/setCompanyMemberRole` + `oneOrg.listEnterpriseTenants/createEnterpriseTenant`。
- 新 hook `useCompanyIdentity`；新页 `pages/enterprise/CompanyConsole.tsx`（路由 `/settings/company`）：概览/成员与角色/项目组列表+新建/**复用 `SsoSettingsTab`**；无公司且 system_admin 显示"设立企业"卡。
- `SettingsSider` 加 `company` 内建项（**仅公司存在且 viewer 是 company-admin 时显示**，图标 `BuildingOne`）。`Router` 加 `/settings/company`。
- `EnterpriseConsole` **删掉「企业认证」(auth) 卡**（迁入企业后台）+ 清理未用 `Mail` 图标。

## 个人单机版零影响（红线）

新列可空/带默认；`setup_company` system_admin 门控 + 一服务器一公司，个人从不调用 → `company==null` → 后台/设置入口隐藏；扩后 `sync_member` 无公司无 tenant_key 即 no-op（个人无 SSO 回调根本不触发）；只新增路由，`org_create`+D3 逐字节保留；`RequireSsoAdmin` 兜底保留 `system_default_user→system_admin`。**锁死测试**：`one-org` 的 `one_server_hosts_only_one_enterprise`/`context_in_personal_edition_is_empty` 保持绿；`one-enterprise` 新增 `sync_member_without_company_is_noop`。

## 验证状态

- 后端：`one-enterprise`(12)/`one-org`(23)/`one-sso`(45) 单测全过；`cargo check -p aionui-app` 通过；clippy 我的代码零告警（仅剩 service.rs:873 一个**既有** `too_many_arguments`，ratchet 不动）。`cargo test --workspace` 兜底跑过。
- 前端：`tsc --noEmit` 0 错、`oxlint` 0 error；**i18n 已补**：`common.company.*`(29 key) 加进 en-US+zh-CN，顺带补齐早前身份修复遗漏的 6 个 key(`common.enterprise.orgIdentity*` / `settings.workspaceIdentity.ssoAuthed/ssoCompanyLine/projectGroupLine`)，`check-i18n` **全绿**（类型同步/配置/校验都过），我改的文件 0 未知 key。
- **真机 CDP 全流程实测通过**（dev + backend-rebuild 后的新 aioncore，`/api/one/enterprise/company` 404→200）：
  1. 个人版红线——client 模式无公司时设置侧栏**无企业管理后台入口**（nav 无 company）；
  2. 切服务器模式→入口出现；
  3. 设立企业→概览(名称/成员1/组0/手动设立)；
  4. **一个公司建两个项目组**(研发组+产品组各得邀请码、成员数0 证明代建空组不入组)；
  5. 成员 tab 操作者=企业管理员；
  6. 企业认证 tab 渲染 SSO 配置(飞书/钉钉/企业微信/LDAP)；
  7. 「项目组管理后台」企业认证卡**已消失**。

### 重编踩坑

`backend-rebuild.ps1` 第2步 `prepareAioncore.js` 内嵌报 exit 1（疑版本校验/文件锁）；cargo build 本身成功（`target/release/aioncore.exe` 已含新代码，grep 二进制有 `enterprise/company`/`COMPANY_ALREADY_EXISTS`），手动 `cp` 到 `1oneUI/resources/bundled-aioncore/win32-x64/aioncore.exe` 即可。另注意：起 dev 前要**杀干净旧 dev 的 electron/aioncore 进程**，否则新 dev 撞单实例锁退出、留旧后端(旧 exe→新路由 404)。

## 顺带修：Windows 尾随空格 workspace 校验 bug（07-18 上游带入的既有 bug）

`cargo test --workspace` 唯一失败 `aionui-conversation::create_rejects_unavailable_workspace_with_trailing_whitespace_in_request` = memory 记录的既有 Windows 平台 bug。根因：`aionui-common::validate_workspace_path_availability`（`error.rs`）用 `fs::metadata` 判可用，但 Win32 在**创建和读取**两端都静默剥掉路径分量末尾的空格/制表/点号，`C:\…\workspace ` 会解析成 `C:\…\workspace`（存在）→ 误判「可用」，而 Unix 上该路径根本不存在→拒绝。
**修法**：加 `#[cfg(windows)]` 前置检查——最终路径分量以空格/制表/点结尾（且不是 `.`/`..`）就返回 `DoesNotExist`（与 Unix 一致，因为 Windows 无法忠实存储这种路径）。并把 `create_accepts_existing_workspace_with_trailing_whitespace_in_name`（在 Windows 上**不可能**创建这种目录）门控为 `#[cfg(not(windows))]`。验证：aionui-conversation 314 全过、aionui-common 81 全过、clippy 干净。

## 后续路线图（企业/团队方向的 P0/P1/P2 代办）

见 [`enterprise-team-roadmap.zh-CN.md`](enterprise-team-roadmap.zh-CN.md)。

**近端待办**：

1. **P0-1 Phase 2 多成员**：`one_user_org` 主键→`(user_id,tenant_id)` + active-tenant 切换（企业管理员成为多组真实成员）——组织模型地基。
2. 打包（用户说不急）：重编+bump 版本出安装包。
3. 其余 11 语言的 `common.company.*` 精翻（当前回退 en/defaultValue，不影响功能）。
