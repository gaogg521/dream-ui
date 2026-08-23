# 2026-07-13 企业「本机作为客户端」页 6 个 BUG 修复

> 用户在客户端页测试企业加入流程报的一组一致性缺陷。前端 `1oneUI` + 后端 `1oneCore`（`one-org`/`one-sso` crate）跨仓改动。**未打包**。

## 架构前提（先读，别照旧认知）

- **两套机制别混**：
  - ①**部署角色** `useDeploymentRole`（`hooks/enterprise/useDeploymentRole.ts`）：`configService` 存 `webui.deploymentRole` + `webui.enterpriseServerUrl`。`persistDeploymentConfig('client', url)` 保存时**已顺带** `setEnterpriseServerUrl(normalized)` 喂给机制②。
  - ②**企业远端模式** `enterpriseMode`（`common/adapter/enterpriseMode.ts`，localStorage 存 enabled/url/session）：`httpBridge` 读它决定路由。
- **httpBridge 是 D1 local-first**（`common/adapter/httpBridge.ts` 的 `GOVERNANCE_PATH_PREFIXES` / `routesToRemote`）：**只有** `/api/one/org|admin|sso|devops` 走远端，会话/agent/技能/个人数据全部走本地 co-located 后端。→ 所谓"连接后本机数据不显示"是**文案撒谎**，不是真行为。

## 6 个 BUG 根因 + 修法

| #   | 现象                                                             | 根因                                                                                                      | 修法（文件）                                                                                                                                                                                                      |
| --- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 客户端页服务器地址要填两处                                       | 部署卡片 + RemoteServerSection 各一个地址框，实为同一地址（部署卡片已喂给 enterpriseMode）                | 地址只在部署卡片填一次；`RemoteServerSection.tsx` 删除自己的 Input，改读 `useDeploymentRole().normalizedServerUrl`，只留连接/登录/状态；空地址提示去上方填                                                        |
| 2   | 加入成功却弹红"加入失败"（ALREADY_IN_ENTERPRISE / INVALID_CODE） | `handleJoin` 把任何抛错当失败。但已是成员（SSO JIT/二次请求）或单次码被首个成功请求耗尽都意味着**已加入** | `OverviewTab.tsx` handleJoin：这两个码时**回查 `oneOrg.context`**，若 `isEnterprise` 判为成功（提示"您已加入该企业"+刷新），真·无效码仍报错                                                                       |
| 3   | "当前使用远端数据/本机会话不显示"吓人且错误                      | 文案与 local-first 架构矛盾                                                                               | 改写 `RemoteServerSection.tsx` 文案 + `locales/{zh-CN,en-US}/common.json` 的 `remoteActiveTitle/Hint`、`remoteEnableWarning`、`remoteHint`、`remoteDisable*`、`remoteEnableTitle`：本机数据照常，仅治理来自服务器 |
| 4   | 客户端成员看不到成员/邀请码（现只有"概览"）                      | `index.tsx` `showAdminTabs` 客户端恒 false；列表接口要管理员                                              | 后端加成员只读端点；前端加只读 tab                                                                                                                                                                                |
| 5   | SSO 飞书配置保存后信息丢/被整体覆盖                              | 后端 `upsert_provider` 整体替换 config + 前端每次强制全必填（密钥不回显→永远补不齐）                      | 后端改**按键合并**；前端**已配置时跳过全必填**                                                                                                                                                                    |
| 6   | 后台 URL `/#/enterprise/console` 被弹到个人 /guid                | 非管理员时 `Navigate to '/guid'` 静默跳走                                                                 | 改为渲染「需要管理员权限」提示页 + 切换账号(先 logout 再去 /login)/返回首页                                                                                                                                       |

### BUG4 后端细节

- `one-org/src/routes.rs`：新增 `GET /api/one/org/members`、`GET /api/one/org/invites`，用 `OrgActor`（任意角色）+ `is_enterprise_tenant_id` 守卫（非企业→`NotInEnterprise`），复用 `service.list_users/list_invites`。路径属治理→客户端模式自动走远端。
- `ipcBridge.ts` `oneOrg` 新增 `members`/`invites`（`httpGet`）。
- `UsersTab.tsx` / `InvitesTab.tsx` 加 `readOnly?: boolean`：readOnly 时数据源改用 `oneOrg.members/invites`，隐藏角色 Select / 生成表单 / 作废按钮（用条件 spread 保留列定义、不产生未用变量）。
- `index.tsx`：`showMemberReadonlyTabs = isDeploymentClient && context?.isEnterprise`，渲染只读「成员」「邀请码」两 tab；管理员全套 tab 逻辑不变。
- **安全取舍**：普通成员可读本租户邀请码——用户已确认接受（成员可转发邀请码）。

### BUG5 后端细节

- `one-sso/src/service.rs`：新增 `merge_config(existing, incoming)`，把传入 config 的键覆盖到现有 JSON object 上（未传的键保留，尤其密钥）；`upsert_provider` 的 UPDATE 分支改用它。前端 `SsoSettingsTab.tsx` `handleSave` 的全必填校验加 `&& !status?.configured`（仅首次强制）。

## 复用点

`isBackendHttpError`/`BackendHttpError`（httpBridge）、`useDeploymentRole`、`useOrgContext`+`ORG_CONTEXT_CHANGED_EVENT`、`OrgActor`（one-org/rbac.rs）、`service.list_users/list_invites`、`useAuth().logout`（AuthContext）。

## 验证

- 单测：`cargo test -p one-org`（10 passed）、`cargo test -p one-sso`（25 passed，含新增 `merge_config_keeps_untouched_fields`/`merge_config_from_empty_existing`）。
- 前端：`bunx tsc --noEmit`（0 error）、`oxlint`（0 warn/err）、`bun run i18n:types` + `check-i18n`（passed）。
- 后端重编：`cargo build -p aionui-app --release` + `AIONUI_BACKEND_LOCAL_PATH=... node scripts/prepareAioncore.js` 落地 bundled；`bun run dev` 起桌面（后端端口动态，本轮 63692，local 模式 operator=system_admin）。

### 实测结论（桌面端 CDP，2026-07-13）

- **BUG4 后端**（直连后端 HTTP）：无企业时 `/api/one/org/members` → `NOT_IN_ENTERPRISE`（bad-path）；建企业后 `/members` 返回 1 成员、`/invites` 空→建码后返回该码 ✓。
- **BUG5 后端**（黑盒判据）：飞书存全量→`configured:true`；仅传 `{appId}` 部分更新后**仍 `configured:true`**（`has_minimal_config` 要 appId+appSecret 双非空）⇒ 密钥在部分更新中存活 ✓。
- **BUG1/3/4 前端**（切 client 模式渲染）：客户端页仅一个"企业服务器地址"输入框，"连接远端"区服务器地址是只读文本复用之 ✓；文案改为"本机数据仍在本地，仅企业治理来自服务器" ✓；tab 仅"概览/成员/邀请码"，审计/运行时/SSO 隐藏 ✓；成员 tab 无角色 Select/操作列、邀请码 tab 无生成表单/作废按钮，数据经新只读端点加载 ✓（对比 server+admin 模式全 6 tab、有管理操作，无回归）。
- **BUG2/BUG6**：逻辑 + 静态校验通过；运行时未能构造"已是成员再点加入"与"非管理员浏览器打开 console"场景（local 模式恒为 system_admin、单机无第二成员），依赖代码走查 + 相关端点（`oneOrg.context`）可用性 + admin 路径 console 正常渲染（无回归）。**建议双机/真成员环境补验这两项。**
- 测试用的临时企业已 `reset-local` 归档清空、deploymentRole 恢复 server，dev DB 干净。

