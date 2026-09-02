# 2026-09-02：宝云计量代理（模式 B）—— dream-ui 侧（Phase 3）

> **新会话首读**：完整背景见 `dream-trial-broker/docs/baoyun-metered-proxy-handoff.zh-CN.md`。
> broker 侧 = Phase 1（`dream-trial-broker` master `073562d`）；dream-core 侧 = Phase 2
> （`dream-core` 分支 `fix/enterprise-bootstrap-and-admin-ui` 上 `694d75c`/`ffa44c2`，
> **未 push**）。本篇是 dream-ui 侧 Phase 3。模式 A（OpenRouter 一键体验）见同目录
> `session-2026-08-25-openrouter-trial-model.zh-CN.md`。

## 分支

`feat/baoyun-metered-phase3`（off `origin/main`），提交
`feat(providers): metered-proxy (mode B) trial vendor + top-up UI`。

> ⚠️ 干活时 dream-ui 这个 checkout 被别的会话在 `fix/rebrand-incomplete-renames` /
> `fix/media-seedream-gateway-and-seedance-audio` 之间来回切过。Phase 3 改动一度被
> stash、最后落在从 `origin/main` 新切的干净分支上。`modelPlatforms.ts` 里的 Baoyun
> 手动平台条目（handoff §8 提到的独立小改动）当时是别的会话的未提交状态，被 stash 成
> `media/rebrand session WIP`，**没进 Phase 3 分支**——需要单独处理。

## 一句话

模式 A 发一把限额上游 key；模式 B 开一个 broker 代理并本地按 CNY 分计费的账户，用完弹充值。
Phase 3 = 让前端能领模式 B、看余额、充值。

## 改了什么

| 文件 | 改动 |
| --- | --- |
| `common/types/provider/providerApi.ts` | 新增 `MeteredAccessResponse` / `MeteredQuotaStatusResponse` / `MeteredOrderResponse`（镜像 dream-core api-types） |
| `common/adapter/ipcBridge.ts` | `mode.meteredClaim` / `meteredQuota`（`?vendor=`）/ `meteredCreateOrder` / `meteredGetOrder` |
| `renderer/hooks/agent/useTrialModelClaim.ts` | 泛化：`TrialVendor = 'openrouter' \| 'baoyun'`、`TRIAL_PROVIDER_ID_BY_VENDOR`、`METERED_TRIAL_VENDORS`、`claimTrialModel(vendor, name)`。baoyun 走 `meteredClaim` → 建 `id: 'trial-baoyun'`、`platform: 'custom'`、`base_url` = broker 代理地址、`api_key` = `device_token` 的 provider。re-claim 时 token 轮换 → 409 就 `updateProvider` 覆盖旧行。`TRIAL_PROVIDER_ID` 常量保留（向后兼容） |
| `renderer/hooks/agent/useTrialQuota.ts`（新） | `useTrialQuota(vendor)` 统一 `trialKeyQuota` / `meteredQuota`；`remainingLabel` / `formatMinorUnits`（`12345` 分 CNY → `¥123.45`）；`useRefreshTrialQuota` |
| `renderer/pages/settings/components/TrialVendorOptions.tsx`（新） | 选供应商列表，两个 vendor 各一行（已领显示 ✓ + 禁用），点一行 claim。banner 弹窗和 AddPlatformModal 卡片共用 |
| `renderer/pages/guid/components/TrialModelBanner.tsx` | 角落卡片从"点击直接 claim"改成"点击开 `DreamModal` + `TrialVendorOptions`"。卡片本身的动效/CSS 不动 |
| `renderer/pages/guid/components/trialOfferVisibility.ts` | `isTrialOfferRedundant` 改用 `isTrialProviderClaimed(providers)`（任一 vendor）+ 免费模型判断 |
| `renderer/pages/settings/components/TrialModelCard.tsx` | 从单按钮改成标题 + `TrialVendorOptions` |
| `renderer/pages/settings/components/TrialQuotaBadge.tsx`（新） | 设置里 trial provider 行的余额 Tag（"剩余 ¥X.XX" / "已用完"）。metered 的可点开充值弹窗 |
| `renderer/pages/settings/components/MeteredTopUpModal.tsx`（新） | 套餐（`PACKAGE_IDS = ['59','99','199']`，手动跟 broker `PACKAGES` 对齐，定价细则未定见 handoff §7）→ `meteredCreateOrder` → 轮询 `meteredGetOrder`（3s，超时 5min）→ `paid` 时刷新余额 + done。MockGateway 只给 `pay_url`，页面展示 + 等待态 |
| `renderer/components/settings/SettingsModal/contents/ModelModalContent.tsx` | provider 卡片头部：`trialVendorOfProviderId(platform.id)` 命中就渲染 `<TrialQuotaBadge>` |
| `renderer/pages/conversation/Messages/components/MeteredTopUpCta.tsx`（新） | `MessageTips` 里 `errorCode === 'USER_LLM_PROVIDER_QUOTA_EXHAUSTED'` 时的"去充值"按钮。**只在本机有我们发的 metered-trial provider 时显示**（`AgentStreamErrorInfo` 不带 provider id，所以是启发式：有 metered trial 账户 + 撞了额度墙 = 该提示充值） |
| i18n × 13 | `settings.trialVendor.{openrouter,baoyun}.{title,desc,providerName}`、`settings.meteredQuota.{remaining,exhausted}`、`settings.meteredTopUp.*`（12 个）、`guid.trialModel.{pickerTitle,pickerDesc}`、`conversation.meteredTopUp.cta` |

## 验证情况

- ✅ `bunx tsc --noEmit` 干净
- ✅ `bun run i18n:types` + `node scripts/check-i18n.js` 通过（类型同步、13 语种齐）
- ✅ `bun run vitest run tests/unit/providers/`：139 passed（含更新的 `trialModelClaim.test.ts` 两 vendor 覆盖、新 `trialQuota.test.ts`）
- ✅ `bunx oxlint` / `oxfmt` 只对改动文件跑，干净（**别跑 `bun run format`/`lint:fix` 全量——会重格式化一堆无关文件，本轮踩过，已全部 revert**）
- ❌ **CDP 真机全链路未做**。要跑通 claim→消耗→402→充值弹窗→MockGateway 支付→余额刷新，需要：
  1. dream-core Phase 2（`fix/enterprise-bootstrap-and-admin-ui` 上那两个提交）build 出 dreamcore
  2. 本地起 `dream-trial-broker`，配 `BAOYUN_MASTER_API_KEY` + `BAOYUN_TRIAL_MODELS` + `MOCK_GATEWAY_SECRET`
  3. dream-core 配 `DREAM_TRIAL_BROKER_URL` 指向它
  4. dream-ui `bun run dev` / `webui`，CDP 逐一验证
  当前 bundled dreamcore 没有 `/api/providers/metered/*`，会 404 → 前端降级成"暂不可用"（这条降级路径是有意设计的）

## 未决 / 后续

- **CDP 真机全链路验证**（见上，需要先 build Phase 2 dreamcore）
- `modelPlatforms.ts` 的 Baoyun 手动平台条目没进本分支（当时是别的会话的未提交状态）
- 套餐定价细则（59/99/199 是否 1:1、是否赠送、有效期）未定 → `PACKAGE_IDS` 硬编码 + 注释
- `MeteredTopUpModal` 的 `package` i18n 文案写死 `¥{{price}}`（baoyun 是 CNY，够用；换币种要改）
