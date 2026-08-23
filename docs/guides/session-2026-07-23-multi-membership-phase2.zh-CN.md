# 多成员模型（方向 B / Phase 2）— 一人多项目组 + active-tenant 切换

**日期**：2026-07-23
**状态**：三仓源码全部改完，one-org/one-sso/one-enterprise/one-devops 单测全绿 + 前端 tsc/oxlint/check-i18n 全过；**真机 CDP 验证 + 打包待做**（见文末）。
**上下文**：承接 [Phase 1（企业三层）](session-2026-07-22-company-tier-direction-b.zh-CN.md)。Phase 1 用「代建空组、不动 `one_user_org` 主键」绕过了「一人一项目组」约束；Phase 2 正式放开组织模型地基——`one_user_org` 主键 `user_id` → 复合 `(user_id, tenant_id)`，引入 **active-tenant（当前作用项目组）**，RBAC / 团队资源解析都按激活组走，前端徽标加切换器。**红线不变：个人单机版零影响。**

## 核心设计抉择：active-tenant 服务端按用户存储

`tenant_of(user_id)` / `effective_role(user_id)` 被大量「只有 user_id、无请求上下文」的调用点使用（one-org rbac 的 `OrgActor`、跨 crate 的 one-sso `effective_role`、one-enterprise `caller_is_system_admin`、one-devops `user_org_role`、one-employee 的 `TenantResolver::tenant_of`）。所以 active-tenant **必须能从 user_id 单独解析** → **服务端按用户存一份**（新表 `one_active_tenant`）。

好处：这些签名**全不变**，只是语义从「返回唯一组」变成「返回激活组」；`OrgActor`（rbac.rs）**完全不用改**；`OrgTenantResolver` / team 资源 scoping **自动跟着变**（它们调的就是 `OrgService::tenant_of`）。切换 = 服务端写（`POST /api/one/org/switch`），**不走 header、不轮换 JWT**（token 只带 user_id，每请求服务端重解析），下一请求即生效。

## 后端改动（1oneCore）

### 迁移 `one-org/migrations/007_multi_membership.sql`（one-org 首个表重建迁移）

1. **重建 `one_user_org`**：新表 PK `(user_id, tenant_id)`（列与 001+002+003 逐列一致）→ `INSERT ... SELECT` 拷贝 → `DROP` 旧 → `RENAME` → 重建 `idx_one_user_org_tenant`。SQLite ≥3.35（早已在用 ALTER ADD/DROP COLUMN）。migrator 单事务包裹，启动期 `foreign_keys` OFF，重建不触 `one_tenant_invites` FK。
2. **新表 `one_active_tenant(user_id PK, tenant_id NOT NULL, updated_at)`**（每用户一个激活组）。
3. **回填**：`INSERT OR IGNORE INTO one_active_tenant SELECT user_id, tenant_id, updated_at FROM one_user_org`（现有单成员各自成为激活组，行为逐字节不变直到有人加第二个组）。
   `migrate.rs` `MIGRATIONS` 追加 `007_multi_membership`；幂等测试断言 `one_active_tenant` 也存在。

### one-org [service.rs](../../../1oneCore/crates/one-org/src/service.rs)

- **新 `active_tenant_id(user_id)`**：解析顺序 = `one_active_tenant` 指针（须仍是该组成员，用 JOIN 过滤掉 `leave` 留下的悬空指针）→ 该用户最近加入的任一成员组 → `DEFAULT_TENANT_ID`。**只读、绝不修指针**（join/switch/leave 才写），所以个人版（无成员行、`one_active_tenant` 空）恒零写解析到 default。
- **`membership(user_id)` 改为返回激活组的成员行**；新私有 `membership_row(user_id, tenant_id)`。`effective_role` 因调 `membership` **自动跟随激活组**（未改函数体）。`tenant_of` 改为直接调 `active_tenant_id`。
- **新 `list_memberships(user_id) -> Vec<MyTenantDto>`**（tenant 名 / 角色 / 成员数 / `is_active`，for `myTenants`）。
- **新 `set_active_tenant(user_id, tenant_id)`**：校验是该组成员否则 `NotInEnterprise`；upsert 指针；**不轮换 JWT**。
- **`join_with_invite`**：删「已在任一企业则拒绝」总闸 → 改「已在**该组**则拒绝」（幂等且不烧邀请次数）；INSERT `ON CONFLICT(user_id, tenant_id)`；**加入后把新组设为激活**（同事务）。
- **`leave(user_id, tenant_id: Option<&str>, exit_code)`**：`tenant_id=None` 退激活组；`DELETE ... WHERE user_id=? AND tenant_id=?`（scoped，多组只退指定组）；`ensure_not_last_admin` 沿用（本就按 tenant scoped）；退的是激活组则 `reselect_active_after_leave`（重指最近的其余组，无则删指针回落 default）。
- **`create_tenant`（standalone D3）保留**；仅把 `ON CONFLICT(user_id)` 改 `ON CONFLICT(user_id, tenant_id)` + 建者设激活组。
- **`create_tenant_for_enterprise`**：删掉「初始管理员已属某组则拒绝」的 PK 防护（复合 PK 下一人可跨多组，防护已过时；新组 tenant_id 全新，plain INSERT 不撞 PK）。
- `reset_local_enterprise` 额外 `DELETE FROM one_active_tenant`。