## 踩坑

- **`backend-rebuild.ps1` 用 PowerShell 工具 + `*>&1 | Tee-Object` 会在第一行 cargo stderr 进度就 NativeCommandError 中止**（`$ErrorActionPreference='Stop'` + stderr 合流）。改用 **Bash 直接 `cargo build -p aionui-app --release`** 再手动跑 `prepareAioncore.js`（`AIONUI_BACKEND_LOCAL_PATH=target/release/aioncore.exe`）落地 bundled。

## 追加 BUG7-9（用户二轮：主动排查企业登录链发现）

| #   | 现象                                         | 根因                                                                                                                             | 修法（文件）                                                                                                                                                                                                                    | 实测                                                                           |
| --- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 7   | 服务器模式下"创建企业"和"加入企业"同时出现   | `OverviewTab` 加入表单无条件显示，仅创建按 `isDeploymentServer` 门控                                                             | 新增 `showJoinEnterprise=isClient`；加入仅客户端、创建仅服务器；删冗余 divider/clientHint，加 `joinModeHint`                                                                                                                    | CDP：server 只创建/client 只加入 ✓                                             |
| 8   | 左下角"WebUI 管理员登录"登录后落到个人 /guid | WebUI `LoginPage`(91/168) + `Router`(/login) **硬跳 /guid 忽略 `redirect`**；`openWebuiAdminLogin` 默认还是 /guid                | 新增 `resolveSafeRedirect`(navigation.ts，校验内部路径防开放重定向)；LoginPage 读 `?redirect`；Router 抽 `LoginRoute` 认证后按 redirect 跳；`openWebuiAdminLogin` 默认 `/enterprise/console`；WorkspaceIdentityEntry 传 console | CDP：`?redirect=/enterprise/console`→console、无参→/guid、`//evil.com`→/guid ✓ |
| 9   | 客户端成员视图泄漏本地 console URL           | `OverviewTab` adminConsoleUrl effect 异步竞态：deploymentLoading true→false 期间 `resolveLocalAdminUrl().then` 迟到回填覆盖 `''` | effect 加 `disposed` 清理标志，hideLocalAdmin 时不被迟到 promise 覆盖                                                                                                                                                           | CDP：client+企业视图无 `enterprise/console` URL、无后台按钮 ✓                  |

产品规则（用户定）：**服务器模式=创建企业，客户端模式=加入企业**，二者互斥。

## 追加 BUG10-11（用户三轮：继续沿链扫）

| #   | 现象                                                | 根因                                                                                                                        | 修法（文件）                                                                                                                                                                                                        | 实测                                                                                |
| --- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 10  | 切客户端/服务器时"连接远端"卡片显示不变，像"没改好" | 部署单选是**待保存本地状态**，而 RemoteServerSection/tab 读**已持久化**角色 → 切 radio 不 save 则页面其余不动，两态看着一样 | `EnterpriseDeploymentModeCard` 改**切换即生效**：radio onChange 直接 `applyRole`（带 demote/block 守卫，取消则回退 radio）；客户端地址改为单独「保存地址」按钮，且**切客户端不再强制先填地址**（地址→连接时才需要） | CDP：server→client 切 radio(不save)远端卡片即现、持久化角色即变；切回 server 即隐 ✓ |
| 11  | 切主题后选中项文字随主题变、低对比看不清            | 选中 radio 文字用主题色（深色下 `rgb(78,89,105)` 低对比）                                                                   | `arco-override.css` 加 `.enterprise-deploy-role .arco-radio-button.arco-radio-checked{color:rgb(var(--success-6));font-weight:600}`（注意 Arco 选中类是 `arco-radio-checked` 不是 `arco-radio-button-checked`）     | CDP：选中项深色 `rgb(39,195,70)`/浅色 `rgb(0,180,42)`，两主题都绿 ✓                 |

**BUG8 是 BUG6 同源根**：WebUI 登录链一直忽略 `redirect`，所有"登录后回某页"入口都错落 /guid，已一并根治+堵开放重定向。

## 提交 / 推送（已完成）

- 1oneCore `130bc9a6` → one-main（one-org 只读端点 + one-sso merge_config）
- 1oneUI `90cc95980` → one-main（BUG1-11 全部改动 + session 文档 + `bun run format` 顺带格式化）

本机没装 `just`（PATH 找不到），手动跑等价 gate 替代 `just push`：

- 1oneCore：`cargo fmt --all -- --check`（既有格式漂移，全在我未碰的其他 crate，非本次引入）+ `cargo clippy -p one-org -p one-sso -- -D warnings`（clippy 报的 dead_code 在 `wecom.rs`，与本次改动无关）+ `cargo test -p one-org -p one-sso`（全过）。
- 1oneUI：`bun run lint -- --quiet`（0 error）+ `bun run format`（顺带格式化 4 个改动文件，纳入提交）+ `bunx tsc --noEmit`（0 error）+ `check-i18n`（通过）+ `bun run test`：跑出 5 个失败，排查后：
  - **2 个是我的真回归**：`EnterpriseDeploymentModeCard.dom.test.tsx` 断言旧的"选 radio→点保存"两步流程，被 BUG10 的"切换即生效"改没了全局保存按钮。按测试规则（需求确实变了）更新了这两个测试的断言，不回退行为。
  - **3 个是预存问题**：`useConversationAssistants.dom.test.ts`(×2) / `useDetectedAgents.dom.test.ts`(×1) 与企业代码无交集，单独跑仍失败，且这两个测试文件最后一次改动是几个提交前的 `feat(desktop): brand 1ONE CLI...`——与本轮无关，未处理，留给后续排查。

未打包。

## 后续排查：3 个预存失败测试（已解决，2026-07-14）

根因：`7cef2d28e`（品牌改名）给 `buildAssistantEditorBackends` 加了 `agent.agent_type === 'aionrs' ? '1ONE CLI' : ...` 的硬编码改名分支，后续上游合并 `2aa06d9de` 把这段逻辑替换回了朴素的 `agent.name_i18n?.[localeKey] || agent.name`（用户手动决定的合并取舍，非误删）；同期 `isAionrsAssistant` 也从判断顶层字段改成判断 `assistant.agent.type === 'aionrs'`。两个测试文件的断言/fixture 停留在改动前的旧行为，不是代码回归。

修法：更新测试断言与 fixture 以匹配当前行为（`useDetectedAgents.dom.test.ts` 期望值改回 `name_i18n` 解析结果；`useConversationAssistants.dom.test.ts` 的 `bare-aionrs` fixture 补上 `agent: { type: 'aionrs', source: 'internal' }`）。`bun run test` 全量 2228 passed。

commit：1oneUI `c31b77570` → one-main。

## 追加 BUG12：SSO 表单回显 + 管理端点角色校验（2026-07-14，另开文档）

同一轮继续沿链扫出两个问题，独立记在 [`session-2026-07-14-sso-settings-prefill.zh-CN.md`](session-2026-07-14-sso-settings-prefill.zh-CN.md)：

