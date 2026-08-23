# 2026-07-13：企业「本机残留数据」自助重置

## 背景

用户报告两台不同的机器点进「企业」页看到的信息不一样：一台报
`BackendHttpError ... "This server already hosts an enterprise" code:"FORBIDDEN"`，
另一台是正常的客户端连远端服务器界面。排查后确认：`create_tenant`
（`1oneCore/crates/one-org/src/service.rs`）靠 `SELECT COUNT(*) FROM one_tenants`
判断"一机一企业"，这张表只要机器上真正建过一次企业就会留下行——而且
**没有任何现存代码能清空它**。之前会话记忆里以为存在的"降级归档"
（`demoteToClient`）经排查确认**从未真正实现**，只有前端一个确认弹窗的
文案桩，误导了后续判断（对应记忆已纠正，见 `enterprise-org-reset-feature`
项目记忆）。

本轮验证时甚至在本地 dev 环境（`%APPDATA%\1one-Dev`）里organically复现了
这个 bug——之前某次 dev 测试建过一个叫"欢乐盾"的企业，一直没清，导致本
轮 `curl` 复现时第一次 `create` 调用就直接 403。

## 改了什么

**后端（1oneCore）**：

- `crates/one-org/src/error.rs`：`OrgError` 新增 `AlreadyHostsEnterprise` 变体
  （code `ALREADY_HOSTS_ENTERPRISE`，区别于泛化的 `FORBIDDEN`，前端可以精确
  识别这一种情况）。
- `crates/one-org/src/service.rs`：
  - `OrgService` 新增 `data_dir: PathBuf` 字段（`new()` 签名多一个参数）。
  - 新增 `reset_local_enterprise(user_id)`：权限同 `create_tenant`
    （`effective_role` 必须是 `system_admin`）；把现有 `one_tenants` +
    每个 tenant 的成员（复用 `list_users`）序列化成 JSON 归档到
    `data_dir/enterprise-archives/enterprise-<ts>.json`；清空
    `one_user_org` / `one_tenants` / `one_tenant_invites`；对受影响用户调用
    `invalidate_user_tokens`；写一条 `org.reset_local` 审计日志。
- `crates/one-org/src/models.rs`：新增 `ResetLocalResult` DTO
  （`archivedTenantCount` / `archivedMemberCount` / `archivePath`）。
- `crates/one-org/src/routes.rs`：新增 `POST /api/one/org/reset-local`
  （挂在 `create`/`join`/`exit` 同一个已认证路由组，空 body）。
- `crates/aionui-app/src/router/routes.rs`：构造 `OrgService::new` 时多传
  `services.data_dir.clone()`（`AppServices` 本来就有 `data_dir` 字段，
  不用额外新增）。

**前端（1oneUI）**：

- `common/types/org/orgTypes.ts` + `common/adapter/ipcBridge.ts`：新增
  `ResetLocalResult` 类型 + `oneOrg.resetLocal`（跟 `create` 一样直连后端
  HTTP，**没有新增 Electron IPC**）。
- `renderer/pages/enterprise/components/OverviewTab.tsx`：`handleCreate`
  的 `catch` 分支用 `isBackendHttpError(e) && e.code === 'ALREADY_HOSTS_ENTERPRISE'`
  精确识别这一种失败，命中时在"创建企业"区块下面显示一条警告 + "重置本机
  企业数据"按钮（`Modal.confirm` 二次确认），而不是把原始 JSON 错误糊给
  用户看。
- i18n：`common.enterprise.staleDataDetected` / `resetLocalButton` /
  `resetLocalConfirmTitle` / `resetLocalConfirmDesc` / `resetLocalSuccess` /
  `resetLocalFailed`——只加了 `zh-CN`/`en-US`，因为 `enterprise` 这个命名空间
  在其余 11 个语言里本来就没有（历史遗留缺口，本次不扩大也不修）。

## 验证

- `cargo test -p one-org`：10 个测试全过，新增两个直接复现并验证这个 bug 的
  用例（`reset_local_enterprise_clears_stale_tenant_and_allows_recreate` /
  `reset_local_enterprise_requires_system_admin`），另外把
  `one_server_hosts_only_one_enterprise` 的错误码断言从 `FORBIDDEN` 改成了
  `ALREADY_HOSTS_ENTERPRISE`。
- `cargo clippy -p one-org -p aionui-app -- -D warnings`：通过。
- 前端：`bunx tsc --noEmit`、`bun run lint:fix`（0 error）、新增
  `tests/unit/renderer/OverviewTab.dom.test.tsx`（2 个用例：命中特定错误码
  显示重置按钮 / 其他错误不显示），全过。
