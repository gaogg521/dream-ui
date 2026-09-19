# 交接：企业版 P0 五条 + SSO 到底怎么验（2026-09-18）

> **这份文档的范围**（先划清，免得跟别的混起来）：
>
> - ✅ 讲两件事：① 本轮动过 SSO 深链 scheme 之后**怎么验证**；② 企业版 P0 那五条**下一个人怎么接着做、怎么验收**。
> - ❌ 不讲本轮品牌清扫本身干了什么 —— 那在
>   [`session-2026-09-18-brand-sweep-and-what-it-uncovered.zh-CN.md`](session-2026-09-18-brand-sweep-and-what-it-uncovered.zh-CN.md)
>   和 dream-core 的
>   `docs/guides/session-2026-09-18-brand-sweep-and-the-compat-layers-it-broke.zh-CN.md`。
> - ❌ 更不是历史 PRD 里那 626 个空勾选框的事 ——
>   那是[另一份审计](doc-checkbox-audit-2026-09-18.zh-CN.md)，跟本文没关系。

---

## 一、开工前必读：个人版与企业版是两个构建，SSO 只存在于后者

**这是刻意的产品设计，不是坑。** 一开始我把它当成「踩到的雷」写，是错的 ——
`Cargo.toml` 的注释本身就给了安全理由：

> Enterprise governance plane. **OFF by default: the personal edition must not
> ship the admin backend**, and until this existed the only thing standing
> between a member and it was a client-side role check in the UI.

企业版是独立形态（`dream-en/`，自带 admin-web + 部署脚本），
`--features enterprise` 是它既定的构建方式 —— dream-en 的十几份 audit / handoff
都这么写，还有 `just build-enterprise`。
`audit-2026-09-07-capability-distribution-recheck.zh-CN.md` 原话就是
「个人版构建（不含 `--features enterprise`）」。

所以下面这些不是排障技巧，是**「你现在在哪个形态上」的判定方法**。

```rust
// crates/dream-core-app/src/router/routes.rs:2659
#[cfg(feature = "enterprise")]
pub(crate) fn build_governance_plane(...)
```

```toml
# crates/dream-core-app/Cargo.toml:17
default = ["telegram", "lark", "dingtalk", "weixin", "slack", "discord"]
#          ^^^ 不含 enterprise
```

`/api/one/{org,enterprise,billing,admin,sso}/**` **全部**挂在这个 feature 后面。默认构建里这些路由
**不是被拒绝，是根本不存在**。

真机实测（本轮，dev 后端 `127.0.0.1:62069`）：

```text
GET /api/one/sso/providers            → 404 {"code":"NOT_FOUND","error":"Route not found."}
GET /api/one/sso/feishu/authorize?... → 404 同上
```

> 上面那两条 404 是在**个人版 dev** 上打的 —— 对个人版来说这是**正确行为**，
> 治理面本来就不该在用户机器上存在。
>
> 企业形态要这么起：`cargo build -p dream-core-app --features enterprise`，
> 或用独立的 `dreamcore-admin`（`src/bin/admin.rs`，只挂治理面，
> 跟主服务共用同一个 `build_governance_plane`，两边不会漂）。
>
> **判定「SSO 不工作」时**：先确认是哪个形态。个人版上 404 = 符合预期；
> 企业版上 404 = 才是问题。

还有第二道**运行期**闸门，位置在 `SsoService::sso_login_allowed()`：

```sql
SELECT COUNT(*) FROM one_enterprise_license l
  JOIN one_license_activation a ON a.enterprise_id = l.enterprise_id
 WHERE l.tier IN ('team','enterprise') AND (l.expires_at IS NULL OR l.expires_at > ?)
```

没有生效中的 team/enterprise license → `authorize` 返回 **403 "SSO is unavailable on the
free or unofficial plan"**。这跟配置对不对无关。

**排障速查 —— 看 `code` 字段，不要看状态码**：

三种完全不同的失败**都回 404**（`error.rs:56` 把 `ProviderNotConfigured`
和 `ProviderDisabled` 也映射成 `NOT_FOUND`）。只看状态码会把「二进制编错了」
误诊成「配置没填」，能白烧半天。**唯一可靠的判据是响应里的 `code`。**

| HTTP | `code`                                                | 病因                                        | 下一步           |
| ---- | ----------------------------------------------------- | ------------------------------------------- | ---------------- |
| 404  | `NOT_FOUND`                                           | **二进制没编 `enterprise`**，路由根本不存在 | 重编，带 feature |
| 404  | `SSO_PROVIDER_NOT_CONFIGURED`                         | 路由在，但 provider 行不存在 / 缺 `appId`   | 补配置（见下）   |
| 404  | `SSO_PROVIDER_DISABLED`                               | provider 行 `enabled=0`                     | 打开开关         |
| 403  | — `SSO is unavailable on the free or unofficial plan` | 没有生效中的 team/enterprise license        | 激活 license     |

本轮真机实测（`dreamcore-admin` 跑在 `127.0.0.1:62311`，空数据目录）：