1. 公开状态接口 `/api/one/sso/providers` 把整个 config 都剥了（含非密钥字段），管理员重新打开已配置 Provider 表单一直是空的；新增管理员专属 `GET /api/one/admin/sso/providers` 只剥密钥字段。
2. 顺带发现 `/api/one/admin/sso/*`（PUT 改配置 + 新增的 GET）**完全没有管理员角色校验**——任何登录成员都能改企业 SSO 配置，LDAP 场景下可伪造身份登录成任意账号。新增 `RequireSsoAdmin` extractor 补上（one-sso/one-org 同层不能互相依赖，直接查 `one_user_org` 表）。

commit：1oneCore `7160470a`（回显）+ `5f71f75b`（角色校验）→ one-main；1oneUI `ad288dbaa` → one-main。

## 追加 BUG13：末位管理员退出/降级会让企业变孤儿（2026-07-14）

**现象**：`leave()`（退出企业）和 `set_user_role()`（改角色）都没有"是否是最后一个管理员"的校验。一个 org_admin/system_admin 退出，或被降级为普通成员时，如果 ta 是租户内唯一的管理员且还有其他成员在，这些成员就再也没有人能邀请新人、配置 SSO、审计或提升管理员——租户永久瘫痪。唯一的恢复手段"重置本地企业数据"同样要求 system_admin 角色，谁都做不了，形成死锁。

**根因**：两个函数在删除/改写 `one_user_org` 行前，都没有查询"移除/降级这个人之后，租户里还剩几个管理员"。

**修法**：新增 `ensure_not_last_admin(tenant_id, excluding_user_id)` 守卫——若移除后管理员数为 0 且还有其他成员，拒绝并返回 `LAST_ADMIN_CANNOT_LEAVE`；若移除后租户会变空（无其他成员），仍放行（不会产生孤儿，只是变空）。`leave()` 和 `set_user_role()`（仅 admin→非 admin 的降级路径）都接了这个守卫。前端 `OverviewTab`（退出企业）/`UsersTab`（改角色）对该错误码给出人话提示，不再是裸 JSON 字符串。

**测试局限**：跟之前 SSO RBAC 一样，local 单机 dev 模式下所有请求的身份都恒为 `system_default_user`（system_admin），没法用 HTTP/CDP 真实构造"第二个用户作为末位管理员退出"的场景——靠 `cargo test -p one-org` 的 5 个新单测覆盖（末位管理员退出被拒 / 有其他管理员时放行 / 租户清空时放行 / 降级被拒 / 有其他管理员时降级放行），15/15 全过。桌面端重编后端后，用真实 HTTP 冒烟测试了"唯一管理员+空租户退出"这条常规路径无回归（顺带清理掉了 dev DB 里上一轮遗留的测试企业"测试666"）。

**顺带修复**：`cargo fmt -p one-org` + `cargo clippy --fix` 清掉了这次编辑触发的可修复项（未用导入 `ROLE_ORG_ADMIN` 误放到顶层、一处可折叠 if）；`heartbeat_runtime_node` 参数超限（8/7）是完全无关的既有函数，不在本次范围内，未处理。

commit：1oneCore `795158cf` → one-main；1oneUI `ee18f346f` → one-main。

## 追加 BUG14：审计日志答不出"谁做的" + 心跳门控挡住普通成员（2026-07-14）

用户明确要求"确保本会话改动都基于企业能力、不破坏单机版；接下来只找企业端能力的产品 BUG"。先做了一轮全量审计（见下一节），确认干净后继续沿企业能力扫，在 `AuditTab`/`RuntimeTab` 这两个此前没细看的 tab 找到两个问题：

1. **审计日志 username 列永远是 NULL**：`one_audit_logs` 表有 `username`/`ip_address`/`user_agent` 三列，但 `audit()` 写入方法的 INSERT 语句从来没填过它们——每一条审计记录的"用户"列只能退化显示原始 user_id。修法：新增 `lookup_username` 按 user_id 查一次用户名，4 处自我操作（加入/创建/退出/重置本地数据）都补上；4 处路由层调用（邀请码增删、退出口令增删）直接用 `actor.username`（已在作用域内，无需查库）。`ip_address`/`user_agent` 需要在 axum 层加 `ConnectInfo`/header 提取，且反向代理场景下需要处理可信代理链避免伪造，属于更大的设计决策，本轮未做，留作已知缺口。
2. **`set_user_role` 的审计行把"被改角色的人"当成"改角色的人"记录**：路由层 `actor`（操作者）从未传进 `set_user_role`，服务层拿到的 `user_id` 其实是目标用户。管理员提升/降级某个成员时，审计日志会显示"该成员自己把自己变成了 XX"，真正的操作者完全消失。修法：`set_user_role` 新增 `actor_user_id` 参数，审计行正确归属给操作者，目标用户+新角色记进 `resource` 字段（`user={target} role={role}`）。
3. **运行时节点心跳接口权限门控设反了**：`admin_runtime_heartbeat` 挂在 `RequireOrgAdmin` 下，只有管理员自己的机器能上报成功，普通成员机器一律 403——但"运行时节点"功能的意义恰恰是让管理员看到全员机器的 Agent 安装情况，这个门控让功能达不成自己的目的。改为任意企业成员（仍需 `is_enterprise_tenant_id` 校验）都能上报；查看列表仍是管理员专属。

**顺带查证**（未发现问题）：`useTeamResourceSync`（团队技能/MCP 同步）确认是活的机制，挂载在 `Layout.tsx`，5 分钟周期，`fs.syncTeamSkills`/`syncTeamMcp` 正确走本地、`oneDevops.listSkills`/`listMcpRegistry` 正确走远端治理路径，local-first 设计无误。

**⚠️ 更大的发现——运行时节点心跳的客户端发送方压根不存在**：全项目搜索 `heartbeat`，除了 `RuntimeTab.tsx`（只读列表展示）和两处无关的 WebSocket keepalive，**没有任何代码调用过 `/api/one/admin/runtime/heartbeat`**。即便修好了权限门控，"运行时节点"Tab 现在、以及在这次修复之前，都会**永远显示空表**——这是一个从未真正建成的半成品功能，不是"逻辑坏了"而是"客户端那一半从未写"。补全它需要做几个产品/设计决策（机器 ID 生成与持久化策略、"已装 Agent"探测复用现有 probe 逻辑还是新建端点、心跳调度频率与挂载位置），规模上更接近"补建功能"而非"修 BUG"，本轮只修了明确是 BUG 的权限门控，**未擅自实现发送方，留给用户决策是否现在建**。

**验证**：`cargo test -p one-org` 新增 2 测试（username 正确回填 / set_role 正确归属给操作者），共 19/19 全过。桌面端重编后端后真实 HTTP 验证：审计日志 `username` 字段从 `null` 变成 `"admin"`；心跳上报 200 成功且出现在节点列表里（此前会 403）。

commit：1oneCore `5ea1c82b` → one-main。

## 本会话标准/企业隔离审计（2026-07-14，用户要求）

用户要求确认本会话所有改动是否只影响企业能力、不破坏单机版。逐文件核对结论：

