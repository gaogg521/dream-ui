# 企业组织 vs 项目组彻底解耦（one-enterprise 落地）

> **2026-07-20**。执行 `~/.claude/plans/tidy-percolating-allen.md` 方案，把「企业组织（SSO 公司）」与「项目组（邀请码 tenant）」两个此前纠缠在一起的概念彻底拆开。背景见 [`session-2026-07-16-enterprise-tier-and-sso-fixes.zh-CN.md`](session-2026-07-16-enterprise-tier-and-sso-fixes.zh-CN.md)（B2「真实企业」层的原始实现）和 [`session-2026-07-20-post-sync-bug-conflict-audit.zh-CN.md`](session-2026-07-20-post-sync-bug-conflict-audit.zh-CN.md) §2.2（这次重构此前被中断、以 stash 形式休眠的历史）。

## 结论摘要

方案 Part A–F 全部完成并通过验证：新增独立 `one-enterprise` crate 承载「SSO 公司」维度（`one_enterprises` / `one_enterprise_members` 表），`one-org` 的 `one_tenants` 彻底剥离 `sso_provider`/`sso_org_id` 两列回归纯邀请码项目组，`one-sso` 的登录回调改为调用新 `EnterpriseSync` trait 同步企业身份，`aionui-app` 完成装配，1oneUI 前端类型/hook/页面同步改名解耦。

**验证**（真实环境，非仅单测）：

- 1oneCore：`cargo check --workspace` 全绿；`cargo test -p one-enterprise -p one-org -p one-sso -p aionui-auth` 239 个测试全过；`cargo fmt`/`cargo clippy` 在改动的文件里零告警（`one-org`/`one-sso` 里其余告警是改动前就有的，与本次无关，未处理）。
- **真实开发库迁移冒烟**：重编 bundled 后端、起 `bun run dev`，日志实录 `one_org::migrate: ... migration="005_drop_tenant_sso_binding"` 与 `one_enterprise::migrate: ... migration="enterprise_001_init"` 均在**真实持久化 SQLite 库**（非 `:memory:`）上迁移成功——`ALTER TABLE ... DROP COLUMN` 在本机 bundled SQLite 版本上确认可行，方案 Part F 的风险点已用真实环境证据消解。
- CDP 连进 dev 页面确认 UI 无 JS 报错，侧栏身份条正常渲染「客户端 · 连接远端」，`/api/one/enterprise/me` 端到端返回 200。
- 前端：`bunx tsc --noEmit` 零错误；`oxlint` 在改动文件里零新增告警；`node scripts/check-i18n.js` 通过（i18n key 类型定义已用 `bun run i18n:types` 重新生成同步）。

**⚠️ 顺带发现一个预先存在、与本次改动无关的问题**（第二轮已修复，见下方「第二轮」章节）：`cargo test -p aionui-app --test active_lease_e2e` 里 `conversation_active_lease_rejects_missing_csrf` / `team_active_lease_rejects_missing_csrf` 两个测试失败（期望 403 实际拿到 200）。用 `git worktree` 切到改动前的 `282f5c02`（本次工作的起点提交）单独编译验证，**同样失败**——确认是既有问题，不是本次解耦引入的回归。

**E2E 未做**：需要 159 装新包 + 飞书真人扫码登录才能验证「同公司登录自动同步进 one_enterprise_members」的完整链路，本次会话没有这个条件，留给下一次真机验证。项目组邀请码加入/成员表/退出的回归也建议下一次一并人工点一遍（本次因没有现成的多用户/多设备环境，只做了前端渲染层面的冒烟）。

---

## 架构结果

| 维度     | crate                    | 表                                                                      | 语义                      | 接口                                |
| -------- | ------------------------ | ----------------------------------------------------------------------- | ------------------------- | ----------------------------------- |
| 项目组   | one-org                  | `one_tenants`（已去 SSO 绑定列）/ `one_user_org` / `one_tenant_invites` | 纯邀请码协作容器          | `/api/one/org/*` `/api/one/admin/*` |
| 企业组织 | **one-enterprise（新）** | **`one_enterprises` / `one_enterprise_members`**                        | SSO 公司 + 部门/岗位/成员 | `/api/one/enterprise/me`            |