```text
GET /api/one/sso/providers                            → 200 {"success":true,"data":[]}
GET /api/one/sso/feishu/authorize?...&format=json     → 404 {"code":"SSO_PROVIDER_NOT_CONFIGURED"}
```

对照默认构建（`127.0.0.1:62069`）上**同样的两个请求**：两条都是
`404 {"code":"NOT_FOUND"}`。**`/api/one/sso/providers` 返回 200 还是
`NOT_FOUND`，就是判断这个二进制编没编 `enterprise` 的最快一发。**

---

## 二、SSO 怎么验证

本轮改的是**一件很窄但很容易静默炸掉**的事：桌面端登录成功后，后端要把
token 通过 `<scheme>://sso-callback?...` 深链交还给客户端。改名之后 scheme 从
`aionui` 变成 `dream`，而**旧客户端只向操作系统注册过 `aionui://`**。
`sanitize_deep_link_scheme` 一旦把旧值 fallback 错，旧客户端的回调就被悄悄丢掉 ——
不报错，浏览器标签页干坐着。

按「需要多少东西」分三档，**从上往下做，能停在哪档就停在哪档**。

### 档 1 — 零凭据、零网络、零数据库（**本轮已做，当回归跑**）

```bash
cd dream-core
cargo test -p dream-domain-sso --lib
```

**通过标准**：`80 passed; 0 failed`。其中直接管深链的 4 条：

| 测试                                                                      | 管什么                                          |
| ------------------------------------------------------------------------- | ----------------------------------------------- |
| `sanitize_deep_link_scheme_allows_only_the_known_schemes`                 | 白名单 + 兜底值 + 注入拦截                      |
| `deep_link_scheme_survives_the_state_round_trip_for_every_allowed_scheme` | **本轮新增** · scheme 穿越 state token 不丢不变 |
| `state_nonce_cannot_be_consumed_twice`                                    | **本轮新增** · state 一次性                     |
| `callback_page_carries_the_current_product_name`                          | **本轮新增** · 落地页产品名                     |

**为什么这一档就足以覆盖本轮改动**（这点很关键，别被「没走真实 IdP」吓退）：

scheme **不走查询串穿越 IdP**。它在 `authorize` 时被 `sanitize_deep_link_scheme` 规范化，
然后塞进服务端的 `OAuthStateEntry`；IdP 回来时只带回一个不透明的 `state`，
`callback` 从 entry 里把 scheme 读回来。中间的 token 交换
（`exchange_code` / `fetch_user_info`）**从不读也不写 `deep_link_scheme`**。

所以 `issue → consume` 这一段测到了，IdP 那一段对 scheme 就是无关变量。

**这个测试不是摆设 —— 做过反证**：把 `service.rs` 的 `issue` 硬编码成
`deep_link_scheme: "aionui"`，round-trip 测试立刻转红（`routes.rs:1013`），
其余 79 条全绿。改回后复绿。

### 档 2 — 要真后端，但**不需要真 IdP、不需要真密钥**

用来证明「路由挂上了、license 闸过了、provider 行能解析、state 发得出来」。

关键点：**飞书/钉钉/企业微信的 `build_authorize_url` 是纯字符串拼接，不发任何网络请求**
（只有 OIDC 会去拉 discovery）。所以 `appId`/`appSecret` 填**占位假值**就能跑通这一档。

> ⚠️ 别填真密钥。这一档的全部意义就是**不需要**真密钥。

1. 起一个带 feature 的后端：

   ```bash
   cd dream-core
   cargo build -p dream-core-app --features enterprise --bin dreamcore-admin
   ```

2. 保证有一张生效中的 team/enterprise license（否则 §1 第二道闸直接 403）。
3. 写一条 provider 行（管理端 `PUT /api/one/admin/sso/feishu`，body 形状见
   `models.rs:97` 的 `UpdateProviderBody`）：

   ```json
   {
     "enabled": true,
     "config": {
       "appId": "cli_PLACEHOLDER",
       "appSecret": "PLACEHOLDER",
       "redirectUri": "http://127.0.0.1:PORT/api/one/sso/feishu/callback"
     }
   }
   ```

4. 打探针 —— **`format=json` 会直接返回 `{goto, state}` 而不跟随跳转**，
   所以不会真的把浏览器送去飞书：

   ```bash
   curl "http://127.0.0.1:PORT/api/one/sso/feishu/authorize?desktop=1&scheme=dream&format=json"
   ```

**通过标准**：

- HTTP 200，`data.goto` 是飞书授权 URL，`data.state` 是一个 32 位 hex nonce。
- `goto` 里的 `redirect_uri` 与上面配置的一致。
- **把 `&scheme=dream` 整个去掉再打一次**（模拟旧客户端），同样返回 200 ——
  旧客户端不发这个参数是**合法**的，兜底到 `aionui` 是设计行为，不是 bug。

**这一档验不到什么**（别高估它）：它到不了 `callback`，所以深链最终长什么样它看不见。
那一段由档 1 覆盖。