- **1oneCore**：本会话全部改动 100% 限定在 `one-org`/`one-sso` 两个企业域 crate，零 migration、零共享数据层改动；新路由都挂在 `is_enterprise_tenant_id`/管理员角色校验后，单机版 `tenant_id` 恒为 `'default'`，判断恒为 false，新逻辑完全不会触发。
- **1oneUI**：34 个改动文件逐个核对。绝大多数在 `pages/enterprise/` 或企业专属设置卡片内；共享基础设施（`Router.tsx`/`login/index.tsx`/`navigation.ts`/`ipcBridge.ts`/`WorkspaceIdentityEntry.tsx`）改动均为纯新增，或在"无 redirect 参数"这个单机版必经路径下行为与改动前完全一致（`openWebuiAdminLogin` 全项目唯一调用点已显式传参，改默认值零影响）。唯一一处大改（`WebuiModalContent.tsx` 255 行 + `webuiConfig.ts` + 10 种语言 `settings.json`）不在 enterprise 目录下，是通用 WebUI 设置弹窗，但这份改动本身是**修单机版的 bug**（登录信息卡片之前错误地按企业部署角色隐藏，导致默认 client 角色的全新单机安装长期看不到自己的登录凭据）。

结论：零发现需要回退或补防护的地方。

## 追加：补建运行时节点心跳发送方（2026-07-14，用户拍板执行）

用户对"是否现在建"的回应是"继续完善+自测后再提交"，视为批准执行。设计与实现：

- **机器身份**：新增 `ipcBridge.application.getRuntimeNodeIdentity`（Electron 主进程 provider，`applicationBridge.ts`）。首次调用生成 UUID 持久化到 `ProcessConfig`（本地文件，与登录哪个企业账号无关），配合 `os.hostname()` + 所有非内部 IPv4 地址返回身份。新增 `storage.ts` 的 `'runtime.machineId'` 键。
- **上报**：新增 `ipcBridge.oneAdmin.runtimeHeartbeat`（HTTP POST 到已有的 `/api/one/admin/runtime/heartbeat`）。
- **调度**：新增 `useRuntimeNodeHeartbeat` hook，完全复用 `useTeamResourceSync` 已验证的模式（`isEnterprise && isElectronDesktop()` 才跑，5 分钟周期，standalone 下 return 提前退出不做任何事），挂载在 `Layout.tsx`。
- **`installedAgents` 留空**：唯一贴近"已装 Agent 列表"的 `AgentRegistry::list_management_rows()`（1oneCore）完整实现且有单测，但从未接路由。补一条新只读端点属于独立的、更大的补充，本轮不做，列表留空/UI 显示"-"，诚实而非造假。

**自测（真实桌面端，非仅单测）**：

1. 建企业后重载渲染层 → 心跳自动触发（无需手动调用），节点出现在 `/api/one/admin/runtime/nodes`。
2. 二次重载 → 同一 `machineId`/`node_id`，只是 `lastSeenAt` 更新（后端 upsert 逻辑正确去重，未产生重复行）。
3. **完整杀进程重启**（不只是渲染层刷新）→ `machineId` 与重启前完全一致（证明真正落盘持久化，不是内存态假象）。
4. CDP 点开"运行时节点"Tab → UI 表格真实显示节点/机器 ID/主机名/IP/心跳时间，`已装 Agent` 列诚实显示"-"。
5. `tsc`/`oxlint`/`i18n` 全部干净；全量 `bun run test` 2228 passed，0 failed，无回归。
6. 标准隔离核对：`storage.ts` 新键为可选字段纯新增；`applicationBridge.ts`/`ipcBridge.ts` 纯新增 provider/端点；`Layout.tsx` 新增的 hook 调用门控与 `useTeamResourceSync` 完全一致（非企业/非桌面端直接 no-op）——单机版零影响。

commit：1oneUI `e9664ddcf` → one-main（无需改 1oneCore，心跳后端接口本身在上一轮已修好门控）。

## 追加：知识库文档支持文件/网页导入（2026-07-14，用户拍板执行）

用户反馈"知识库能力太弱"（截图：注册文档只有标题+文本框，只能手工粘贴，列表暂无数据）。排查发现根因：`register_rag_document`（1oneCore one-devops）早就预留了 `file_path`/`file_size`/`mime_type` 字段，但从来没有代码真正读取文件、提取文本——是没接完的脚手架。

**用户明确要求的范围**（AskUserQuestion 后用户自定义答案）：纯文本/Markdown + PDF/Word 解析 + 在线文档（HTML）+ 各种 Office 后缀，全部支持，不要挑一个先做。

**关键发现**：这个功能完全不需要改 1oneCore 后端——后端本来就只需要一个 `content` 字符串，`file_path`/`mime_type` 只是元数据。而且项目根 `package.json` 里已经声明了 `officeparser`（PDF/DOCX/PPTX/XLSX/ODT 系列统一解析，从未被任何代码使用过的现成依赖）+ `mammoth`/`turndown`/`turndown-plugin-gfm`（已在 `common/chat/document/DocumentConverter.ts` 里用于聊天文档编辑功能，证明这套依赖链在这个项目里是可用、已验证的）。整个功能纯粹在 Electron 主进程+渲染层实现。

**新增**：

- `process/utils/documentTextExtraction.ts`（主进程专属，PDF/Office 解析需要 Node API）：`extractTextFromFile`/`extractTextFromUrl`，按扩展名/content-type 分派——txt/md 直读；html 用 turndown 转 Markdown 并正则提取 `<title>`；pdf/doc/docx/ppt/pptx/xls/xlsx/odt/odp/ods 统一走 `officeparser.parseOfficeAsync`。
- `ipcBridge.application.extractRagDocumentFiles`（批量，单文件失败不影响其他）/ `extractRagDocumentUrl`。
- `RagSection.tsx` 新增"从文件导入"（复用已有 `dialog.showOpen` 多选）+ "从网页导入"（URL 输入框）两个入口；导入后若已配置嵌入端点自动触发处理，不用逐个手动点"处理"。
- `RAG_DOCUMENT_EXTENSIONS` 常量放 `common/config/constants.ts`（渲染层文件选择器 filter + 主进程解析分派共用同一份，不会各写一份走样）。

**顺带修复**：`dialog.showOpen` 的 `filters` 参数此前被 `dialogBridge.ts` 的实现忽略，从未真正传给 Electron 原生对话框（给文件导入加类型过滤时发现）。

**已知风险，未处理（下次打包留意）**：`officeparser`/`mammoth`/`docx`/`turndown` 只在**根** `package.json` 声明，`packages/desktop/package.json` 自己没有列。`DocumentConverter.ts` 已经在用 mammoth/docx/turndown 且是已上线功能，说明这套依赖声明方式在这个项目的打包流程里是可行的（`officeparser` 是全新引入使用，但声明方式跟已验证可行的 mammoth 完全一样）——本轮只做 dev 验证，未打包安装测试，若打包后报"找不到模块"，先查 electron-builder 的依赖打包范围是否遗漏了 officeparser 及其间接依赖（pdfjs-dist/yauzl/@xmldom/xmldom/concat-stream/node-ensure）。

**自测**：