桥接：`one-sso` 的登录回调（`crates/one-sso/src/routes.rs::callback`）在 `resolve_or_provision_user` 之前抓取 `preferred_username`/`org_unit_path`/`job_title`/`org_external_id`，在 `issue_session` 之前调用 `EnterpriseSync::sync_member`（`aionui-app` 里的 `EnterpriseSyncAdapter` 适配到 `one_enterprise::EnterpriseService::sync_member`），全程 best-effort、失败只告警不阻断登录。

## 改动清单

### 1oneCore

- **新增** `crates/one-enterprise/`（完整 crate：`lib/error/migrate/models/service/state/routes.rs` + `migrations/enterprise_001_init.sql`）——直接从中断前的 stash（`wip-enterprise-before-sync-v0148`）里 `git checkout stash@{0}^3 -- crates/one-enterprise` 捞出，未改动。
- **新增** `crates/one-org/migrations/005_drop_tenant_sso_binding.sql`（同样从 stash 捞出）：`DROP INDEX idx_one_tenants_sso_org` + `ALTER TABLE one_tenants DROP COLUMN sso_provider/sso_org_id`。
- `crates/one-org/src/{migrate,models,service}.rs`：注册 005 迁移账本、`TenantRow`/`OrgContextDto` 删除 SSO 相关字段、`OrgService` 删 `auto_provision_enterprise`/`sso_org_binding_for`。这部分应用的是 stash 里已经做好的 diff（`git diff HEAD stash@{0} -- <file> | git apply` 全部干净应用，因为这些文件没被后续同步动过）。
- **本次新做的部分**（stash 里没有，属于中断点之后的收尾）：
  - `crates/one-org/src/service.rs` 测试模块：删掉还在引用已删方法/字段的 8 处测试引用（`auto_provision_enterprise_*` 系列 5 个测试、`create_tenant_binds_the_creators_sso_company`、`create_tenant_leaves_the_binding_null_without_an_sso_identity`、`context_reports_project_group_as_not_sso_bound`），以及 `seed_bound_enterprise`/`seed_sso_identity_with_company` 两个专用测试 helper；`context_in_personal_edition_is_empty` 改写为只断言现存 5 个字段。这是方案文档「⏸️ 恢复状态」里标记的中断点，本次续完。
  - `crates/aionui-app/src/router/routes.rs`（Part D，stash 完全没动过，本次从零写）：
    - 删 `OrgEnterpriseAutoJoiner` adapter，新增 `EnterpriseSyncAdapter` 实现 `one_sso::EnterpriseSync`。
    - 新增 `one_enterprise::run_one_enterprise_migrations(...)` 调用（跟在 one-devops 迁移之后）。
    - 新建 `one_enterprise_service` / `OneEnterpriseRouterState` / `one_enterprise_authenticated` 路由，挂到认证中间件后、merge 进主路由链（CSRF layer 之前）。
    - `one_sso_state` 的 `.with_auto_joiner(...)` 改成 `.with_enterprise_sync(...)`；删除已不存在的 `one_sso_member_routes`（`/api/one/sso/me` 整套已随 stash 的 one-sso 改动一起删除，迁到 `/api/one/enterprise/me`）。
  - `crates/aionui-app/Cargo.toml` / 根 `Cargo.toml`：加 `one-enterprise` 依赖/workspace 成员（手工加两行，没有照抄 stash 里 `Cargo.toml` 的其余漂移内容——stash 基线早于本次同步，版本号/pin 注释等无关差异已跳过，只取新增 crate 那两行）。

### 1oneUI（Part E，stash 完全没动，本次从零写）

