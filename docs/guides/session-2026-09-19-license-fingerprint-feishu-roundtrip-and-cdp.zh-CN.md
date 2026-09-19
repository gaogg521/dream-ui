# 2026-09-19：License 部署指纹绑定 + 飞书 SSO 真实往返 + 个人版/企业版 CDP 联动

> **这份文档的范围**（先划清，免得跟别的混起来）：
>
> - ✅ 接手 [`handoff-2026-09-18-enterprise-p0-and-sso-verification.zh-CN.md`](handoff-2026-09-18-enterprise-p0-and-sso-verification.zh-CN.md)
>   的全部可自动化待办并完成：SSO 验证档 1/2/**3**（档 3 这轮真正闭环了）、§5.4 企业形态
>   复验、§4 B/C 条目；外加「宝云模式 B」之外的 License 部署指纹绑定（billing_011）从半成品
>   到可用、注册机工具审查、飞书 400 排障、个人版↔企业版 CDP 联动全链路。
> - ❌ 不讲宝云支付 Phase 4（用户明确暂缓）、SAML/SCIM/RBAC/OIDC-JWKS（P0 大项，仍未做，
>   见 09-18 handoff §3）。
> - 提交清单：dream-core `188f9b2`（指纹绑定）、`b751fc2`（技能 .gitignore）、`07399f4`
>   （飞书错误体）、`e9da20b`（engine pin）；dream-ui `258f485`（向导面板回归测试）。
>   更早一轮的 engine i18n / 信箱去重 / dream-ui 文案已由并行会话提交
>   （`5f57546` / `7fd5266` / `9016f82`）。

---

## 一、License 部署指纹绑定（billing_011）—— 从半成品到闭环

**设计语义**（先读懂再动）：每套安装首次启动生成一个**随机**身份
（`sha256:<64hex>`，单例行 `one_license_installation`），写入申请码
（`ONEWORK-REQ-…`，base64url JSON：instanceId/deploymentFingerprint/appId/requestedAt/nonce）、
由厂商嵌进签名 License，**激活时服务端强比对**。`instance_id`（=enterprise_id）
与 `deployment_fingerprint` 的分工：前者挡"license key 发给别的部署"，后者挡
"企业数据被并进另一个部署后拿着旧 key 继续用"。**整库拷贝连指纹行一起拷走，
拷贝件与原件不可区分——这是设计的边界**（迁移文件头注释原话），挡的是 key
外流，不是全库克隆。

### 接手时是半成品（4 个缺口，全部补齐）

| #   | 缺口                                                                                       | 后果                                                   | 修复位置                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | `LicensePayload` 缺 `deployment_fingerprint` 字段                                          | 签发引擎**编译不过**（E0560，实测复现）                | `license_key.rs`（serde default，旧 license 无此字段保持可携）                                                             |
| 2   | billing_011 两个 SQL **没注册**进 `migrate.rs` 的 `MIGRATIONS`/`MIGRATIONS_MYSQL` 手写数组 | 迁移**永远不执行**，表不存在                           | 两个数组各补一行                                                                                                           |
| 3   | 申请码路由的"指纹"是 `sha256(instance_id\|app_id)` **算出来的**                            | 指纹可从申请码推出，绑定形同虚设；迁移表无任何代码引用 | `routes.rs` 改读 `deployment_fingerprint()`（惰性播种 + 首启引导种子，见 `dream-core-app/src/router/routes.rs` bootstrap） |
| 4   | `activate_license` **不比对、不落库**指纹                                                  | "复制到其他部署被拒"完全是空中楼阁                     | 激活前 `verify_deployment_binding`（大小写不敏感），激活行新增列，读回 DTO 带出                                            |

**测试**：billing 77 全绿（新增 3 条：指纹稳定/格式、匹配+异指纹+旧 license 可携、
读回带指纹）。MySQL 分支语法在 `migrations_mysql/` 有对应物，真实 MySQL 跑法
沿用 crate 里既有的 `DREAM_TEST_MYSQL_URL` 模式（本轮未跑，SQLite 全验）。

### CDP 真后端全链路（复现要点）

环境：全新数据目录 `data-en-cdp2`（迁移 011 真实落库，ledger 可查），
`dreamcore --features enterprise` :25808 + admin-web vite :25810（**必须 `--host`，
见 §四**）。步骤：

1. `GET /api/one/billing/license/request`（admin Bearer + CSRF）→ 申请码，指纹来自
   随机身份表（71 字符 `sha256:` + 64hex）。
2. 签发：**不要自己拼配置**——用
   `private-tools/onework-license-suite/issuer-engine`（`inspect-request` 解申请码 →
   `issue <config.json>`，secret 走环境变量 `ONEWORK_LICENSE_SIGNING_SECRET`）。
   **厂商私钥在本机 DPAPI**：`%LOCALAPPDATA%\OneWork\LicenseManager\issuer-key.json`
   （CurrentUser 解密，公钥与产品常量 `vCOzCf…` 匹配，已核验）。
3. `POST /api/one/billing/license` 激活 → `GET` 回读，`deploymentFingerprint` 与申请码一致。
4. **负向**：用真厂商签名伪造「本实例 ID + 异部署指纹」→ 403
   `"license is bound to a different deployment"` ✅。

**注册机工具审查结论**（`private-tools/onework-license-suite/`，仓库外）：
cmd → ps1 GUI → Rust 引擎三层。已修 2 处健壮性（密钥库 JSON 损坏会启动即崩 →
降级为"缺少密钥"；`createdAt.Substring` 加长度保护）。遗留注意：ps1 的
`Invoke-Engine` 用 `2>&1` 合并 stderr，引擎成功路径**必须**只往 stdout 打 JSON；
`[DateTimeOffset]::Parse` 按签发机本地时区解释模块时间窗（设计如此，跨时区签发要留意）。

---

## 二、飞书 SSO 400 排障实录（两个教训，一个修复）

**表象**：用户扫码授权后回调 500：`Feishu token exchange failed: HTTP 400 Bad Request`。

**修复（`feishu.rs`）**：交换失败时飞书回的是 OAuth 错误形状
`{"error":"invalid_grant","error_description":…}`，而旧代码往 `{code,msg}` 信封上解析，
把唯一有用的字段扔了、只报 HTTP 状态码。现保留原始 body 并把
`error_description` 带进错误消息——**这次能定位全靠它**（修完第一发就看到
"The client secret is invalid."）。

**根因**：给 provider 配置提参数时用了 `grep -A1 "App Secret" | tail -1`——
**取到的是下一行**（"Redirect URI：http://…"），库里 appSecret 存成 68 字符垃圾。
authorize 不用密钥所以一路全绿，交换才炸。

> ⚠️ **教训 1：从 feishu.txt 提取凭据一律用 node 正则精确匹配行首**
> （`t.match(/App Secret：(\S+)/)`），别用 grep 的上下文行。
>
> ⚠️ **教训 2：给 node 传环境变量要写在 node 前面**（`FS_SECRET=… node -e`）。
> 本轮差分诊断第一发把变量写在了脚本参数位置，secret 实际是 undefined，
> 得出过一次错误的安全结论。

**差分诊断法**（不需要真 code）：用假 code 打
`POST https://open.feishu.cn/open-apis/authen/v2/oauth/token`——客户端认证不过会报
invalid_client，认证过了报 `invalid_grant: code not found`（HTTP 400 但语义是
"凭据正确，code 无效"）。本轮用它证明 client_id/secret/redirect_uri 三者皆有效。

---

## 三、飞书真实往返（档 3 闭环）+ 重复登录语义

`authorize?desktop=1&scheme=dream-dev` → 用户点登录 → 回调（走 :25810 vite 代理）
**两次 200**（04:20:45 / 04:21:30，1.0–1.1s）→ JIT 建号 `sso_01a0b7b7`（显示名 赵高）、
`one_sso_identities` 落真实 union_id、自动入 enterprise 租席（member，席位 2/50）→
落地页 `dream-dev://sso-callback` → **桌面端收到会话且重复登录会刷新 token**
（tokenTail 从 `ckkAU4oA` 换成 `XUA2aWsU`，旧会话被替换）→ 桌面持新 token 调
`billing/plan` 200。

桌面端收深链的前提（安全设计，别当 bug）：`useDeepLink.ts` 的 sso-callback 处理器
**要求 `getEnterpriseServerUrl()` 已配置**，否则静默忽略。测试时先写
`one-enterprise:server-url`（与 UI 的"连接"按钮等价的 localStorage 写入）。

LDAP 通道上一轮已完整往返（`ldaps://10.0.127.110:636`，AD 凭据见
`C:\Users\allenzhao\Desktop\feishu.txt`——**提取凭据见 §二教训 1**）。

---

## 四、个人版↔企业版 CDP 联动——环境拓扑与坑

```
企业后端  dreamcore --features enterprise --data-dir data-en-cdp2   :25808
治理进程  dreamcore-admin --port 25809（共享同一数据目录，可选拉起）
管理台    admin-web vite dev   :25810   DREAM_BACKEND_URL=http://127.0.0.1:25808
桌面端    dream-ui `DREAM_DEVTOOLS_CDP_PORT=9230 bun run dev`（注册 dream-dev://）
调试浏览器 Chrome --remote-debugging-port=9333（profile: scratchpad/cdp/chrome-profile）
```

- **vite 必须 `bun run dev -- --host`**：飞书注册的回调 origin 是
  `http://172.29.128.120:25810/...`（本机 LAN IP，写死在飞书开放平台侧），
  vite 默认只听 localhost，回调会直接连接拒绝。本机 IP 变了要同步改
  provider 配置里的 redirectUri **和** 飞书后台的注册值（两边必须逐字一致）。
- **Chrome 启动的坑**：后台任务里用 `(&)` 子壳detach 启动 Chrome，CDP 端口经常
  没起来就返回了；**用 `run_in_background` 的普通命令直启**（前台进程树）稳定。
  CDP refused 时先 `curl http://127.0.0.1:9333/json/version` 再猜。
- **驱动真实 UI 用裸 ws + Runtime.evaluate**（`scratchpad/cdp/cdp.mjs`，可复用），
  比 MCP 顺；React 受控输入用 native setter + input 事件；Arco 按钮发完整
  PointerEvent 序列。整页导航会掐断 CDP 连接，分步做。
- 桌面端每次 dev 启动都会 `setAsDefaultProtocolClient('dream-dev')`（打包版
  `dream://`，LEGACY `aionui`/`aionui-dev` 同样注册并接受）。
- **个人版判据**（09-18 handoff §1 的快速一发）本轮再次实证：桌面自带本地 core
  （bundled，个人版）`/api/one/sso/providers` → 404 `NOT_FOUND`；企业后端同路由
  → 200。

---

## 五、技能物化 .gitignore（§4.C 那条"没人跟进"的待办，已落地）

`link_workspace_skills`（`dream-core-extension/src/skill_service.rs`）现在在创建
链接/复制**之前**：从工作区向上找 `.git`（cheap ancestor walk，不 shell 出 git）；
在仓库内则把缺失的 `/<skills-dir>/` 追加进**工作区级** `.gitignore`
（git 对子目录 .gitignore 生效，仓库根在上层也覆盖得住）。**只追加、幂等、
非仓库工作区完全不碰**。失败只 warn 不致命——技能交付 outranks git 卫生。
2 条新测试（仓库内追加+幂等、非仓库不落盘）。

**向导面板**（dream-ui `EnterpriseLoginChannelPanel`）同期补了 2 条 dom 回归测试
（首帧本地 404 → 远程应答后徽章/提示/点击路由完全恢复；未配置渠道"徽章先说、
点击解释"）。**组件状态机没有 bug**——线上见过的「未配置」残留是首帧环境性
表现，行为已被测试钉死，不要再当 bug 修。

---

## 六、环境与凭据备注（本机）

- 测试部署：`D:/dream/dream-core/data-en-cdp2/`（本轮全部真机验证所在；
  旧的 `data-en-cdp/` 是第一轮的，已无用可删）。测试库管理员
  **admin / qwer1@34**（应用户要求重置，仅本地测试部署）。
- 飞书 App：`cli_a82fc9a473f6500c`，secret 与 LDAP 域控凭据在
  `C:\Users\allenzhao\Desktop\feishu.txt`（**提取见 §二教训 1**；secret 建议按
  09-18 handoff 轮换——它进过更早会话的对话记录）。
- 厂商签发身份：`%LOCALAPPDATA%\OneWork\LicenseManager\issuer-key.json`
  （DPAPI CurrentUser）。**产品验签公钥常量在
  `dream-domain-billing/src/license_key.rs`，工具只接受与之匹配的密钥**；
  本轮**没有**改这个常量（feishu.txt 里那对密钥是旧仓库时期的，公钥对不上）。
- CDP 工具：`D:/dream/scratchpad/cdp/cdp.mjs`（list/new/nav/eval/shot/events）。

## 七、仍未竟

只剩两条（用户 09-19 拍板，其余 §7 条目当轮做掉）：

- SAML / SCIM 2.0 / OIDC JWKS / 细粒度 RBAC —— 09-18 handoff §3 的 P0 大项，
  需单独立项，各有独立验收标准。
- 宝云支付 Phase 4 —— 用户明确暂缓。

**已做掉的原 §7 条目**（2026-09-19，dream-en `0de0acb`/`8382c17`/`1baa047`）：

- **License 详情页渲染 `deploymentFingerprint`**：接手工作区里现成的半成品
  （类型字段 + 渲染行），把写死的中文标签改到 `common.billing.*` i18n
  （13 语种补 `licenseDeploymentFingerprint`），licenseTab 测试补 2 条断言
  （有指纹渲染、无指纹不渲染）。
- **resourceMatrixTab 既有失败**：不止是测试写错——修歧义断言时暴露了
  **真 BUG**：`EffectiveSummary` 的 effect 把 `t` 列进依赖，mock 环境 t 每渲染
  换新引用 → `effective` 无限重取（19,096 次）。组件去掉 `t` 依赖 + 测试 mock
  改模块级稳定 `t`，4/4 过。
- **§5.3 跨仓 scheme 一致性锁**：
  `dream-en/admin-web/tests/deep-link-scheme-cross-repo.test.ts` 直接读兄弟
  checkout 的 dream-core `routes.rs` 源码，断言两侧字面量**有效等价**
  （同一 fallback、并集内每个 scheme 两侧都自映射）；非并排检出时自动 skip。
  这就是文档里说"没有任何东西锁住"的那把锁。