- tsc/oxlint/i18n 全干净。
- 独立 Node 脚本直接验证提取核心逻辑：txt/md/html（含 `<title>` 提取）、真实生成的 docx（用项目已有 `docx` 包生成）、真实生成的 pdf（用 `mcp__one-export-pdf` 生成）全部提取出正确文本，中文内容无乱码。
- 桌面端真实 UI 验证：点击"从网页导入"→填 `https://example.com`→提交→文档以网页 `<title>` "Example Domain" 正确入库、状态正确显示 pending（未配置嵌入端点）、成功提示正常、删除清理正常。文件导入的原生选择框无法被 CDP 自动化，核心提取逻辑已用真实文件独立验证过。
- 全量 `bun run test` 出 2 个失败（`releasePackagingConfig.test.ts`/`buildWithBuilder.test.ts`），单独重跑均 16/16 通过，确认是已知并发 flaky（打包相关测试，与本次改动无关），非回归。

commit：1oneUI `60c9398c7` → one-main（无需改 1oneCore）。

## 追加：知识库/超级助手注册表模块 i18n 补全（2026-07-14，用户纠正）

用户看到上一轮新增的知识库导入功能后指出："不能只靠 defaultValue 兜底，不然多语言可能会有问题把，这个可能是以前的缺陷"——直接纠正了我在写代码时的说法（当时认为"这个模块全靠 defaultValue 兜底、我新加的 key 保持一致就行"，把这当成可接受的既有惯例）。

**根因**：项目 i18n 配置 `packages/desktop/src/common/config/i18n-config.json` 里 `fallbackLanguage: "en-US"`。i18next 的实际解析顺序是：当前语言 → `fallbackLanguage`（en-US）→ 都没有才用 `t()` 调用里内联的 `defaultValue`。`common.superAssistant.rag.*`（知识库，25 个 key）和 `common.superAssistant.registries.*`（MCP/测试计划/技能/流水线/知识库共 6+ 个兄弟组件共用的命名空间，29 个 key）**在任何语言文件里都不存在**——不是"某个语言缺失走 fallback"，而是全体语言都缺失，所以每次都直接落到 `defaultValue`，而 `defaultValue` 在源码里永远硬编码同一种语言（本项目里是中文）。结果：无论用户把语言切成英文还是其他语言，这两个命名空间下的文字永远显示中文，是真实的多语言缺陷，不是"用了兜底"这件事本身的问题。

**修法（范围界定）**：只补齐 zh-CN（作为直接命中的源语言）+ en-US（配置里的 `fallbackLanguage`，i18next 找不到用户当前语言的 key 时会用它兜底）。逐语言全量翻译（项目共支持 12 种语言）不在本次范围——这是应用里本来就存在的、更大的独立翻译积压工作（`check-i18n.js` 报告的"未知字面量 key"里还有 302 个，全部是这类待翻译缺口，本次只处理这两个命名空间）。两者补齐后，其余 10 种语言的用户会正确走 `fallbackLanguage` 显示英文，行为与应用里其他尚未完整翻译的模块一致，不再是"所有语言都被硬编码中文糊住"。

**新增内容**：

- 顶层补 `common.required`（原来只有 defaultValue，无对应 key）。
- `common.superAssistant.rag.*`：知识库标题/嵌入配置弹窗（Base URL/API Key/模型/维度）/导入按钮（从文件导入/从网页导入）及其提示文案/处理状态/检索/片段表格列名等 25 个 key。
- `common.superAssistant.registries.*`：MCP/Skills/RAG 等注册表共用的表格列名（标题/类型/端点/状态/操作/更新时间）、新增按钮、删除确认、保存成功/失败提示等 29 个 key。所有文案文本直接从各源码文件的 `defaultValue` 里提取，保证与现有显示逐字一致，不是自己另编的翻译。

**踩坑（自己犯的，已改正）**：

- `colAutoActive` 在两个兄弟文件里的 `defaultValue` 不一致（"成员自动启用" vs "成员自动启用（必选技能）"），取用更短的"成员自动启用"作为统一 key 值（列头场景）。
- 写 `mcpSecretsHint` 时手误写成双花括号 `{{"Authorization":...}}`（会被 i18next 解析成插值占位符，破坏 JSON 示例文本的字面显示），核对源码后改回单花括号 `{"Authorization":...}`。

**自测**：

- `node scripts/check-i18n.js`：未知字面量 key 数从 431 降到 302。
- `bunx tsc --noEmit` 0 error，`oxlint` 只有 1 条既有无关警告。
- `bun run i18n:types` 重新生成 `i18n-keys.d.ts`，diff 里能看到新增的字面量类型如 `'common.required'`、`'common.superAssistant.rag.apiKey'` 等。
- 桌面端真实 CDP 验证（决定性证据）：因早前测试用的 `reset-local` 调用内部会轮换 JWT 密钥、导致当前会话 token 失效，中途意外弹到登录页——完整重启 app 后恢复本地模式自动登录。找到语言切换入口（在"设置→系统"页，Arco `Select` 组件，不是"设置→外观"）切到 English，进知识库页面，确认"Knowledge Base Documents / Embedding Config / Import from Files / Import from URL / Register Document / Embedding endpoint not configured / Title / Status / Chunks / Actions / Search"等全部正确显示英文——修复前这些文字无论选什么语言都会固定显示中文。切回简体中文验证中文显示不受影响，无回归。
- 全量 `bun run test` 干净通过（TEST_EXIT=0）。

commit：1oneUI `47cd82dab` → one-main（无需改 1oneCore）。

## 追加：企业管理 + 超级助手模块 i18n 全量补全（2026-07-14，用户要求"用i18n做翻译，不要硬编码"）

用户看完上一轮的知识库/registries 修复后追加指令："用i18n做翻译啊，不要硬编码，老架构的企业版好多语言的BUG把"——判断这不是"这一处修完就够了"，而是要求把同类问题在企业版范围内系统扫一遍。

**排查方法**：跑 `node scripts/check-i18n.js` 按文件统计未知 key 分布，发现 `pages/enterprise/components/*`（6 个文件，51 个 key）和 `pages/superAssistant/*`（14 个文件，170+ 个 key，含数字员工/协作看板/里程碑/流水线/测试计划/运行时/设置等全部子模块）几乎整体从未把文案注册进任何语言文件——不是零星漏补，是这两大块页面从建成起就一直靠 `defaultValue` 硬编码中文兜底。另外 `pages/login/components/LoginSsoButtons.tsx` 的 LDAP 登录表单（4 个 key）同属企业 SSO 功能，一并处理。`pages/memory/index.tsx`（67 个未知 key）和 `ManualPairingInput.tsx`（3 个）经确认与企业版无关（前者是个人笔记功能，后者是通用配对功能），排除在本次范围外。

**修法**：与上一轮相同——只补 zh-CN + en-US 两个语言文件，依赖 `fallbackLanguage: "en-US"` 覆盖其余语言，不逐语言全量翻译。所有中文文案原文都是从对应源码文件里 `t()` 调用的 `defaultValue` 逐字提取，保证跟现有显示一致。

**过程中一个插曲**：先尝试用后台 Agent（`general-purpose`）承担整个提取+翻译+校验的机械工作，Agent 还没开始写文件就因为达到会话额度限制被中断（`session limit resets 2:30pm`）——检查 `git status` 确认零文件被动过，于是改为在主会话里直接逐文件读取源码、手工提取、编辑 JSON，规避了子会话额度撞车的风险。