- `common/types/org/orgTypes.ts`：`OrgContext` 删 `ssoBound`/`displayName`/`orgUnitPath`/`jobTitle`；`SsoIdentity` 重命名为 `EnterpriseIdentity`（新增 `companyName`/`role` 字段，`companyId` 改为必填——对应后端 `Option<EnterpriseIdentityDto>` 为 `null` 时整个对象都不存在，而不是字段个别缺失）。
- `common/adapter/ipcBridge.ts`：`oneSso.me` → `oneEnterprise.me`，路由 `/api/one/sso/me` → `/api/one/enterprise/me`。
- `common/adapter/httpBridge.ts`：`GOVERNANCE_PATH_PREFIXES` 加 `/api/one/enterprise`（否则客户端模式这个新端点不会走远端代理）。
- `renderer/pages/enterprise/hooks/useSsoIdentity.ts` → `useEnterpriseIdentity.ts`（`git mv` 保留历史，内部改调 `oneEnterprise.me`）。
- `OverviewTab.tsx`：企业组织身份卡片改用新 hook；项目组 `Descriptions` 删掉 `tierTag`（真实企业/项目组分级）和 context 版 `fieldMyName/Department/JobTitle` 三行（这些字段已经不在 `OrgContext` 上，统一改成从独立的「企业组织」卡片展示，不再和项目组信息混在一起）。
- `WorkspaceIdentityEntry.tsx`：版本行（侧栏身份 pill 副标题）不再按 `ssoBound` 区分「企业团队版 / 项目组」，统一为「项目组 / 个人版 / 客户端」——SSO 公司这个维度已经独立到企业组织卡片展示，不再混进这个纯项目组的版本标签里；姓名/部门 fallback 改读 `useEnterpriseIdentity()`。
- i18n（en-US + zh-CN 的 `common.json`/`settings.json`）：删 `tierRealEnterprise`/`tierProjectGroup`/`fieldTenantType`（三个 key 代码里已无引用）；`editionEnterprise`/`editionProjectGroup` 二选一，删 `editionEnterprise`（代码只剩 `editionProjectGroup` 分支）；`fieldMy*`/`orgIdentity*`/`departmentLine` 保留（企业组织卡片还在用）。跑过 `bun run i18n:types` 重新生成类型定义。

## 关于 `UserOrgRow` 的姓名/部门快照（刻意保留，未动）

方案原文明确说了这是刻意决定：项目组成员管理表（`UsersTab`）显示成员真名/部门用的是 `UserOrgRow.display_name/org_unit_path/job_title`——这是项目组自己在成员加入时拍的快照，跟「SSO 驱动 tenant」的坏耦合是两码事，盲删会伤 UX。本次严格遵照，一个字节没动。

## 遗留 / 下一步

1. **真机 E2E**（需要 159 装新包 + 飞书扫码）：验证赵高登录 → `/api/one/enterprise/me` 返回他的公司 + 姓名（部门待飞书通讯录权限）；项目组页只讲项目组，两者独立展示互不影响。
2. **回归**：项目组邀请码加入 / 成员表（`UsersTab` 真名部门列）/ 退出，人工过一遍确认没被这次拆分动到。
3. ~~顺带发现、本次未修的既有问题：`active_lease_e2e.rs` 里两个 CSRF 拒绝测试失败~~ → **已在第二轮修完，见下方 §第二轮**。
4. 未打包发布，未 bump 版本号——纯代码改动+本机 dev 验证阶段。

---

## 第二轮：用户真机点出的 3 个问题（同日续）

用户拿着真实企业客户端截图（团队会话报错、设置页入口、飞书登录后卡死）当场问了 3 件事，逐一排查如下。

### 问题 1：团队 Leader「未能启动 / Provider not found」——不是 bug