- **真实桌面端端到端**：`backend-rebuild` 编译release + `prepareAioncore.js`
  搬进 bundled 后，`bun run dev` 起真实桌面端。直接对着真实运行的
  aioncore.exe（`data-dir: C:\Users\allenzhao\AppData\Roaming\1one-Dev\1one`）
  `curl` 打 API：
  1. `POST /api/one/org/create` 第一次就 403 `ALREADY_HOSTS_ENTERPRISE`
     （dev 库里本来就有一条历史遗留的"欢乐盾"企业，天然复现了用户报的 bug）。
  2. `POST /api/one/org/reset-local` → 成功，`archivedTenantCount:1`，
     归档文件 `enterprise-archives/enterprise-1783920781267.json` 内容正确
     （含租户名/创建时间/成员列表）。
  3. `GET /api/one/org/context` → 确认回到 `default`/`system_admin`。
  4. 再次 `POST /api/one/org/create` → 成功拿到新 `tenant_id`。
  - 未完成的部分：这次没有真正点桌面端窗口里的按钮验证像素级 UI（本
    session 里 chrome-devtools MCP 没有接到这个 Electron 实例的 CDP 端口
    9230，是独立的浏览器实例），UI 分支的正确性由上面的 `OverviewTab.dom.test.tsx`
    （真实 DOM 渲染断言）担保，不是靠肉眼截图。如果要在这台机器上肉眼确认，
    直接开着的这个桌面端窗口点「企业」页应该已经能看到修复效果（dev 库
    已经被上面的 curl 重置过，现在是干净状态）。

## 追加:部署角色切换的两个后续问题(同一天,纯前端)

验证过程中用户发现了两个新问题(都在 `EnterpriseDeploymentModeCard.tsx`):

1. **服务端模式没有显示具体地址**——之前只有静态文案"局域网内其他客户端可连接到本机地址"，没有真正解析出 IP。改法:复用已有的 `webui.getStatus.invoke()`(`OverviewTab.tsx` 解析管理后台地址用的同一个 IPC，返回值里本来就有 `lanIP`/`port`/`allowRemote`/`running`)，服务端模式下如果 WebUI 正在跑且允许远程访问，就显示 `其他客户端请填写地址：http://{lanIP}:{port}`；否则提示"尚未开启可供局域网访问的 WebUI"。
2. **client→server 切换没有拦截**——原来只有 server→client(降级)时会弹确认框提醒"请先退出企业"，反过来(client 且已加入企业时想切成 server)完全没有拦截，会静默丢失当前企业连接/成员关系。补了对称的拦截:`role==='server' && savedRole==='client' && hasLocalEnterprise` 时用 `Modal.warning` 硬拦截（不给"仍然切换"的选项，因为切换后企业成员关系不会消失但也不会自动同步，容易造成困惑数据）,提示"您当前的模式是客户端，且已加入企业。如需切换为服务器，请先在「企业」页退出当前加入的企业。"
   - 已知局限:如果一台机器是从 server 降级成 client 且没有真正退出企业(`hasLocalEnterprise` 因此仍为 true)，此时想切回 server 也会被这条新守卫拦住，即使它本来就是自己的数据。这种"来回横跳"的边界场景本次没特殊处理，卡住时用「企业」页的退出/本文档前半部分的"重置本机企业数据"按钮都能解开。

i18n key 加在 `settings.json`(`webui.switchToServerBlockedTitle`/`Desc`、`webui.deployServerAddressLabel`/`Unavailable`)，同样只加了 zh-CN/en-US(跟随这个文件里 `webui.*` 键本来就只有这两个语言的既有模式)。

新增测试 `tests/unit/renderer/EnterpriseDeploymentModeCard.dom.test.tsx`(4 用例:地址解析成功/失败两种展示、拦截 client→server、放行 client→server 当无企业成员关系时)。`bunx tsc --noEmit`、`bun run lint:fix`（0 error）均过。

这轮改动是纯前端(TSX + i18n JSON)，dev 环境的 vite HMR 已经把改动热更新进正在跑的桌面窗口(`[vite] page reload EnterpriseDeploymentModeCard.tsx` / `settings.json` 均无报错)，没有重编 Rust 后端的必要。

## 加载对照

改的是 `1oneCore` 后端（Rust）+ `1oneUI` 前端（TS）都有：

- 后端已经 `backend-rebuild` 编过 release 并 `prepareAioncore.js` 搬进
  `1oneUI/resources/bundled-aioncore/win32-x64/aioncore.exe`。
- 前端是 `bun run dev` 热更新即可，本次验证用的就是这条路径。
