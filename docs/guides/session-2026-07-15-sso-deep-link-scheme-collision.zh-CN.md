# 2026-07-15 企业 SSO 桌面 deep link 被 dev/打包版互相抢注根治

> 用户反馈：飞书企业客户端登录流程里，浏览器明明显示"登录成功，可以关闭此页面"，回到桌面端却还是访客模式，怎么点都不变。前端 `1oneUI` + 后端 `1oneCore`（`one-sso` crate）跨仓改动。**已重编本机 dev 验证通过，未出正式安装包**。

## 根因

企业 SSO 桌面登录靠 OS 级 `aionui://` URL protocol 把 token 从系统浏览器带回桌面进程（[routes.rs `desktop_callback_page`](../../../1oneCore/crates/one-sso/src/routes.rs)：飞书授权成功后，后端渲染一个小落地页，`location.href = "aionui://sso-callback?token=...`）。

问题是 `PROTOCOL_SCHEME` 之前是硬编码的常量 `'aionui'`（[`process/utils/deepLink.ts`](../../packages/desktop/src/process/utils/deepLink.ts)），dev 模式（`bun run dev`）和打包安装版**共用同一个 scheme**。`app.setAsDefaultProtocolClient('aionui')` 在**每次启动**都会无条件调用（`index.ts` 模块顶层，非 `app.whenReady` 内），而这是 Windows/macOS 上一个全局唯一的注册表 key——谁最后启动谁就把它抢走。

实测复现路径：这台机器上最后一次跑的是 dev 模式（`bun run dev`，来自 `D:\aionui-m0\1oneUI`），把 `HKCU\Software\Classes\aionui\shell\open\command` 抢注成指向 dev 版 `electron.exe`。用户随后测试的是打包安装版 `1onecode.exe`（`C:\Users\...\AppData\Local\Programs\1onecode\1onecode.exe`，Start Menu 快捷方式 "1ONE Code"）。飞书授权成功后浏览器触发 `aionui://sso-callback`，Windows 把它转发给了注册表里登记的 dev 版进程（不是用户正盯着看的打包版），deep link 的 IPC 事件从未到达打包版渲染进程，`setEnterpriseSession`/`setEnterpriseModeEnabled` 都没执行——桌面端永远停在访客模式，尽管浏览器那边确实登录成功了。

这不是 SSO 回调的业务逻辑 bug，纯粹是 OS 协议归属的抢占问题——只要还在"打包版 ↔ dev 模式"来回切换测试就会反复复现。

## 验证方法（先证实根因，再动代码）

1. 查注册表 `HKCU\Software\Classes\aionui\shell\open\command`，确认当前指向 dev 版 `electron.exe` 而非打包版安装路径。
2. 起一个全新 dev 实例（`frontend-dev.ps1`），CDP 连上渲染进程，把 `one-enterprise:server-url` 设成用户提供的远端服务器（`http://192.168.11.159:25808`，即真实飞书场景里点击按钮前 `RemoteServerSection.handleSsoLogin` 会做的事）。
3. 真实飞书扫码授权需要人工手机操作，做不到；改用 `Start-Process "aionui://sso-callback?token=...&userId=...&username=..."` 直接模拟浏览器落地页会执行的 `location.href` 跳转（`token` 是编造的，只为验证 deep link 传输链路本身，不验证 JWT 校验）。
4. 观察：hash 跳到 `#/settings/enterprise`、页面 reload、`localStorage` 正确写入 session、侧栏身份区从"访客"变成 `sso_test_user`/"企业团队版"。证明 deep link → `useDeepLink.ts` → `enterpriseMode` → `WorkspaceIdentityEntry` 这条链路本身完全正常，只要协议真的指向这个运行中的实例。

## 修法：dev/打包版分开抢注两个不同的 scheme

- **前端**：`PROTOCOL_SCHEME` 从硬编码常量改成 `app.isPackaged ? 'aionui' : 'aionui-dev'`（`process/utils/deepLink.ts`）。`index.ts` 里已有的注册/解析逻辑全部复用这个常量，无需改动。
- 新增 IPC `get-deep-link-scheme`（`index.ts`）+ preload 注入 `window.__deepLinkScheme`（`preload/main.ts` + 类型声明 `common/types/platform/electron.ts`），让 renderer 知道**这个进程**注册的是哪个 scheme。
- `enterpriseBrowserLogin.ts` 的 `openEnterpriseOAuthInBrowser`（唯一会带 `desktop=1` 发起桌面 OAuth 的调用点，`RemoteServerSection`/`EnterpriseLoginChannelPanel` 都走它）在请求 authorize URL 时多带一个 `scheme` 查询参数，值取 `window.__deepLinkScheme`。
- **后端** `one-sso`：`AuthorizeQuery` 新增 `scheme` 字段；新增 `sanitize_deep_link_scheme()` 做**闭集合白名单**校验（只认 `"aionui-dev"`，其余一律回落到 `"aionui"`）——这个值不经过 `urlencode` 就直接拼进回调页 HTML（同时是 JS 字符串字面量和 href 属性），必须严格限制，不能做成通用 scheme 校验器（防 `javascript:`/引号逃逸等注入）。`OAuthStateEntry`/`OAuthStateStore::issue` 透传这个值，`callback()` 里原来硬编码的 `format!("aionui://sso-callback?{params}")` 改成用 `entry.deep_link_scheme`。

旧客户端（不带 `scheme` 参数）行为不变——回落到 `"aionui"`，跟原来的硬编码值一致。

## 实测（桌面端 CDP，2026-07-15）

`cargo build` 重编 + `backend-rebuild.ps1` 落地 bundled 后重启 dev 实例：

1. `window.__deepLinkScheme` 读到 `"aionui-dev"`（确认 preload 注入链路通）。
2. `HKCU\Software\Classes\aionui-dev\...` 已指向这个新 dev 实例；此前的 `aionui`（生产 scheme）key 不再被 dev 触碰。
3. 重复"复现"步骤里的 `Start-Process` 测试，但这次用 `aionui-dev://sso-callback?...`——hash 跳转、session 写入、侧栏身份区变化，跟修复前完全一致，证明改了 scheme 之后链路依旧完整。

之后清空了测试写入的假 session，未污染真实 dev 数据。

**后续如果要在这台机器上彻底验证**：打包版 `1onecode.exe` 首次重新启动时会自然抢回 `aionui`（因为 `app.isPackaged` 为 true，逻辑不变，跟旧版打包代码算出的值相同），不需要额外操作；之后跑 dev 只会抢 `aionui-dev`，两边再也不会互相打架。

## 测试

- `cargo test -p one-sso --lib`：43 passed（含新增 `sanitize_deep_link_scheme_allows_only_the_known_schemes`，覆盖白名单值/空值/`None`/`javascript`/引号注入 payload 五种输入）。
- `cargo clippy -p one-sso -- -D warnings`：0 warning。
- `cargo fmt --all -- --check`：`one-sso` 相关文件干净（workspace 里其它无关文件本来就有历史 fmt 漂移，未处理，不在本次改动范围）。
- `bunx tsc --noEmit`：0 error。
- `bunx oxlint` / `oxfmt --check`：改动文件 0 warning/error。
- `bunx vitest run tests/unit/enterprise --project dom`：3 passed（新增 `enterpriseBrowserLogin.dom.test.ts` 两个用例：`scheme` 参数正确带上 `window.__deepLinkScheme`；未注入时回落 `"aionui"`）。

## 提交 / 推送

见对应 commit（1oneCore + 1oneUI，均推 one-main）。