`TeamWarmupOverlay.tsx` 的"精简报错 + 切换模型重试"卡片是专门为"团队成员绑定的 provider 被删"这个场景做的防护性 UI（跟 07-15 那次历史会话引用已删除 Provider 是同一类）。截图里的 provider id 在本次会话反复重编/重启 dev 时被 churn 掉了，属于开发环境噪音，不是这次改动引入的问题。

### 问题 2：入口没拆开——真的没做完，本轮补上了（方案 A+B）

`OverviewTab`/`WorkspaceIdentityEntry` 之前只做了字段/类型层面的解耦，**没有动导航结构**——设置里只有一个「企业」菜单把部署模式/远端连接/SSO 登录/邀请码全挤在一起。给用户出了 A（内容分区）/B（拆两个菜单项）/C（真正独立的本地 SSO 登录路径，需要产品决策）三个方案，用户选了「A+B 一起做」。

落地：

- 新建独立组件 `pages/enterprise/components/EnterpriseIdentityCard.tsx`（只读展示 SSO 公司身份，从 `OverviewTab` 抽出来的原 `orgIdentitySection` 内容）
- 新建独立设置页 `pages/settings/EnterpriseIdentitySettings.tsx` + 路由 `/settings/enterprise-identity`
- `SettingsSider.tsx` / `SettingsPageWrapper.tsx`：`BUILTIN_TAB_IDS` 加 `enterpriseIdentity`（`IdCard` 图标），与原有 `enterprise`（现在纯粹是"项目组"内容）并列显示在"应用"分组下
- `OverviewTab.tsx` 彻底删除 `orgIdentitySection`/`useEnterpriseIdentity` 引用，回归纯项目组内容（部署模式/邀请码加入创建/退出）
- i18n：新增 `identityTabTitle`/`identityError`/`identityEmpty`；`orgIdentityTitle` 已无引用一并删除；`orgIdentityHint` 措辞从"与下方项目组"改成"与项目组"（不再是同页上下关系）
- 侧栏左下角「登录/加入项目组」入口**保持不变**——登录本身还是同一个物理动作，只是设置页里的落点数据边界现在清楚了

CDP 实测（真实 dev 环境）：`/settings/enterprise` 只讲项目组内容，零企业身份混入；`/settings/enterprise-identity` 独立展示「尚未通过企业 SSO 登录」空状态；侧栏正确显示"项目组"+"企业身份"两个并列菜单项；全程零 JS 报错。

### 问题 3：飞书登录后所有本地功能卡死——真 bug，已修复并验证

**根因**：`httpBridge.ts` 有两套路由逻辑。`resolveRequestBaseUrl`（`httpGet`/`httpPost` 用）正确地只把 `/api/one/*` 治理路径转发到远端；但 `getBaseUrl()`——**没有任何路径判断**，只要 `isEnterpriseModeEnabled()`（用户点了"连接远端项目组服务器"）为真就把一切请求都指向远端——被 6 处**本该永远留在本地**的调用点直接引用：

- `FileService.ts`（文件上传 `/api/fs/upload`）
- `SpeechToTextService.ts`（语音转文字 `/api/stt`）
- `DirectorySelectionModal.tsx`（目录浏览 `/api/fs/browse`）
- `WeixinConfigForm.tsx`（微信登录二维码 `/api/channel/weixin/login`）
- `OfficeWatchViewer.tsx`（Office/PPT 预览代理）
- `platform.ts` 的 `resolveBackendAssetUrl`（**几乎全站图标/头像资源 URL**都走这个）

这完全违反了这份代码自己写的"D1 本地优先"设计原则（该原则的正确实现在同文件的 `resolveRequestBaseUrl`/`routesToRemote` 里，只是没被这几个调用点使用）。**修法**：全部改成 `getLocalBaseUrl()`（不含任何远端判断，恒本地）。顺带修了 `EnterpriseLoginChannelPanel.tsx` 里一个次要的同类隐患（无 `remoteOrigin` 时的 fallback 也从 `getBaseUrl()` 换成 `getLocalBaseUrl()`，并把 `??` 改成 `||` 以正确处理空字符串边界）。