**发现的 3 处同 key 不同 defaultValue 冲突**（跟上一轮 `colAutoActive` 是同一类问题，沿用"取更贴合语义/更通用版本"的处理原则）：

- `pipelineName`：列头用"流水线"，表单标签用"流水线名称"——取列头版本"流水线"（列头出现 2 次多于表单标签 1 次）。
- `testPlanTitle`：列头用"测试计划"，表单标签用"计划标题"——取"计划标题"（更贴合 key 语义里的"标题"字段，列头场景下"测试计划"作为实体名也说得通但容易跟"testPlansTitle"混淆）。
- `superAssistant.createAgent`：3 处引用中 2 处是"创建员工"，1 处（OverviewTab 的链接按钮）带箭头后缀"创建员工 →"——取不带箭头版本，箭头是该按钮的链接样式后缀，不是文案本身。

**另发现并顺手补上一个真实遗漏**：`pages/superAssistant/index.tsx` 用到 `common.superAssistant.deleteFailed`，跟已经存在的顶层 `common.deleteFailed`（"删除失败"，无 `superAssistant.` 前缀）是两个不同路径的 key——第一轮 check-i18n 扫描后漏看了这一个，跑完整验证时被 check-i18n 抓出来，补上后归零。

**自测**：

- `check-i18n.js` 目标文件范围内未知 key 从 178 降到 0（全项目层面 302→71，剩余 71 个是本次排除范围内的 `pages/memory` 等非企业模块，留作独立待办）。
- `bunx tsc --noEmit` 0 error；`oxlint` 0 新增（824 条既有警告不变）。
- 全量 `bun run test`：2228 passed，0 failed。
- 桌面端真实点击验证：「超级助手 → 协作看板」确认 tab 名（概览/员工/协作看板/协作资源/运行时/设置）、协作上下文提示（"协作流可调用以下企业知识与工具：""知识库未就绪""管理资源"）、Issue 计数插值（"共 3 个 Issue"）等全部正确渲染；「超级助手 → 协作资源」确认里程碑/测试计划/流水线三个子模块的标题、列头、按钮文案全部正确显示，插值和真实数据行正常。企业管理后台的成员/邀请码/审计/SSO/运行时节点几个 tab 需要真实企业租户会话才能渲染（当前桌面端是个人模式），临时搭建测试租户对纯文案修复来说验证性价比不高，未做，靠"源码逐字提取 + JSON 语法校验 + check-i18n 清零 + tsc/oxlint 干净 + 全量测试通过"的字符串级保证代替；跟前几轮遇到"local dev 恒 system_admin 身份，无法构造第二用户场景"是同一类已知测试局限（见 [[enterprise-org-reset-feature]] 记忆）。
- 语言切换的 UI 自动化本身（点击 Arco Select 的 English 选项）在这轮 CDP 里多次尝试均未生效（怀疑是自定义 `DreamSelect` 封装 + 双重 `requestAnimationFrame` 延迟的组合导致合成事件序列打不中真实的选中逻辑），放弃继续攻克，改用上面的渲染态验证方式；语言切换机制本身在上一轮已经用同样的 fallbackLanguage 链路做过端到端验证，此处不是新机制、只是同机制的更大范围数据补全。

commit：1oneUI `a400d4c36` → one-main（无需改 1oneCore）。

## 追加：SSO Redirect URI 真实故障 + 提示/一键填入修复（2026-07-14，用户真机报障）

用户在真实部署上配置飞书 SSO 后反馈"其他用户没办法飞书验证，访问不了"，并贴出浏览器截图：飞书授权成功后跳到 `http://172.29.128.120:25808/api/auth/feishu/callback?code=...&state=...`，返回 `{"success":false,"error":"Route not found.","code":"NOT_FOUND"}`；同时贴了 SSO 设置页（Redirect URI 填的正是这个 `/api/auth/feishu/callback` 地址）和飞书开放平台后台"重定向 URL"配置截图（同样登记的是这个地址）。

**根因**：查 `crates/one-sso/src/routes.rs` 的 `one_sso_public_routes` 确认真实回调路由是 `GET /api/one/sso/{provider}/callback`，不是 `/api/auth/{provider}/callback`。管理员在 SSO 设置的 Redirect URI 字段和飞书后台都填错了路径前缀——这是纯手填文本框，没有任何提示告诉管理员正确路径该长什么样，而这个应用绝大多数认证相关端点（`/api/auth/status`、`/api/auth/user`、`/api/auth/qr-login` 等，见 `crates/aionui-auth/src/routes.rs`）确实都在 `/api/auth/` 下，管理员照着这个模式类推填了 SSO 回调地址，恰好踩进了 SSO 走的是独立的 `/api/one/sso/` 前缀这个坑。

**即时解法**（先说给用户听，让他解封）：Redirect URI 改成 `http://172.29.128.120:25808/api/one/sso/feishu/callback`，飞书开放平台后台同步登记这条正确地址，然后重新走一次登录（老 code/state 一次性已失效不能重放）。

**产品修法**（用户确认"需要"后落地）：`SsoSettingsTab.tsx` 给 `redirectUri` 字段（feishu/dingtalk/wecom，LDAP 密码式没有这个字段）单独抽出一段渲染：

- 输入框下面加一行固定提示文案："回调路径固定为 /api/one/sso/{{provider}}/callback（不是 /api/auth/...），需在此和 OAuth 应用后台同时配置一致。"（新 i18n key `common.enterprise.ssoRedirectUriHint`，逐 provider 插值）。
- 输入框旁加「填入建议地址」按钮（新 key `ssoRedirectUriFillButton`），点击时用 `window.location.origin + /api/one/sso/{provider}/callback` 现算一个建议值直接填入。
- **关键守卫**：`suggestedRedirectUri()` 只在 `window.location.origin` 是真实 `http://`/`https://` 时才返回非 null（按钮才显示）。查了 `packages/desktop/src/index.ts` 的 `mainWindow.loadURL(rendererUrl)`/`loadFile` 分支确认：`ELECTRON_RENDERER_URL`（Vite dev server）只在 `!app.isPackaged` 时才用，**打包后的桌面端永远走 `loadFile`（`file://` 协议）**——这时守卫会让按钮自动隐藏，只留文字提示，不会给出一个基于 `file://` 的荒谬建议值。真正会显示按钮、给出正确建议的场景是管理员通过 WebUI（浏览器直接访问部署好的服务器地址）打开这个设置页——恰好就是用户这次真实踩坑的场景。

**自测**：

- tsc/oxlint 干净，全量 `bun run test` 2228 通过。
- 桌面端本地临时建了个测试企业（验证完即退出清理），进「SSO 设置」确认 feishu/dingtalk/wecom 三个 provider 下提示文案和按钮都正确渲染，LDAP 没有这个字段不受影响；点击「填入建议地址」验证真实填入了 `{origin}/api/one/sso/{provider}/callback`（dev 模式下 origin 是 Vite 的 `localhost:5173`，不是真实后端端口，但这只在开发者自己的 dev 环境可见，不影响生产判断——生产打包后走 `file://` 会被守卫挡住不显示按钮）。

commit：1oneUI `842cf2f48` → one-main（无需改 1oneCore，纯前端修复）。

## 追加：SSO 登录丢失真实姓名/部门 + 授权页不自动关闭（2026-07-14，用户改对 Redirect URI 后续追问）

