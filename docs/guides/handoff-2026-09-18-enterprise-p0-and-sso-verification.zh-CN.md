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

## 一、开工前必读：企业路由是**编译期**开关，默认不编进去

这是本轮验证过程中最贵的一课，写在最前面。

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

> **所以**：任何「SSO 不工作」的报告，**第一步不是查配置，是查二进制编没编 `enterprise`**。
> 404 而不是 401/403 就是这个信号。
>
> 要带上：`cargo build -p dream-core-app --features enterprise`，
> 或者直接用独立的 `dreamcore-admin` 二进制（`src/bin/admin.rs`，它只挂治理面，
> 跟主服务用的是同一个 `build_governance_plane`，两边不会漂）。

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

> 本轮只把这一档跑到了「路由挂上 + provider 未配置时的正确拒绝」为止
> （见 §1 末尾的实测输出），**没有**建 license、没有写 provider 行 ——
> 那两步会落库，属于改环境，留给要真正做这一档的人。

### 档 3 — 真实 IdP 往返（**需要人工，我没做**）

只有这一档能证明「真的能登进去」。它需要把**真的** App Secret / LDAP bind 密码
填进管理后台表单。

> **我没有做这一档，也不会做**：代填密钥不是我该做的事。
> 需要的凭据在 `C:\Users\allenzhao\Desktop\feishu.txt`，请**由人**填。
>
> ⚠️ 顺带提醒：本轮会话里我的一个脱敏正则漏了全角冒号 `：`，把该文件里的
> **飞书 App Secret、Agnes KEY、豆包 KEY、license 签名 SECRET** 明文打进了对话记录。
> **建议全部轮换。**

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

## 四、本轮两份 session 文档里「仍未验证」的收口

| 原条目                                          | 现状                                                                                                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| SSO 登录回调（dream-core 文档）                 | **部分关闭**：深链 scheme 的完整链路（sanitize → state → callback → 落地页）已由 3 条新测试覆盖，并做过反证。真实 IdP 往返仍待人工，见 §2 档 3 |
| 安装器与发布脚本（dream-ui 文档 第 1/2/3/4 条） | **仍未验证**。必须真打一次包、真装一次。留到下次发版                                                                                           |
| `install-web.sh` 的 COS 镜像布局                | **仍未验证**。没有实测过                                                                                                                       |

本轮顺带修掉的（不是原计划内的）：

- （已在前序完成）WeCom 假内置渠道条目 + `builtin_ids_all_parse_as_a_plugin_type`
  断言防漂移 + PRD 状态由 `[已实现]` 订正为 `[未实现]`。

---

## 五、给下一个 AI 的三条硬提醒

1. **`enterprise` 是编译期 feature。** 见到 `/api/one/**` 返回 404，先怀疑二进制，别查配置。
2. **不要代填密钥。** 真实 IdP 验证需要 App Secret / bind 密码，那一步交给人。
3. **文档状态两个方向都会错。** 本轮一条 `[已实现]` 是假的（WeCom），一条 `[ ]` 也是假的（P0-3）。
   标状态之前先找到对应实现文件；验收之前先找到对应**负向测试**。