验证：`bunx tsc --noEmit` 零错误；`oxlint` 零新增告警（7 条全是这些文件本来就有的无关代码风格提示）。

### 顺带清理：CSRF 中间件的 Bearer 豁免（M4d，`c6f65e38`）导致的整批测试断言过期

排查问题 1 时顺手把 `cargo test -p aionui-app` 完整跑了一遍，陆续挖出 **6 个** 断言"Bearer 认证但没带 CSRF token 应该 403"的测试——但 M4d 早就把这条规则改成"Bearer 请求豁免 CSRF"（远端桌面客户端要用），只是这几个测试当时没跟着更新：

- `active_lease_e2e.rs`：`conversation_active_lease_rejects_missing_csrf` / `team_active_lease_rejects_missing_csrf`
- `agent_integration_e2e.rs`：`agent_logos_endpoint_returns_backend_to_logo_catalog`（另一类问题：断言的是老品牌 `aion.svg`，但很早的品牌迁移 021 早就把种子数据换成 `1one.png` 了）
- `agent_provider_health_e2e.rs`：`provider_health_check_requires_csrf_for_post`
- `auth_e2e.rs`：`t12_2_csrf_blocks_post_without_token`
- `team_e2e.rs`：`sm1d_team_send_rejects_missing_csrf`

**修法**：统一拆成两个测试（照抄 `acp_config_options_e2e.rs` 里已有的正确写法）——`_allows_bearer_without_csrf`（断言不是 403，能拿到明确的业务响应）+ `_requires_csrf_for_cookie_auth`（真正用 cookie 认证 + 无 CSRF token，断言 403/`CSRF_INVALID`）。之前用 `git worktree` 切到起点提交 `282f5c02` 验证过 `active_lease_e2e.rs` 那两个确实是改动前就有的既有问题，不是本次解耦引入的回归。

修完后 `cargo test -p aionui-app` 完整跑了 3 遍，43 个测试二进制、**0 failed**。

### 验证方式（本轮，真实 dev 环境）

- `cargo test -p aionui-app`：0 failed（3 次完整跑，含本轮所有测试改动）
- `cargo fmt --all -- --check` / `cargo clippy -p aionui-app`：改动文件零告警
- 前端：`bunx tsc --noEmit` 零错误；`oxlint`/`oxfmt` 零新增问题；`bun run i18n:types` + `check-i18n.js` 通过
- **真机 CDP 冒烟**（`bun run dev` 起真实开发库，非仅单测）：`/settings/enterprise`、`/settings/enterprise-identity`、`/settings/model`、`/settings/agent`、`/settings/capabilities`、`/settings/webui`、`/settings/system` 逐个点过，侧栏身份下拉菜单点过，全程 **zero page errors, zero console errors**

---

## 第三轮：用户要求「全局测试」（同日续）

用户直接问"现在做全局测试看看还有没有 bug"。跑法：`cargo test --workspace`（1oneCore 全部 crate）+ `cargo clippy --workspace` + 前端全量 `tsc`/`oxlint`/`oxfmt` + CDP 把近 20 个真实路由逐个点过（含设置全部子页、会话首页、定时任务、超级助手、我的技能、MCP 服务、记忆管理、team、assistants、enterprise/login、enterprise/console）+ 实际发一条聊天消息验证核心链路。

### 发现 1：`pages/memory/index.tsx` 表格列 React duplicate-key 告警（已修复）

CDP 冒烟时"记忆管理"页面控制台出现 4 次 `Encountered two children with the same key` 警告。定位到 `memoryColumns` 定义里"类型"列和"描述"列**都用 `dataIndex: 'content'`**（两列都是从同一个原始 `content` 字段派生展示值，一个走 `getType()`，一个走 `getDesc()`），Arco Table 没有显式 `key` 时会拿 `dataIndex` 兜底当 key，两列因此撞了。加显式 `key: 'type'` / `key: 'desc'` 修复，CDP 复测确认 0 告警。跟本次企业解耦无关，是纯粹顺手抓到的既有小问题。