> ~~本轮只把这一档跑到了「路由挂上 + provider 未配置时的正确拒绝」为止~~
> **✅ 已于 2026-09-19 完成**（license 走真实激活路径、provider 行落库、探针矩阵全过、
> 伪造指纹 403），复现步骤与结果见
> [`session-2026-09-19-license-fingerprint-feishu-roundtrip-and-cdp.zh-CN.md`](session-2026-09-19-license-fingerprint-feishu-roundtrip-and-cdp.zh-CN.md) §一/§四。

### 档 3 — 真实 IdP 往返（**需要人工，我没做**）

> **✅ 已于 2026-09-19 完成**：飞书（用户扫码，真实 OAuth 往返 + 重复登录刷新）
> 与 LDAP（`ldaps` 域控完整往返 + JIT 建号 + 负向）两路都已闭环，用户明确授权从
> `feishu.txt` 取凭据代填。过程、根因（提参数 bug 把 "Redirect URI：…" 存成了
> appSecret）与排障方法见
> [`session-2026-09-19-license-fingerprint-feishu-roundtrip-and-cdp.zh-CN.md`](session-2026-09-19-license-fingerprint-feishu-roundtrip-and-cdp.zh-CN.md) §二/§三。
> 下面三条验收全部实测通过，保留原文供复查口径。
> ⚠️ 早前会话泄漏进对话记录的**飞书 App Secret / Agnes KEY / 豆包 KEY / license
> 签名 SECRET 仍建议轮换**（本轮未再泄漏；licore 签名身份现走 DPAPI 密钥库，
> 与 feishu.txt 里那对旧公钥已不匹配）。

人工做的时候，重点盯这三条（前两条是本轮改动的真正风险面）：

1. **新客户端**：桌面端发起登录 → 浏览器完成 IdP → 落地页应当自动拉起
   `dream://sso-callback?...`，应用收到 token 并登入。
2. **旧客户端兜底**：把 `authorize` 的 `scheme` 参数**去掉**再走一遍完整流程 →
   落地页的「打开应用」按钮 href 必须是 `aionui://sso-callback?...`。
   这条最容易被无声改坏 —— 老用户升级前的客户端只认这个 scheme。
3. **落地页正常渲染**：登录成功后那页要出得来，「打开应用」按钮可点。

> 📌 **`1One Work` 已于 2026-09-19 改为 `One Work`。**
> 它是上一代的叫法（与 `1ONE Code` 同期），现行产品名是 **One Work**。
> 2026-07-21 那轮改名做了 825 处替换并验证「全库为空」，但**只扫了 dream-ui** ——
> dream-core 这几处是漏网的：SSO 落地页（标题/正文）、ACP 握手的 `clientInfo.name`、
> 4 个内置技能 markdown（45 处）。
>
> **没有跟着改的**（改了会弄坏存量安装，别顺手扫）：
> `LEGACY_PROD_USERDATA_APP_NAMES = ['1ONE Code']`、
> `resources/windows/support/report-installer-failure.ps1` 的目录探测列表、
> `data_paths.rs` 里说明这些冻结值的注释 —— 那是**查找旧数据目录用的键，不是品牌文案**。
> `1ONE CLI` 是 CLI agent 自己的名字，也不在范围内。

---

## 三、企业版 P0 五条 —— 接手指南

来源：[`enterprise-team-roadmap.zh-CN.md`](enterprise-team-roadmap.zh-CN.md) §2 P0。

> **⚠️ 路径漂移**：roadmap 写于改名之前，里面的 `one-sso/...` 现在叫
> `crates/dream-domain-sso/...`，`one-billing` → `dream-domain-billing`，
> 其余 `one-*` crate 同理。**按 crate 名搜，别按 roadmap 的路径找。**

### 总览

| #   | 条目                         | roadmap 状态 | **实际状态（本轮核实）**                    | 体量       |
| --- | ---------------------------- | ------------ | ------------------------------------------- | ---------- |
| 1   | SAML                         | `[ ]`        | ✅ 属实，没做                               | 大         |
| 2   | SCIM 2.0 入站                | `[ ]`        | ✅ 属实，没做                               | 中         |
| 3   | OIDC 硬化（JWKS 验签）       | `[ ]`        | ✅ 属实，没做（代码里有明确的 v1 范围说明） | 小         |
| 4   | P0-3 席位/license + 用量看板 | `[ ]`        | ⚠️ **状态过期 —— 主体已实现**，见下         | 已大半完成 |
| 5   | P0-4 细粒度 RBAC + 资源分权  | `[ ]`        | ✅ 属实，没做                               | 大         |

---

### P0-2a · SAML

**现状**：完全没有。`crates/dream-domain-sso/src/providers/` 下只有
`dingtalk.rs` / `feishu.rs` / `ldap.rs` / `oidc.rs` / `wecom.rs`。

**从哪下手**：照 `oidc.rs` 的形状加 `saml.rs`。它是最近的模板 —— 同样是
「外部标准协议 + 一个 provider 文件 + 一张配置卡 + 一个登录按钮」，且
**加它的时候没有动迁移**，说明 provider 行的 `config` JSON 容得下新形状。

**难点不在接线，在密码学**：

