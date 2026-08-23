# P0-2 通用 SSO（第一步：OIDC）— 打通 Okta / Azure AD / Google Workspace

**日期**：2026-07-23
**状态**：三仓源码改完，one-sso 单测全绿（53，含 7 个新 OIDC）+ 前端 tsc/oxlint/check-i18n 全过；**真机 CDP + 打包待做**（与 P0-1 合并一次 aioncore 重编）。
**上下文**：企业/团队路线图 P0 第二项的第一步。交付方式=**逐个做透**（P0-2 → P0-4 → P0-3）。用户拍板 P0-2 本轮**先做 OIDC**（SAML/SCIM 紧跟其后）。

## Context（为什么）

现有 SSO 只支持国产 IdP（飞书/钉钉/企业微信/LDAP），进不了外企/出海市场——Okta、Azure AD（Entra）、Google Workspace 都原生说 **OIDC**。补一个标准 OIDC provider 即可一次打通这三大主流 IdP，是「通用 SAML/OIDC + SCIM」里性价比最高、架构风险最低的第一步。

现有 `one-sso` provider 抽象极干净（`providers/{feishu,dingtalk,wecom,ldap}.rs` + 统一四方法，config 是每 provider 一份 opaque JSON 存在 `one_sso_providers`），OIDC 原样套飞书模式，**无需迁移**。

## 后端改动（1oneCore / one-sso）

- **[models.rs](../../../1oneCore/crates/one-sso/src/models.rs)**：`SsoProviderKind` 加 `Oidc` 变体 + `as_str("oidc")` + `parse`。
- **[providers/oidc.rs](../../../1oneCore/crates/one-sso/src/providers/oidc.rs)（新）**：`OidcProviderConfig`（issuer/clientId/clientSecret/redirectUri/scopes/externalIdClaim/nameClaim/companyClaim/base_url 测试override）+ `OidcProvider`：
  - `discover` = GET `{issuer}/.well-known/openid-configuration` 拿 authorization/token/userinfo 端点（Okta/Azure/Google 全支持）；
  - `build_authorize_url`（授权码流）；`exchange_code`（POST token 端点，`application/x-www-form-urlencoded`）拿 access_token；`fetch_user_info`（GET userinfo 端点，Bearer）拿 claims；`resolve_external_id`（默认 `sub`）；`to_provider_user_info`（name/preferred_username/email 兜底显示名；`company_claim` 有配 → `org_external_id` 走同公司自动入伙，对齐飞书 tenant_key）；`test_credentials`（跑 discover 验证）。
  - **安全边界（v1）**：身份从 **userinfo 端点**读取（access_token 由 token 端点经 TLS+client_secret 换来，可信），v1 **不做 id_token 签名校验（JWKS）**——列为后续硬化项（doc comment 标注）。
- **[providers/mod.rs]**：导出 `oidc` / `OidcProvider`。
- **[service.rs]**：新 `parse_oidc_config`（issuer+clientId 必需，其余走 provider 默认）；`has_minimal_config` 加 `"oidc" => issuer && clientId`；`secret_keys` 加 `"oidc" => ["clientSecret"]`（redact/不回显机制现成）。
- **[routes.rs]**：authorize 分发 + callback `run_provider_oauth` 分发各加 `Oidc` 臂（`discover`→`build_authorize_url` / `discover`→`exchange_code`→`fetch_user_info`→`to_provider_user_info`，后续 `resolve_or_provision_user`+`issue_session`+企业自动入伙与飞书同链路，**callback 在 issue_session 之前**铁律沿用）。

## 前端改动（1oneUI）

- **SsoSettingsTab**（企业后台「企业认证」tab 复用）：`ProviderSpec.provider` 加 `'oidc'` + OIDC 卡片 field spec（Issuer/ClientId/ClientSecret[secret]/RedirectUri/Scopes/CompanyClaim）。redirectUri 的「填入建议地址」按钮 `suggestedRedirectUri('oidc')` 自动给出 `/api/one/sso/oidc/callback`。
- **登录页** `EnterpriseLoginChannelPanel`：加 OIDC channel（Key 图标）+ OAuth 重定向分支纳入 `oidc`；`OAuthProvider` 类型加 `'oidc'`。
- i18n：`login.methods.oidc`（en-US+zh-CN）；provider 卡片 label 沿用现有硬编码风格（与飞书/钉钉一致，无新 i18n key）。check-i18n 全绿。

## 个人单机版零影响（红线）

SSO provider 全是**管理员显式配置、默认关闭**；个人单机版从不配置任何 provider → 列表空 → 登录页不渲染 SSO 按钮、callback 无从触发。OIDC 是**纯加法**（新枚举值 + 新文件 + 新 match 臂 + 新 config 键），不碰既有 provider 逻辑、**无迁移**、无既有行为改动。one-sso 既有 46 单测保持绿。

## 验证状态

- `cargo test -p one-sso`：**53 全过**（46→+7 OIDC：`discover_parses_endpoints`/`build_authorize_url_contains_required_params`/`exchange_code_returns_access_token`/`exchange_code_surfaces_provider_error`/`fetch_user_info_maps_claims`/`to_provider_user_info_falls_back_to_email_then_prefix`/`test_credentials_ok_and_rejects_bad_issuer`，全用 wiremock mock discovery+token+userinfo，无需真 IdP）。
- clippy：新代码零告警（既有 dingtalk/wecom/rbac 告警 ratchet 不动）。`cargo check -p aionui-app` 通过。
- 前端：tsc 0 错、oxlint 0/0（改动文件）、check-i18n 全绿。
- **待做**：真机 CDP（起本地 mock-OIDC 配进设置页走 authorize→callback）+ 真 Okta/Azure/Google 用户点测 + 打包。

## 待办 / 后续（顺序执行）

1. P0-1（多成员）+ P0-2（OIDC）合并一次 aioncore 重编 → 真机 CDP 验证 → 分别提交。
2. **P0-2 后续**：SAML（XML 签名，重）+ SCIM 2.0 入站 provisioning（离职自动回收，合规红线）+ id_token 签名校验硬化。
3. **P0-4 细粒度 RBAC**：one-devops 看板（skills/mcp/rag）现对任何登录成员开放读写 → capability 模型 + 按资源 ACL；RAG 按文档/角色可见。
4. **P0-3 License 分级 + 席位 + 用量看板**（不接支付）。

## 关联

- 路线图 [enterprise-team-roadmap.zh-CN.md](enterprise-team-roadmap.zh-CN.md)（P0-2）
- 同日前置 [[session-2026-07-23-multi-membership-phase2.zh-CN.md]]（P0-1）