### one-org [rbac.rs] — **不改**（`OrgActor` 调 `tenant_of`/`effective_role` 自动得激活组）。

### one-org [routes.rs](../../../1oneCore/crates/one-org/src/routes.rs)

- 新 `GET /api/one/org/my-tenants` → `list_memberships`。
- 新 `POST /api/one/org/switch {tenantId}` → `set_active_tenant` + 返回刷新后的 `context`。
- `org_exit` 的 `ExitBody` 加可选 `tenantId`（默认退激活组）。

### 三处跨 crate 直读 `one_user_org.role WHERE user_id`——各自改「按激活组解析」

one-sso `effective_role`、one-enterprise `caller_is_system_admin`、one-devops `user_org_role`：从 `SELECT role FROM one_user_org WHERE user_id=?`（多成员下返回任意行）改为单条 SQL——

```sql
SELECT uo.role FROM one_user_org uo WHERE uo.user_id = ?
ORDER BY (uo.tenant_id = (SELECT tenant_id FROM one_active_tenant WHERE user_id = uo.user_id)) DESC,
         uo.created_at DESC, uo.tenant_id ASC LIMIT 1
```

激活组行排最前，否则最近加入；单 bind，保留各自原 `None → system_default_user / 表缺失` fallback。**同层 crate 不能互依赖，沿用「复制这段解析」的既有模式。**

### one-employee / one-devops team 资源——**不改**（`TenantResolver::tenant_of(user_id)` 经 `OrgTenantResolver` → `OrgService::tenant_of` 自动得激活组）。

## 前端改动（1oneUI）

- 类型 `orgTypes.ts`：新 `MyTenant`（mirror `MyTenantDto`）。
- ipcBridge `oneOrg`：新 `myTenants` / `switchTenant`；`exit` 加可选 `tenantId`。
- 新 hook `useMyTenants`（listen 同一 `ORG_CONTEXT_CHANGED_EVENT`，个人版解析为空列表 → 切换器不渲染）。
- `WorkspaceIdentityEntry`（侧栏徽标下拉）：项目组块从单行「项目组：{name}」→ **多成员时** `Menu.ItemGroup`「我的项目组」列表（激活项打勾、点击切换）；单成员仍单行；切换成功 `dispatch ORG_CONTEXT_CHANGED_EVENT` → `useOrgContext`/`useMyTenants` 自动 refetch，徽标 / 版本标签 / 下游团队资源全跟随。
- i18n：`settings.workspaceIdentity.myGroupsTitle` / `switchDone`（en-US + zh-CN，check-i18n 全绿）。

## 个人单机版零影响（红线）

无成员行 → `active_tenant_id` 回落 `default`、`effective_role` 走 `system_default_user → system_admin`；`one_active_tenant` 对个人恒空、零写；只新增表 / 列 / 端点，`create_tenant`+D3 逐字节保留；三处跨 crate fallback 原样。**锁死测试保持绿**：`context_in_personal_edition_is_empty`、`one_server_hosts_only_one_enterprise`、`reset_local_enterprise_*`、新增 `active_tenant_defaults_when_no_membership`；Phase 1 的 `sync_member_without_company_is_noop` 不受影响。

## 验证状态

- **后端单测全绿**：one-org 28（新增 `join_second_group_auto_activates_and_lists_both` / `switch_active_tenant_changes_resolution` / `effective_role_follows_active_tenant` / `leave_active_group_reselects_remaining_and_is_scoped` / `active_tenant_defaults_when_no_membership`；改 `create_for_enterprise_seeds_initial_admin_across_multiple_groups`）、one-sso 46（新增 `effective_role_scopes_to_active_tenant`）、one-enterprise 12、one-devops 23。三个跨 crate 测试 setup 补建了 `one_active_tenant`（否则相关子查询因表缺失报错、one-devops 还会被「no such table」兜底误判为 standalone）。
- clippy：我的改动零新增告警；surfaced 的都是**既有**未触碰文件（one-org `heartbeat_runtime_node` too_many_args、one-sso dingtalk/wecom serde 字段 never-read、one-sso rbac collapsible_if、one-employee 3 处），ratchet 不动，push 用 plain `git push`。
- `cargo check -p aionui-app` 通过（composition 层照旧编译）。
- 前端：`i18n:types` / `tsc --noEmit`（0 错）/ `oxlint`（改动文件 0/0）/ `check-i18n`（通过，我的 key 解析成功）。

## 待办（真机 + 发版）

1. **真机 CDP 验证**：dev 服务器模式建两个项目组、同一用户加入两个 → 徽标切换器切换 → 确认成员 / 团队技能 / 看板随激活组变；个人装机徽标无切换器、行为不变。
2. 打包（用户说不急）：`backend-rebuild.ps1` 重编 aioncore（Phase 1 的坑：第 2 步 `prepareAioncore.js` 若 exit1 就手动 `cp target/release/aioncore.exe → bundled/win32-x64/`；起 dev 前杀干净旧 electron/aioncore）→ bump 版本出安装包。
3. 其余 11 语言 `settings.workspaceIdentity.myGroupsTitle/switchDone` + `common.company.*` 精翻（当前回退 en/defaultValue）。

## 关联

- 前置 [[session-2026-07-22-company-tier-direction-b.zh-CN.md]]（Phase 1 三层地基）
- 路线图 [enterprise-team-roadmap.zh-CN.md](enterprise-team-roadmap.zh-CN.md)（P0-1 即本轮）