- XML 规范化（C14N）—— 签名是对规范化之后的字节算的，这一步错了签名永远对不上。
- 签名验证（XML-DSig，`SignedInfo` / `Reference` / `DigestValue` 三层）。
- IdP metadata 解析（拿证书和 SSO 端点）。
- Assertion 的**重放防护**与时间窗（`NotBefore`/`NotOnOrAfter`/`InResponseTo`）。

**验收标准**（缺一不可）：

- [ ] 用 Okta 或 SimpleSAMLphp 起一个测试 IdP，跑通一次真实登录。
- [ ] **负向测试**：篡改 assertion 任意一个字节 → 必须拒绝。这条不过等于没做签名验证。
- [ ] **负向测试**：过期 assertion、重放同一个 assertion → 必须拒绝。
- [ ] JIT provisioning 行为与 OIDC 一致（复用 `service.rs` 里那套，见
      `jit_provisioning_*` 三条既有测试）。
- [ ] 单测覆盖对齐 OIDC 的水位（OIDC 落地时是 53 条 / 7 条 wiremock）。

---

### P0-2b · SCIM 2.0 入站 provisioning

**现状**：没有。但**目录同步的骨架已经在了** ——
`crates/dream-domain-sso/src/directory.rs`（飞书目录树拉取、部门重建、
「没配置就不同步」的三条守卫测试）。SCIM 是它的「推」模式对应物。

**为什么是合规红线**：离职必须自动回收权限。现在靠**轮询**目录同步，
IdP 推送才能做到即时。

**从哪下手**：新增 SCIM 端点组（`/scim/v2/Users`、`/scim/v2/Groups`，
标准 REST + `PATCH` 语义），鉴权用 bearer token。**注意 SCIM 的 `PATCH`
不是 JSON Patch**，是它自己的 `Operations` 方言，这是最常见的踩坑点。

**验收标准**：

- [ ] `POST /scim/v2/Users` 建人 → 本地出现对应用户，角色为默认 member。
- [ ] `PATCH` 把 `active` 置 false → **该用户的现存会话立即失效**。
      复用 `dream-domain-enterprise/src/session_revoker.rs`，不要另起一套。
- [ ] `DELETE` → 走既有的离职归属转移（`admin_devops_routes` 里的 offboarding），
      不要把数据直接删掉。
- [ ] 幂等：同一个 `externalId` 重复 POST 不产生第二个用户。
- [ ] 至少过一遍 Okta 或 Azure AD 的真实 SCIM 推送（两家的方言有差异）。

---

### P0-2c · OIDC 硬化：id_token 签名校验（JWKS）

**这条最小、最该先做**，而且代码里已经把「欠的是什么」写清楚了：

```rust
// crates/dream-domain-sso/src/providers/oidc.rs:15-21
//! # Security note (v1 scope)
//! Identity is read from the **userinfo endpoint** using the access token,
//! ... so the claims are trusted without separately verifying the `id_token`
//! JWT signature against the IdP's JWKS. Full `id_token` signature
//! verification (JWKS fetch + `jsonwebtoken`) is a hardening follow-up,
//! not required for a correct, secure v1.
```

**先读懂这段再动手**：现状**不是漏洞**。身份取自 userinfo 端点，而 access token
本身是用 client secret 在 TLS 上从 token 端点换来的 —— 链条是闭合的。
这条是**纵深防御**，不是补洞。别在提交信息里写成「修复安全漏洞」。

**从哪下手**：`discover()` 已经在拉 `.well-known/openid-configuration`，
`jwks_uri` 就在那份响应里。加 JWKS 拉取 + 缓存（按 `kid`），用 `jsonwebtoken` 验签。

**验收标准**：

- [ ] 正常 id_token 验签通过，身份与 userinfo 返回的一致（不一致要报错，不能二选一）。
- [ ] **负向**：签名被篡改 → 拒绝。
- [ ] **负向**：`kid` 在 JWKS 里找不到 → 拒绝（且触发一次 JWKS 刷新，防 IdP 轮换密钥）。
- [ ] **负向**：`alg: none` → 拒绝。这是 JWT 的经典坑。
- [ ] `iss` / `aud` / `exp` / `nonce` 逐项校验。
- [ ] JWKS 端点挂掉时的降级行为是**明确选择过的**，并写进注释。

---

### P0-4 · 细粒度 RBAC + 资源分权

**现状**：三档写死 —— `member` / `org_admin` / `system_admin`
（`crates/dream-domain-org/src/models.rs:25-26`），判定入口是
`OrgService::effective_role()`（`service.rs:242`）和
`crates/dream-domain-org/src/rbac.rs`。

**目标**：谁能建技能 / 谁能下发 MCP / 谁能看哪个知识库；RAG 知识库从**团队级**
细化到**按文档、按角色**。

**接手前务必先读这两条既有约束**，否则会做出一个在客户机器上不生效的权限系统：

1. 治理面是编译期 feature（见 §1）。客户端跑的个人版二进制里**根本没有**这些闸门 ——
   权限必须在**服务端**判定，不能只在客户端判。