用户把 Redirect URI 改对、真实走通飞书 SSO 之后，追问三个问题：①External ID Field(union_id/open_id) 是干嘛的（纯答疑，见下方 Q&A）；②SSO 登录成功、加入企业后，成员列表拉不到这个人的真实姓名和部门；③用户认证完毕后，飞书授权页标签页一直停留不自动关闭。用户明确要求修 ②③ 两个 bug，并特别加了一条约束："修复这两个企业的登录BUG，一定不能影响单机版的功能"——因为涉及 one-sso/one-org 的表结构改动，先进 plan 模式过了一遍方案再动手。

**根因①：真实姓名丢失**。`FeishuProvider::to_provider_user_info`（`crates/one-sso/src/providers/feishu.rs`）正确解析出了 `name`/`en_name`，但 `resolve_or_provision_user`（`crates/one-sso/src/service.rs`）JIT 建号时把这个值喂给 `sanitize_username()` 生成登录用户名——这个函数**只要发现非 ASCII 字符就整段丢弃**（不是 SSO 独有规则，是全系统统一的 `aionui_auth::validate_username` 约定，`validation_tests.rs` 专门测试锁死，`users.username` 绝对不能碰），中文姓名必然触发丢弃，回退成 `sso_<8位随机>`，真实姓名彻底没地方存。

**根因②：部门信息丢失**。飞书的 `tenant_key` 同样被正确解析进 `ProviderUserInfo.org_unit_path`，但顺着调用链往下追，`resolve_or_provision_user` 只用这份 profile 建 `users` 行 + 绑定 `one_sso_identities`，**从未使用过 `org_unit_path`**。更进一步：SSO 登录本身**不会**自动把人加进企业租户（`common.enterprise.loginBrowserHint` 的既有文案就写着"完成后返回本应用，在「企业」页加入团队"）——真正建 `one_user_org`（租户成员关系）行的只有 `join_with_invite`/`create_tenant`，而这两处的 INSERT 语句都不带 `org_unit_path`。**关键发现**：`one_user_org` 表（`crates/one-org/migrations/001_init.sql`）里其实早就有 `org_unit_path`/`org_profile_source`/`org_profile_synced_at` 三列，前端 `UsersTab.tsx` 也早就渲染了"部门"列——这是本会话里第三次遇到同款半成品（前两次是运行时节点心跳、知识库文件导入）：字段/UI 早搭好了，写入这一步从来没接上。

**修法**（详见 `docs/tech`/plan 文档，摘要）：

- `one-sso`：`one_sso_identities` 加 `display_name`/`org_unit_path` 两个可空列（新迁移 `002_identity_display.sql`），`bind_identity`/`touch_identity` 存入/每次登录刷新这份原始资料快照——完全独立于登录用 `username`，绝不碰它。
- `one-org`：`one_user_org` 加 `display_name` 一列（新迁移 `002_membership_display.sql`），新增私有方法 `sso_profile_for(user_id)` 直接查 `one_sso_identities`（跟 `one-sso::effective_role` 直读 `one_user_org` 是同一个"跨领域 crate 直接读表"的既有先例，不算破例），`join_with_invite`/`create_tenant` 建成员行前查一下加入者的 SSO 身份，有则连同姓名/部门一起抄进去，没有（本地密码创建的成员）留空不报错。`list_users` 加 `uo.display_name` 到 SELECT。
- 1oneUI：`AdminUser` 类型加 `displayName`，`UsersTab.tsx` 新增「姓名」列（`displayName ?? username` 兜底），「部门」列本来就在渲染 `org_unit_path`，数据补上后不用改前端就直接生效。

**根因③：授权页不自动关闭**。`crates/one-sso/src/routes.rs` 的 `callback()` 对桌面端流程（`entry.desktop == true`）原来是裸 302 跳 `aionui://sso-callback?...`——浏览器没法真正"导航"到自定义协议，只会弹个"是否打开 1One Work"提示条，标签页本身停在原地，从没写过任何关闭逻辑。改成返回一段自包含 HTML（`axum::response::Html`）：脚本立即触发 `aionui://` 深链跳转，同时展示中英文"登录成功，可以关闭此页面"提示，延迟后尝试 `window.close()`（浏览器安全策略下不一定生效，但无害）。浏览器 Cookie 会话那条分支不受影响。

**External ID Field 答疑**：决定用飞书哪个标识符做跨会话稳定的用户身份键——`open_id` 只在这一个飞书 App 下唯一，换个 App/集成看到的值会不一样；`union_id`（默认）在整个飞书开发者账号名下所有 App 范围内唯一，哪怕以后重建 App 也不变，更稳定。单一应用场景保持默认 union_id 即可，不用改。

**明确排除的范围**：用户还提到"正常情况下应该拉到姓名，部门，岗位"——"岗位"（职位）当前调用的飞书 `/open-apis/authen/v1/user_info` 轻量端点根本不返回，需要额外调用飞书 Contact API（`/open-apis/contact/v3/users/:id`）并申请新的权限范围（`contact:user.department_v1`/`contact:user.employee_v1`），管理员要在飞书开放平台重新走一次权限审批——比"把已经拿到手但被丢弃的数据存下来"大得多的新集成面，本次不做，留作独立后续。

**单机版隔离**：全部新列可空、纯 `ALTER TABLE ADD COLUMN`；one-sso/one-org 的迁移在单机版也无条件跑（`aionui-app/src/router/routes.rs` 不分单机/企业执行），单机版从第一天起这两张表就存在只是从来没数据；`sanitize_username`/`validate_username`/`users` 表结构完全不碰。

**自测**：

- 新增 6 个 Rust 单测：JIT 建号保留真实姓名（用户名仍是 ASCII 的 `sso_xxx`，但 `one_sso_identities.display_name` 存住"张三"）、二次登录刷新姓名/部门、无 org_unit_path 时留空不报错、`join_with_invite` 正确把 SSO 身份的姓名/部门抄进 `one_user_org`、本地成员（无 SSO 身份）加入后姓名/部门留空、callback HTML 内容校验（含深链字符串/双语提示/`window.close()`）。`cargo test -p one-sso -p one-org` 全绿（37+19）。
- `cargo test --workspace` 有 41 个失败，逐一 `git stash` 到改动前 baseline 核实**同样失败**——全部是 Windows junction/hook 执行/CSRF/迁移 seed 等跟 one-sso/one-org 毫无关联的既有问题，非本次引入。
- 桌面端：重编后端落地 bundled，真实创建测试企业，用 Node 内置 `node:sqlite`（`--experimental-sqlite`）直接写库模拟一个带 SSO 身份的成员（`one_sso_identities`/`one_user_org` 都手工插了 `display_name`/`org_unit_path`），刷新「成员」表确认「姓名」列显示"王小明"、「部门」列显示"研发中心"；对照组本地 `admin` 账号（无 SSO 身份）正确回退显示用户名、部门留空，无回归。验证完清理测试数据+退出测试企业。
- 全量 `bun run test`（1oneUI）2228 通过。