### 发现 2：`aionui-conversation` 一个测试在 Windows 上必现失败（**未修复，本次范围外**）

`cargo test --workspace` 跑出**唯一**一个失败：`service_test::create_rejects_unavailable_workspace_with_trailing_whitespace_in_request`（`aionui-conversation` crate）。单独重跑（`--test-threads=1` 隔离）依然稳定失败，不是并发/顺序导致的偶发 flaky。

**根因已查清**：测试构造一个真实存在的目录 `.../workspace`，然后拼一个**带尾随空格**的路径字符串 `.../workspace ` 传给 `create()`，期望后端的 `validate_workspace_path_availability`（`crates/aionui-common/src/error.rs:242`）识别出这个路径"不存在"从而拒绝。但该函数只是直接 `fs::metadata(Path::new(workspace))`——**Win32 API 会在文件系统层面静默剥掉路径每个分量末尾的空格和点号**（这是 Windows 数十年的老行为，`\?\` 逐字前缀才能绕过），所以 `fs::metadata(".../workspace ")` 在 Windows 上实际解析到的是那个真实存在、不带空格的目录，`metadata()` 成功返回 `is_dir()=true`，函数因此判定"可用"而不是按测试预期的"不可用"报错。Linux/macOS 上尾随空格是文件名的合法组成部分（不会被剥掉），所以这条校验在类 Unix 系统上行为正确，只在 Windows 上失效。

**溯源**：这个测试是 07-18 上游同步（commit `3634e5b8`）带进来的，跟今天的企业解耦、Bug1/2/3、CSRF 测试清理都**完全无关**——大概率上游是在 Linux/macOS CI 上开发验证的，没有在 Windows 上跑过。

**为什么本次没有直接修**：这不是"过期的测试断言"（能直接改断言了事），而是 `aionui-common`（基础层 crate，被几乎所有上层 crate 依赖）里一个真实的跨平台校验缺口——Windows 上传入带尾随空格/点号的 workspace 路径不会被这层校验拦下来。修复需要在 `validate_workspace_path_availability` 里补一个跨平台一致的显式检查（比如 `workspace.trim_end_matches(['.', ' ']) != workspace` 直接判不可用，不依赖 `fs::metadata` 的操作系统语义），这是对基础 crate 校验逻辑的行为改动，影响面比今天的企业解耦任务大，按项目规范（AGENTS.md 对 foundation crate 改动要求先评估影响面）留到下一轮单独处理，不在本次顺手改。

### 验证结果汇总（第三轮）

- `cargo test --workspace`：除上述 1 个既有平台差异问题外**全绿**（`aionui-app` 单独验证过 314+ 测试全过；其余各 crate 均 `0 failed`）
- `cargo clippy --workspace`：11 个既有告警（`one-org`/`one-devops` 的 `too_many_arguments`、`one-sso` 的 dingtalk/wecom `dead_code`、`one-employee` 的 `redundant_closure`/`unnecessary_cast`），**0 error**，均与本次改动无关
- 前端：`bunx tsc --noEmit` 零错误；`oxlint` 全量扫描 833 警告 + 1 错误（与今日改动前基线完全一致，未新增）；`oxfmt --check .` 21 个格式问题全是本次未触碰的既有文件（含多篇历史 session 文档）
- **CDP 真机冒烟（近 20 个路由 + 1 次真实发消息）**：guid / scheduled / super-assistant / skills / mcp / memory / sessions / settings 全部子页（model/agent/capabilities/appearance/webui/enterprise/enterprise-identity/system/about）/ assistants / team / enterprise-login / enterprise-console，全程 **zero page errors**；发送一条真实聊天消息，成功创建新会话并进入"正在处理中"状态，核心链路无异常