2. `one_user_org` 是能力下发的唯一凭据；安全策略对**无租户**用户是
   **fail-open**（个人版必须能用）。加细粒度权限时不要把这个默认改成 fail-closed，
   会把所有个人版用户锁死。

**验收标准**：

- [ ] 新权限模型对**无租户**用户完全无影响（照抄现有的个人版锁死测试形式）。
- [ ] 每一条新权限都有**负向测试**：无权角色访问 → 403，且是**服务端**返回的 403。
- [ ] 知识库按文档分权：A 能看文档 1、看不到文档 2，**且 RAG 检索结果里不出现文档 2**
      （只把 UI 藏掉不算过）。
- [ ] 角色变更后，**已签发的会话**权限随之收紧（同样复用 `session_revoker`）。
- [ ] 迁移把存量三档角色**无损**映射到新模型。

---

### ⚠️ P0-3 · 席位/license + 用量看板 —— **roadmap 状态是过期的**

roadmap 记的是 `[ ]`（未做）。本轮核实：**主体已经实现并且正在线上起作用。**

证据（都可以自己复核）：

| 位置                                         | 内容                                                                                                                                                                                                      |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crates/dream-domain-billing/`               | 完整 crate：`license_key.rs` / `models.rs` / `routes.rs` / `service.rs` / `migrate.rs`                                                                                                                    |
| `dream-domain-billing/src/routes.rs`         | 20+ 路由：`plan` / `usage` / `enterprise-report` / `llm-calls` / `key-usage` / `sessions` / `conversation-cost` / `tier` / `model-control` / `license/request` / `checkout` / `webhook` / `media-usage` … |
| `dream-core-app/src/router/routes.rs:2768`   | `one_billing_routes(...)` 真的被构建                                                                                                                                                                      |
| 同上 `:3150` / `:3723`                       | `.merge(governance.billing)` —— 两个 router 都挂了                                                                                                                                                        |
| `dream-en/admin-web/src/console/components/` | `BillingTab` / `LicenseTab` / `UsageOverviewTab` / `EnterpriseReportTab` / `MediaLedgerTab` / `ChannelModelReportTab`                                                                                     |
| `dream-domain-sso/src/service.rs:294`        | 注释原文 **「P0-3 license gate」** —— 它已经在拦 SSO 开关了                                                                                                                                               |

**还差的是什么**：真实支付。`BillingProvider` 是一个**打桩的**支付 seam
（`lib.rs` 原话：_a stubbed payment-provider seam ... so real payment can drop in later_）。
对应的落地计划见 memory「宝云模式B交接文档」—— 三端 Phase 1-3 完成、CDP 真机全链路已过，
**只差 Phase 4 真实支付（宝付，卡在商户号）**。

**下一个人该做的**：

- [ ] **不要重做 P0-3。** 先把上面六处证据过一遍。
- [ ] 把 roadmap 的 P0-3 条目状态订正（**本轮没有代勾** —— 见下面「为什么不勾」）。
- [ ] 真正的剩余工作是「Phase 4 真实支付」，不是「席位/license/看板」。

> **为什么本轮没有直接把它勾掉**：本轮已经抓到过一条反方向的假状态 ——
> `channels.md` 的 WeCom 标着 `[已实现]`，而后端连 `PluginType::WeCom` 都没有，
> 接口常年 `400`（已修 + 加断言 + PRD 改回 `[未实现]`）。
> 教训是**文档状态不能当验收依据**，两个方向都一样。
> 我核实到的是「路由挂了、页面在、license 闸在跑」，**不是**「端到端跑过一遍」。
> 所以这里只留证据和结论，把勾留给真正验过的人。

---

## 四、本轮全部未竟项（总登记）

> **跨三个仓库的唯一未竟项清单。** 09-18 那轮产出 5 份文档、09-19 又添 1 份，
> 每份末尾都有自己的「还没做 / 遗留」小节 —— 散着看必漏，这张表就是它们的并集。
>
> **✅ 2026-09-19 逐条对着代码复核过**（不是照着 session 文档的自述勾）。
> 销账证据见 §4.0，仍开的 6 条见 §4.1。
>
> 文档代号：
> **[harvest]** `session-2026-09-18-upstream-harvest-and-cross-session-archive-research.zh-CN.md`
> **[sweep-ui]** `session-2026-09-18-brand-sweep-and-what-it-uncovered.zh-CN.md`
> **[compact]** `session-2026-09-18-context-compaction-and-team-provider-block.zh-CN.md`
> **[sweep-core]** dream-core `session-2026-09-18-brand-sweep-and-the-compat-layers-it-broke.zh-CN.md`
> **[spend]** dream-core `session-2026-09-18-team-provider-spend-block.zh-CN.md`
> **[0919]** `session-2026-09-19-license-fingerprint-feishu-roundtrip-and-cdp.zh-CN.md`

### 4.0 已销账的 6 条 —— 每条附证据

| 原条目                                               | 销账证据（复核时亲自查到的）                                                                                                                                            |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SSO 真实 IdP 往返（档 3）                            | 飞书（扫码，真实 OAuth + 重复登录刷新）与 LDAP（`ldaps` 完整往返 + JIT 建号 + 负向）双路闭环 [0919] §二/§三                                                             |
| 企业形态复验（§5.4 五条）                            | 五条全部真机跑通，含伪造指纹 403、企业库凭据离线解密明文匹配 [0919] §一/§四                                                                                             |
| §5.3「没有任何东西锁住两边一致」                     | **文件确实存在**：`dream-en/admin-web/tests/deep-link-scheme-cross-repo.test.ts`，直接读兄弟 checkout 的 `routes.rs` 断言两侧有效等价                                   |
| 技能物化写进用户 git 仓库（原 C 表警告「没人跟进」） | **代码确实落地**：`dream-core-extension/src/skill_service.rs:1509` 起，链接前向上找 `.git`，仓库内则把技能目录追加进工作区级 `.gitignore`；只追加、幂等、非仓库不碰     |
| 队长信箱重复「已暂停」通知                           | **我登记错了，早已实现**：`dream-core-team/src/session.rs:2139` 的 `notify_leader_delivery_exhausted` 有 `already_pending` 检查 —— 同 slot 未读通知还在时跳过写入和唤醒 |
| `engine.rs` 截断工具调用发英文串                     | **我登记错了，早已走 code**：`dream-engine-agent/src/engine.rs` 现在是 `emit_info_coded("TRUNCATED_TOOL_CALL_RETRY", …, &fallback)`                                     |

### 4.1 ⚠️ 仍然开着的 6 条

> 09-19 那轮的 §7 写「只剩两条」（P0 大项 + 宝云 Phase 4）。**对它自己的范围是成立的** ——
> 它收的是「自己的 §7 + 本文 SSO/企业侧的行」。下面这 6 条不在那个范围里，
> **其中一条还在第三个仓库 dream-engine**。前 3 条是复核时**当场量出来的**。

| #   | 条目                                  | 位置                                                     | 怎么关                                                                                                                                                     | 验收                                                     |
| --- | ------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | **Explorer 只取了一半**               | dream-core `dream-core-file/src/dispatch.rs`             | 上游 #4202 的另一半「tab 级刷新」建在 `refreshRoot` 上，它调 `fs/remount` —— **实测全仓 0 命中，方法不存在**。要补齐得加「重新 arm watch + 重读 baseline」 | 新方法有负向测试；**改错能把整个文件监视弄坏**，别顺手做 |
| 2   | **`sendbox.css` 重复规则块**          | dream-ui `components/chat/SendBox/sendbox.css`（735 行） | 09-18 只删了造成当次问题的那一处。**实测仍有 2 处重复选择器**：`.sendbox-highlight-textarea`、`.sendbox-actions .sendbox-model-btn:focus-visible`          | 抽 `^\s*\.xxx {` 做 `uniq -c`，输出为空                  |
| 3   | **`DEFAULT_CHAR_BUDGET` 过期注释**    | **dream-engine** `dream-engine-skills/src/prompt.rs:15`  | 注释写「2% of 200k × 4」，但 `bootstrap.rs` 传的是 `None`，固定 16k 字符。**⚠️ 别照着注释把它改成 `80_000`**                                               | 注释与实际取值一致                                       |
| 4   | **安装器与发布脚本**（第 1/2/3/4 条） | dream-ui `resources/windows/**`、发布脚本                | 只能**真打一次包、真装一次**，读代码销不掉                                                                                                                 | 下次发版时顺带验，装完能起、卸载项正确                   |
| 5   | **`install-web.sh` 的 COS 镜像布局**  | dream-en `deploy/install.sh`                             | 没有实测过镜像路径布局                                                                                                                                     | 从 COS 真跑一次安装                                      |
| 6   | **mermaid / WaveDrom 缩放真机验**     | dream-ui                                                 | dev 库里**没有任何带图的会话**，无可验之物；现由 6 个测试文件 / 46 条覆盖，全过                                                                            | 先造一条含 mermaid + wavedrom 的会话，再 CDP 看缩放      |

**性质分布**：1-2 是半成品（代码没写完），3 是过期注释（会误导下一个人），
4-6 是验证欠账（代码写完了、没在真环境上跑过）。

> 📌 **给下一个人的提醒**：09-19 那句「只剩两条」之所以偏乐观，不是谁写错了，
> 是**一轮会话只会收自己视野里的那份清单**。本表跨 dream-ui / dream-core /
> dream-engine 三个仓库 —— **销账前对着代码量一遍**，别跟着 session 文档的自述勾。
> §4.0 每一行都附了证据，就是这个意思。

### 4.2 另有两条大项（单独立项，不在上面 6 条里）

- **SAML / SCIM 2.0 / OIDC JWKS 硬化 / 细粒度 RBAC** —— 见 §3，各有独立验收标准。
- **宝云支付 Phase 4（真实支付）** —— 用户明确暂缓。P0-3 的其余部分已实现，见 §3 末尾。

### C. 明确不做（有理由的决策，别当成遗漏重做）

| 上游改动                                                             | 为什么不做                                                                                                                                           | 出处         |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `feat(skills)!` 技能交付改造（89 文件 + 迁移 043）                   | 破坏性变更，与我们的 SkillsHub / 仓库下载+用户导入 架构正面冲突。**它的动机已被单独消化** —— 技能物化不再写进用户 git 仓库，见 §4.0                  | [harvest] §6 |
| `@@` 跨会话消息、sidebar 归档                                        | 转调研。结论是我们**根本没有**这两个功能（不是做得不好）；思路可抄、代码不能抄（要新建 crate + 迁移，而我们已到 056、上游才 040/041，schema 早分叉） | [harvest] §4 |
| `feat(auth)` 双 token + singleflight、account/secret CLI、解耦加密根 | 直接压在我们改造过的企业身份 / `one_user_org` / SSO 上，**风险最高**                                                                                 | [harvest] §6 |
| `feat(conversation)` agent 驱动建会话 API                            | 新 API 面，没有明确收益                                                                                                                              | [harvest] §6 |
| Explorer tab 级刷新                                                  | 见 §4.1 第 1 行                                                                                                                                      | [harvest] §6 |
| 队长自动下线不用的专家                                               | 用户明确说先不做                                                                                                                                     | [spend]      |
| 团队不活动看门狗                                                     | 上游也只有定义没接线（58 个 `dream-core-team/*.rs` 全扫过），跟着不做                                                                                | [spend]      |

### D. 产品决策待定（不是技术欠账）

| 条目                                        | 说明                                                                                                            | 出处         |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------ |
| `AgentType::display_name()` 返回 `1ONE CLI` | 迁移 019 也把库里展示名写成了它，用户在界面上天天看见。改成什么是产品决策 —— **用户 2026-09-18 已明确「不动」** | [sweep-core] |
| `resources/hub/` 构建期从第三方 hub 下载    | **用户已明确接受**                                                                                              | [sweep-core] |
| OfficeCLI 技能里的手动安装兜底链接          | 指向厂商域名 `https://officecli.ai`，它 301 跳到自己的 GitHub 仓库，跳转目标仍是第三方组织                      | [sweep-core] |

### F. 本轮顺带修掉的（不在原计划内）

- WeCom 假内置渠道条目 + `builtin_ids_all_parse_as_a_plugin_type` 断言防漂移 +
  PRD 状态由 `[已实现]` 订正为 `[未实现]`。
- `1One Work` → `One Work`（2026-09-19，上一代叫法，51 处 / 6 文件；哪些必须冻结见 §2 的 📌）。
- 技能文档里 `ps aux | grep 1One Work` 这条本来就坏的 shell（没加引号）。

---

## 五、企业版复验清单（本轮改动是否联动生效）

**为什么需要这一节**：本轮所有真机验证都跑在**个人版 dev** 上。而企业治理面在个人版里
**根本没被编译进去**（见 §1）—— 所以 SSO 那部分改动在真机上的覆盖率按构造就是 **0**，
不是"没顾上"，是"不可能覆盖到"。

### 5.1 本轮改动落在哪一侧

用 feature 列表（`dream-core-app/Cargo.toml` 的 `enterprise = [...]`）对本轮改过的文件做差集：

**企业专属（个人版验证完全不适用）—— 只有 2 个文件，全在 SSO：**

```
crates/dream-domain-sso/src/routes.rs    # sanitize_deep_link_scheme 还原 + 落地页 + 3 条新测试
crates/dream-domain-sso/src/service.rs   # 测试 fixture
```

**共享 crate（两个形态都编译，个人版验证对"代码"有效，对"企业数据集"无效）：**
密钥盐还原（`dream-core-app/src/config.rs`）、团队 MCP 旧名兼容、扩展前缀、
`serde(alias)` 旧值、迁移 057、WeCom 内置清单修正。

### 5.2 已经查清、**不需要**复验的

| 项                                      | 结论                                                                                                                                                                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 迁移 057 要不要 MySQL / Postgres 对应物 | **不要**。`migrations_mysql/` 与 `migrations_postgres/` 各只有一个 `001_users.sql`，是**全新安装的 schema、不是迁移历史**；文件头原话：企业部署没有遗留 SQLite 数据要规整，主会话 schema 按设计留在 SQLite（混合存储，P3-3） |
| dream-en 有没有本轮该清的品牌残留       | **没有**。全仓只剩两处 `aionui`，都是正当兼容层：`admin-web/index.html` 的 `__aionui_theme` 旧主题键回退、`Login.tsx` 的 scheme allowlist                                                                                    |
| 企业版能否编译（含本轮改动）            | ✅ **已验**（2026-09-19）：`cargo test -p dream-core-app --features enterprise --no-run` 0 error 0 warning，全部测试二进制链接成功                                                                                           |

### 5.3 ⚠️ 本轮才发现的跨仓约束：deep-link scheme 是**两边各写一份**的

`dream-en/admin-web/src/pages/Login.tsx` 有一个 `sanitizeDeepLinkScheme`，
注释里明写「mirrors the backend's `sso/routes.rs::sanitize_deep_link_scheme`
**exactly** — same four literals, same fallback」：

```ts
const DEEP_LINK_SCHEMES = ['dream', 'dream-dev', 'aionui-dev', 'aionui'] as const;
//                        兜底同样是 'aionui'
```

实测与还原后的后端**逐字一致**。但这意味着：

> **如果当初那次 sweep 把后端的 `aionui` 扫掉而没有还原，两边会静默漂移** ——
> 后端把未知值兜底成新 scheme、前端仍兜底成 `aionui`，dream-en 管理后台的
> 桌面登录深链就会断，而且两边各自的测试都还是绿的。
>
> **以后改这四个字面量中的任何一个，必须两个仓库一起改。**
> dream-en 侧有 `admin-web/tests/sanitize-deep-link-scheme.test.ts` 锁着，
> dream-core 侧有 `sanitize_deep_link_scheme_allows_only_the_known_schemes` 锁着 ——
> **但没有任何东西锁住"这两份要一致"。**

### 5.4 还要在企业形态上真跑一遍的

> **✅ 以下五条已于 2026-09-19 全部真跑通过**（企业形态真机，详见
> [`session-2026-09-19-license-fingerprint-feishu-roundtrip-and-cdp.zh-CN.md`](session-2026-09-19-license-fingerprint-feishu-roundtrip-and-cdp.zh-CN.md)）。
> 勾选留档，复查口径保留如下：

- [x] **SSO 深链往返**（唯一的企业专属改动，真机覆盖率为 0）。
      办法见 §2 档 2 / 档 3；档 3 要人填密钥。
      重点是**旧客户端那条路**：不传 `scheme` → 落地页 href 必须是 `aionui://`。
      **→ 已验**：飞书+LDAP 双路往返、旧客户端兜底、注入清洗全过。
- [x] **凭据解密**在企业数据集上。个人版上 5 个 provider 全部解密成功已验；
      企业部署有自己的 `data_secret` 和库，同一个 `derive_encryption_key`，
      结论应当相同，但**没在企业库上跑过**。
      **→ 已验**：企业库存取凭据 → 离线按同推导解密，明文精确匹配。
- [x] **迁移 057** 在企业 SQLite 库上落一次（账本出现 `version=57 success=1`，
      `icon/avatar_value LIKE '%aion%'` 为 0 行）。
      **→ 已验**（另有 billing_011 同库落账）。
- [x] **dream-en 管理后台**整体回归：本轮没动过 dream-en 一行代码，但它消费
      dream-core 的治理面路由，后端换了二进制就该过一遍。
      **→ 已验**：CDP 走登录/RBAC 拒成员/SSO 页/License 页；vitest 243/244
      （1 个 main 既有失败与本轮无关）。
- [x] **WeCom 修正**在企业形态下：内置渠道清单少了一条假的 `wecom`，
      确认 dream-en 侧没有任何地方硬编码期待 7 条。
      **→ 已验**：全仓无 7 条硬编码；`ImChannelsTab` 的 wecom 只是筛选项。

### 5.5 起企业实例的最短路径

```bash
cd dream-core
cargo build -p dream-core-app --features enterprise --bin dreamcore
# 或只要治理面：--bin dreamcore-admin
```

dream-en 那边有成套做法（`just build-enterprise`、`deploy/install.sh`、
`docs/audit-*.zh-CN.md` 里逐份都记了验证环境），**照它们来，不要另起一套**。

## 六、给下一个 AI 的五条硬提醒

1. **先问「这是哪个形态」。** 个人版与企业版是两个构建（`--features enterprise`），
   个人版上 `/api/one/**` 返回 404 是**正确行为**，不是故障。
2. **密钥要由人经手。** 真实 IdP 验证需要 App Secret / bind 密码。
   09-18 那轮我拒绝代填；09-19 那轮**用户明确授权**后才从 `feishu.txt` 取用。
   **默认是不碰，授权是一次性的、要用户当场说。**
   ⚠️ 早前泄漏进对话记录的飞书 App Secret / Agnes KEY / 豆包 KEY / license 签名
   SECRET **仍建议轮换**。
3. **文档状态两个方向都会错。** 一条 `[已实现]` 是假的（WeCom 后端从没实现），
   一条 `[ ]` 也是假的（P0-3 其实已建好）。
   标状态之前先找到对应实现文件；验收之前先找到对应**负向测试**。
4. **deep-link scheme 那四个字面量是跨仓的**，dream-core 和 dream-en 各写一份。
   ✅ 一致性锁已于 2026-09-19 补上
   （`dream-en/admin-web/tests/deep-link-scheme-cross-repo.test.ts`，非并排检出时自动 skip）。
   **改任一侧仍须两边同改** —— 锁只会在并排检出时才报警。
5. **销账要对着代码量，不要跟着自述勾。** 09-19 那轮报「只剩两条」，
   对它自己的范围成立；但本表跨 **dream-ui / dream-core / dream-engine 三个仓库**，
   复核后**仍有 6 条开着**（§4.1），其中一条就在 dream-engine —— 那轮根本没碰过那个仓库。
   一轮会话只会收自己视野里的那份清单，这不是谁的疏忽，是结构使然。