**踩坑**：验证途中不慎在 cwd 已经切到 1oneUI 目录时执行了原本打算对 1oneCore 跑的 `git stash`（想测 workspace 全量测试 baseline），意外把 1oneUI 刚写好的前端改动（UsersTab/orgTypes/i18n）连带 stash 掉——`git stash list` 发现残留立刻 `git stash pop` 找回，逐文件 grep 确认内容完整无损；之后所有 `git stash` 操作前都先 `pwd` 确认目录。教训：每次 stash/pop 前一定先确认 cwd，不要假设"上一条命令切换的目录还在"。

commit：1oneCore `283e788a`→one-main；1oneUI `73a0140b6`→one-main。

## 追加：飞书部门/岗位换成通讯录 API 真实数据（2026-07-14，用户确认飞书应用权限很高）

上一轮把「部门」列接上了数据，但存的其实是 `tenant_key`（飞书租户/公司标识），不是真的部门。用户回应"我飞书这个应用本身的权限是很高的，基本上都有"——清除了"权限不够拿不到"这个顾虑，进 plan 模式过了一遍方案后拍板：①`org_unit_path` 换成真实部门名称（Contact API 查不到就留空，不再回退到语义错误的 tenant_key）；②新增「岗位」字段；③只做飞书，钉钉/企业微信的通讯录 API 和所需权限没确认过，范围明显更大，先不做。

**技术方案**：飞书当前登录只调用轻量级 `/open-apis/authen/v1/user_info`（个人 OAuth token 就能查），根本不返回部门/岗位。真实数据在飞书通讯录（Contact）API，需要三步：①`POST /auth/v3/tenant_access_token/internal`（app_id+app_secret）→ `tenant_access_token`（应用级 token，不是登录返回的用户级 token，`test_credentials` 早就在调这个端点验证凭据，抽出复用）；②`GET /contact/v3/users/{external_id}?user_id_type=...&department_id_type=open_department_id`（Bearer tenant_access_token）→ `job_title` + `department_ids`（取第一个）；③`GET /contact/v3/departments/{id}` → 部门 `name`。三步包一层**永不报错**的 `fetch_org_profile`：任何一步失败（权限不够、网络问题、没配部门）都退化成全 `None`，绝不能让这个"锦上添花"的调用把已经登录成功的 OAuth 流程搞挂——调用它的时候 OAuth 早就成功了。

**改动**：`crates/one-sso/src/providers/feishu.rs` 的 `to_provider_user_info` 不再把 `tenant_key` 塞进 `org_unit_path`（改成留空，交给异步的 `fetch_org_profile` 补全）；`ProviderUserInfo` 加 `job_title` 字段，钉钉/企业微信/LDAP 都留空（这次只做飞书）；`crates/one-sso/routes.rs` 的 `run_provider_oauth` Feishu 分支拿到基础 profile 后再异步补一次 `fetch_org_profile` 覆盖 `job_title`/`org_unit_path`。数据库层走上一轮刚搭好的同一条 profile 快照管线（`one_sso_identities`/`one_user_org` 各加 `job_title` 列，append-only 新迁移不改上一轮已提交的 002；`bind_identity`/`touch_identity`/`join_with_invite`/`create_tenant`/`list_users` 都顺着加一个字段）。前端 `UsersTab.tsx` 在"部门"后加"岗位"列，"部门"列渲染逻辑本身不用改（数据源换了，前端读的还是同一个 `orgUnitPath`）。

**测试基建的顺手补充**：`FeishuProviderConfig` 加了一个 `base_url`（`#[serde(default, skip_serializing_if)]`，可选，测试专用，从不出现在管理表单/持久化配置里）——跟 `aionui-shell` 现成的 LLM provider 配置同款测试注入模式（`tests/stt_integration.rs` 的 `base_url: Some(mock_server.uri())`）。`one-sso` 的 `Cargo.toml` 加了 `wiremock`（workspace 已有 0.6，这是第一次在 `one-sso` 里用），给新增的三个 HTTP 调用写了真正的集成测试（mock 全链路成功 + tenant-token 失败退化 + 无 department_ids + 部门查询单独失败但 job_title 不受影响），而不只是纯 JSON 解析单测——这是本会话第一次能对一个外部 OAuth/API 集成做到"真的模拟网络请求"级别的验证，而不是只能测测字符串处理。

**踩坑**：`fetch_contact_user`/`fetch_department_name` 第一版直接把飞书返回的顶层 JSON（`{code, msg, data: {...}}`）反序列化进只有 `user`/`department` 字段的 wrapper struct——没有先取 `data` 字段就整体反序列化，导致目标字段永远解析不到（`serde` 静默返回 default，不报错，非常隐蔽）。4 个 wiremock 测试跑起来后 3 个直接失败（`left: None, right: Some(...)`），才发现两处都漏了 `.get("data")` 这一步——改成先 `json.get("data").and_then(|d| serde_json::from_value(d.clone()).ok())` 再解析，4 个测试全部通过。这也印证了写真实 HTTP mock 测试的价值：如果只写"手工构造 JSON 字符串传给反序列化函数"这种更贴近实现细节的单测，很可能会跟着同一个错误假设走，测不出这个 bug。

**自测**：

- 新增/改动的 Rust 单测：`fetch_org_profile` 的 4 个 wiremock 场景全过；`to_provider_user_info` 新增断言确认不再从 `tenant_key` 派生 `org_unit_path`；上一轮的 JIT 建号/二次登录刷新/`join_with_invite` 抄写测试都补充了 `job_title` 断言。`cargo test -p one-sso -p one-org` 42+19 全绿。
- `cargo test --workspace` 40 个失败，跟改动前 baseline（41 个）数量/成因基本一致（Windows junction/hook 执行/CSRF/迁移 seed 等，与 one-sso/one-org 毫无关联），无新增回归。
- 桌面端：重编后端落地 bundled，真实创建测试企业，用 `node:sqlite`（`--experimental-sqlite`）直接写库模拟一条带真实部门名称"产品研发部"+岗位"高级前端工程师"的成员数据，刷新「成员」表确认「部门」列显示真实部门名称（不再是 tenant_key 那种字符串）、「岗位」列正确显示；本地 `admin` 账号（无 SSO 身份）两列都正确回退显示"-"，无回归。验证完清理测试数据、退出测试企业。
- 全量 `bun run test`（1oneUI）2228 通过。

**诚实说明（写进代码注释和交接文档，不藏着）**：Contact API 的真实权限/字段行为无法在我这边验证——没有真实飞书租户和已授权的 App 凭据，wiremock 测试只能验证"HTTP 请求构造/响应解析/降级逻辑代码本身是对的"，不能验证"飞书线上真的会不会 100% 按预期的字段名/权限返回数据"。这次真实部署验证需要用户自己走一遍真实 SSO 登录，确认「部门」「岗位」两列显示符合预期。

commit：1oneCore `6d490d3f`→one-main；1oneUI `0f8655cf4`→one-main。

## 测试套件已知 flaky（非阻塞，未处理）

全量 `bun run test`（2231 个测试）连续两次跑，每次都有 1-3 个测试随机失败，但都不是同一批（第一次 `useConversationAssistants`+`useDetectedAgents`（已在 BUG12 前的排查中确认是预存问题并修复），第二次是完全不相关的 `usePreviewHistory`）。单独跑这些文件都 100% 通过。判断是大规模并行跑（22 线程）下的资源争抢/模块加载时序 flaky，不是真实回归。以后判断"测试是否因我的改动而挂"时，认准该文件单独跑的结果，而非全量跑一次的结果。
