# 2026-07-14 SSO 设置表单非密钥字段不回显 BUG 修复

> 用户看企业 SSO 设置页截图时发现：飞书已配置（绿色"已配置"标签），但 App ID / Redirect URI 这些非密钥字段全是空的，重新编辑得凭记忆手填。前端 `1oneUI` + 后端 `1oneCore`（`one-sso` crate）跨仓改动。**未打包**。

## 根因

`/api/one/sso/providers` 是**公开**接口（登录页用它判断显示哪些 SSO 按钮，未登录也能访问），出于安全只返回 `{provider, enabled, configured}`，整个 `config` 都不带。`SsoSettingsTab.tsx` 管理页复用的就是这同一个接口，导致连本不敏感的 App ID / Redirect URI / External ID Field 也被一并隐藏，表单永远从空白开始。

## 修法

新增**管理员专属**端点 `GET /api/one/admin/sso/providers`（挂在已有鉴权的 `one_sso_admin_routes`，跟 `PUT /api/one/admin/sso/{provider}` 同组），只在按 provider 维护的密钥字段清单上做剥离，其余字段原样返回：

| Provider | 密钥字段（剥离） |
| -------- | ---------------- |
| feishu   | appSecret        |
| dingtalk | appSecret        |
| wecom    | secret           |
| ldap     | bindPassword     |

公开端点 `/api/one/sso/providers` 完全不动，登录页行为不受影响。

- 后端：`crates/one-sso/src/models.rs` 加 `SsoProviderConfigDto`；`service.rs` 加 `secret_keys()`/`redact_secret_fields()`/`SsoService::list_provider_configs()`；`routes.rs` 加 handler + 路由。
- 前端：`ipcBridge.ts` 的 `oneAdmin.listSsoProviders` 改指向新端点、返回类型换成 `SsoProviderConfig`；`SsoSettingsTab.tsx` 的 `ProviderCard` 加一个 effect，在 `status?.config` 变化时（mount + 保存成功后 reload）用非密钥字段预填 `values`，密钥字段永远跳过、保持空白 + 原有占位提示。

## 复用点

BUG5（`merge_config` 按键合并，见 [`session-2026-07-13-enterprise-client-6bugs.zh-CN.md`](session-2026-07-13-enterprise-client-6bugs.zh-CN.md)）已经把"保存时整体替换配置"改成增量合并，这次只是让**读**也对称——之前读的时候把整个 config 连非敏感字段一起藏了，跟保存逻辑已经不一致。

## 实测（桌面端 CDP，2026-07-14）

后端重编 + 落地 bundled 后启动桌面端。dev 库里刚好有上一轮测试留下的已配置飞书 provider（`appId=cli_CHANGED`, `redirectUri=https://x/cb`, `externalIdField=union_id`），直接拿来验证：

1. 打开 SSO 设置页 → 飞书卡片 App ID/Redirect URI/External ID Field 均正确回显，App Secret 输入框为空（`type=password`，占位符"出于安全不回显，留空保持不变"）。
2. 把 App ID 改成 `cli_ROUNDTRIP_TEST` 并保存，`window.location.reload()` 强制重新拉取 → App ID 显示新值，Redirect URI/External ID Field 未受影响，App Secret 仍为空。
3. 改回 `cli_CHANGED` 恢复原状。

未配置的钉钉/企业微信/LDAP 三个 provider 显示"未配置"，字段全空，无报错。

## 踩坑

- 重编后落地 bundled 时 `prepareAioncore.js` 报 `EPERM` 删不掉 `resources/bundled-aioncore/win32-x64`（`fs.rmSync` 失败），但 Bash `rm -rf` 能删掉同一目录——疑似 Windows 侧瞬时文件锁（Defender 扫描之类），不是真的被进程占用。重试 `rm -rf` 后再跑脚本就通过了。
- 桌面端已经有个旧实例在跑（用户正在看的那个窗口，CDP 显示停在 `#/enterprise/console`），新起的 dev 检测到单例锁直接退出。新代码要生效必须重启窗口——这个操作会丢失当前页面状态，所以先问了用户再动手（`taskkill /F /T` 杀掉整个 electron 进程树，包括子进程 aioncore.exe，再重新 `bun run dev`）。
- CDP MCP 工具默认没连桌面端的 9230 端口（那是它自己的独立 Chrome 实例），跟上一轮一样改用 node 原生 WebSocket 直连 `/json/list` 的 page ws 跑 `Runtime.evaluate`（helper 见 scratchpad `cdp-eval.mjs`）。renderer 内部 `fetch('/api/one/...')` 相对路径直接 404（vite dev server 没代理这条），验证 API 层行为改成直接操作 DOM 触发真实保存流程 + 页面 reload 拉取，而不是绕过 UI 直接打 API。

## 提交 / 推送（已完成）

- 1oneCore `7160470a` → one-main（`SsoProviderConfigDto` + 管理员专属只读端点）
- 1oneUI `ad288dbaa` → one-main（`SsoSettingsTab.tsx` 预填 + ipcBridge 改指向新端点）

`cargo test -p one-sso`（28 passed，含新增 3 个 `redact_secret_fields_*` 测试）、`bun run test`（2228 passed）、`bunx tsc --noEmit`（0 error）、`oxlint`（0 warn/err）、`check-i18n`（passed，跟这个文件历来一样只有 warning 级别的未登记字面量 key，非本次引入）。

## 追加：管理端点补角色校验（同一 session，用户确认后原地修复）

排查过程中发现 `one_sso_admin_routes`（`GET .../providers` + `PUT .../{provider}`）只挂了通用 `auth_middleware`，没有管理员角色门控——任何登录成员理论上都能改企业 SSO 配置；LDAP 场景更严重，指向攻击者自建的假服务器、伪造已绑定身份的 external_id，可以借道公开端点 `POST /api/one/sso/ldap/login` 直接登录成那个账号（可能是管理员）。用户一开始以为"没人连接就没用"，纠正后确认是真实风险，同意原地修复（而不是拆去单独 session）。

**架构约束**：`one-sso`/`one-org` 是同层 domain crate，不能互相依赖（workspace 分层规矩），所以没有直接复用 `one-org::rbac::OrgActor`。

**修法**：`crates/one-sso/src/rbac.rs` 新增 `RequireSsoAdmin` extractor，语义照抄 `one-org` 的角色判断（`system_admin`/`org_admin`/legacy `admin` 放行，其余 403）——直接查同一张 `one_user_org` 表（`SsoService::effective_role`），跟 `one_org::OrgService::effective_role` 有少量逻辑重复，但避免了跨 crate 依赖，先堵洞优先于消重复。应用到两个 admin handler 上。

**测试**：新增 6 个单测（`effective_role` 三种角色解析路径：显式 `one_user_org` 行 / 桌面操作者哨兵用户默认 system_admin / 未知用户默认 member；`is_admin_role` 正反例）。非管理员 403 场景无法在单机 dev 环境构造（local 模式操作者恒为 `SYSTEM_DEFAULT_USER_ID`→system_admin），靠单测覆盖。

**验证**：`cargo test -p one-sso` 33 passed；重编 + 桌面端 CDP 回归——本机 system_admin 操作者仍能正常读写 SSO 配置（无回归）。

提交：1oneCore `5f71f75b` → one-main。

未打包。
