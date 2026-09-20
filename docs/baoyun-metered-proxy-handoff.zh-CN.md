# 宝云（Baoyun）模式 B 计量代理 —— 设计与交接文档

> **⚠️ 2026-09-20 更新：宝云已迁移到模式 A，本文档记录的模式 B 从此不再是宝云的
> 实际接入方式，仅作历史/参考保留（见文末 §十）。** 用户带着本文档 §7"未决问题"
> 里的 4 个疑问去问了宝云，对方新开了「账户 API」（`/apis/v1/api-keys`），完整支持
> 程序化限额创建、原子充值（`remain_delta`）、用量查询、干净的耗尽错误码——正是
> §一 第 2 点当时没确认的那件事，现在确认支持了。三端已经把宝云切到模式 A
> （`dream-trial-broker/src/vendor/baoyun.rs`，跟 OpenRouter 同一套机制），下面
> §一~§九 描述的模式 B 三端实现**代码还在、能跑、单测覆盖，但默认不接任何 vendor**，
> 新会话看到"要不要继续 Phase 4（宝付真实支付）"，先读 §十，不要照着旧状态块继续冲。
>
> **状态：Phase 1（broker）+ Phase 2（dream-core）+ Phase 3（dream-ui）已实现
> （2026-09-02）；Phase 4（真实支付）未开始，Phase 3 的 CDP 真机全链路验证待做。**
> broker 侧：四张新表、`CostResolver`/`PaymentGateway` trait、claim/代理转发/quota/
> orders/webhook 六端点、宝云 `RemoteCostResolver`、`MockGateway`、异步计费轮询。
> dream-core 侧：`MeteredAccessService` + `/api/providers/metered/*` 四路由 + 结构化 402
> 错误映射。dream-ui 侧：vendor 泛化的 claim hook、选供应商弹窗、余额 badge、充值弹窗、
> `QUOTA_EXHAUSTED` 时的充值 CTA、13 语种 i18n。三侧都有单测/集成测试；差一个把三端
> （Phase 2 dreamcore + 本地 BAOYUN broker + dream-ui）串起来的 CDP 真机跑。
> 具体见文末"§九 实现进度"。
>
> 决策时间：2026-09-02。上游背景见 [`vendor-abstraction-and-paid-tier.zh-CN.md`](./vendor-abstraction-and-paid-tier.zh-CN.md)
> ——那份文档写于 08-28，"模式 B"当时只是"留接口不实现"，因为没有真实要接的厂商。
> 现在有了（宝云），且产品决策是**不管宝云是否支持模式 A，模式 B 的通用骨架都要建**，
> 给以后其他中转站/渠道复用。两套模式在 broker 里完全独立存在，互不依赖，互不阻塞。

## 一、背景与决策过程

用户诉求：接入宝云 AI token 中转站（`ai.baoyun.com`），实现类似 OpenRouter 那样的
"一键体验"，给每个 dream 用户免费 10 元额度，额度用完后弹出 59/99/199 三档付费套餐。

关键决策点（按时间顺序）：

1. **模式 A 还是模式 B？** 查了宝云公开开发者文档，账户模型是"预付费余额制"，API Key
   要登录控制台手动创建，**没有看到**合作方程序化开子账号/子 Key 并设个人额度的
   Provisioning API（这是 OpenRouter 模式 A 成立的前提）。
2. 但用户后来在控制台"创建 API Key"页面截图给我看，发现**创建 Key 时有"可用额度"
   开关**（"为这把 Key 单独设定还能使用的金额；花完后这把 Key 将无法继续调用"），还有
   "支持批量创建"角标。这说明宝云**后端很可能有**等价于 OpenRouter 那种限额子 Key 的
   能力，只是**能不能通过 API（而不是控制台点击）程序化调用，还没确认**——用户已经
   去问宝云，**这条至今未回复**。
3. 用户拍板：**不等宝云回复，直接按模式 B（计量代理）建**，理由是"以后其他渠道的接入
   也能用得着"——即把模式 B 当成一次性的基础设施投入，而不是宝云专属的临时方案。
4. 如果后续宝云确认支持程序化限额，可以另开一个模式 A 的 vendor 实现（复用现有
   `TokenVendor` trait），跟模式 B 并存——两套体系本来就没有耦合，谁先谁后不影响对方。

## 二、这次调研确认的宝云 API 事实（2026-09-02，浏览器实测 `ai.baoyun.com/docs`）

这些是这次交接里最"硬"的部分——不是推测，是翻文档原文截取的。

### 2.1 账户与认证

- 账户模型：**预付费余额制**（`账单与定价`页原文："我们采用预付费模式，你需要先充值
  到账户余额，然后使用余额消费"）。
- 认证：`Authorization: Bearer <API_KEY>`，Key 在控制台"登录后创建"。
- 充值方式：支付宝/微信支付/银行转账（企业客户），**都是账户持有人在控制台自己操作**，
  公开文档没看到服务端发起充值的开放 API。
- 发票：企业客户累计充值满 1000 元可申请，3-5 个工作日开具。
- **速率限制是账户等级的，不是按 Key 的**（`认证与安全`页表格）：

  | 账户等级 | 请求/分钟 | Tokens/天 |
  | --- | --- | --- |
  | 免费试用 | 20 | 100,000 |
  | 付费版 | 100 | 10,000,000 |
  | 企业版 | 自定义 | 自定义 |

  **这是个隐藏瓶颈**：如果 broker 用一个宝云账户的一把 master key 代理所有 dream 用户
  的流量，全体用户共用这一份速率限制。100 次/分钟对单个开发者够用，但对"所有 dream 桌面
  端体验用户共享"可能很快撞顶——需要采购更高等级账户，或问宝云是否有专属配额。

### 2.2 推理协议

- OpenAI Chat Completions 兼容：`POST https://ai-api.baoyun.com/v1/chat/completions`，
  以及 OpenAI Responses / Anthropic Messages / Gemini 三种协议变体，走 `model` 字段切换
  底层模型。
- **流式响应走标准 SSE**：`stream: true` 时返回 `chat.completion.chunk` 序列——跟 OpenAI
  官方协议一致，可以直接用现成的 SSE 转发方案，不需要为宝云特制解析逻辑。

### 2.3 计费——这是模式 B 能不能干净落地的关键

- 平台给**每一次 API 调用**生成唯一 **Request ID**，通过响应头 `X-AiHub-Request-Id`
  返回（跟 body 里上游自己的 `request_id` 字段是两回事，不要混用；跟异步任务的
  `task_id` 也是两回事）。
- **`GET /v1/billing/cost?request_id=<id>`**（只读，鉴权同 Bearer Key）——按 Request ID
  查询**这一次调用的净扣费金额**（`Consume − Refund`，已经是最终值）。响应示例：

  ```json
  {
    "success": true,
    "message": "",
    "data": {
      "request_id": "20260724104617163873000rW1btpIQ",
      "amount": "0.220008",
      "currency": "CNY",
      "model_name": "doubao-seedream-5-0-260128",
      "created_at": 1784890013,
      "task_id": "task_qJoTJDo4dVr7xpaetEITkPdct2utOGE1"
    }
  }
  ```

- **异步任务（图片/视频）在结算完成前查询会返回 `billing not settled` 或
  `cost not found`**，必须等任务终态后再查——用提交任务时的 Request ID，不是轮询请求的。

**这条事实是整个计量设计的地基**：我们**不需要**自己维护一份宝云的模型价格表来算费用
（那份表会跟着宝云调价漂移、极易出错）。只需要拿到每次代理请求的
`X-AiHub-Request-Id`，异步再调一次 `GET /v1/billing/cost` 拿官方净扣费金额去记账——
跟 OpenRouter 设计文档里"必须验证目标厂商能力"的态度一致：这条现在验证过了，是真的。

### 2.4 仍未确认的部分

- 控制台"创建 API Key"里的"可用额度"选项能否通过 API 程序化设置——**已问宝云，未回复**。
- 是否有合作方/渠道商专属的更高级 API 权限。

## 三、通用模式 B（MeteredProxy）架构设计

### 3.1 设计目标

- **vendor-agnostic**：核心转发/计量/账本/支付逻辑不认识"宝云"这个词，只认识配置里的
  一个 `MeteredVendorConfig`。接第二家 metered 厂商 = 加一份配置（+ 必要时一个
  `CostResolver` 实现），不碰核心转发/账本/支付代码。这是用户要求"以后其他渠道也用得上"
  的直接落地方式。
- 与现有模式 A（`TokenVendor::IssuedKey`，`src/vendor/openrouter.rs`）**完全独立**，
  不共用 trait，不共用数据表，两套体系在同一个 broker 进程里并存。

### 3.2 现状代码基线（供实现时对照，来自 2026-09-02 的代码调研）

| 位置 | 现状 |
| --- | --- |
| `src/vendor/mod.rs:148-172` | `TokenVendor` trait，`ProvisioningMode::{IssuedKey, MeteredProxy}`（`mod.rs:18-34`）已声明，`MeteredProxy` 分支从未实现 |
| `src/vendor/openrouter.rs` | 唯一 vendor 实现，350 行，含单测；其 HTTP client 结构（`reqwest::Client` + `bearer_auth` + 统一错误映射）可作为"管理面"客户端模板，但**转发/流式代理完全没有先例** |
| `src/service.rs:88-94` | `issue_trial_key` 对非 `IssuedKey` 的 vendor **直接拒绝**，说明当前 service 层是模式 A 专用的，模式 B 不应该塞进这个函数 |
| `migrations/0002_multi_vendor.sql` | `issuances` 表，`UNIQUE(vendor, install_id)`，记的是"签发的 key handle"，**不是消费账本**，模式 B 不能复用这张表 |
| `src/routes.rs` | 目前只有 3 条路由，全部是模式 A 形状（`POST /v1/trial-keys`、`POST /v1/quota/status` 等） |
| `src/main.rs:26-31` | 单 vendor 硬编码构造 `Arc<dyn TokenVendor>`，注释已经写明"多 vendor 时改成按配置查表" |
| 全仓库 grep `stream\|SSE` | **零命中**（除文档注释）——流式 HTTP 转发是这次要从零写的最大新增子系统 |

### 3.3 数据模型（新增表，与 `issuances` 完全独立）

```sql
-- 每个 (vendor, install_id) 一条账本：免费额度 + 已购额度 + 已消耗，用余额表达"还能用多少"
CREATE TABLE metered_accounts (
  vendor            TEXT    NOT NULL,
  install_id        TEXT    NOT NULL,
  device_token_hash TEXT    NOT NULL,           -- 明文 token 只在 claim 时返回一次，不落库
  free_grant_cents  INTEGER NOT NULL DEFAULT 0,  -- 一次性发放，不随消费恢复
  purchased_cents   INTEGER NOT NULL DEFAULT 0,  -- 历次成功订单累加
  consumed_cents    INTEGER NOT NULL DEFAULT 0,  -- 历次代理调用的净扣费累加
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  PRIMARY KEY (vendor, install_id)
);
-- remaining = free_grant_cents + purchased_cents - consumed_cents；<= 0 时硬阻断新请求

-- 追加式流水，账本之外单独留一份可审计的台账——涉及真实金钱，不能只有一个可变余额字段
CREATE TABLE metered_ledger_events (
  id           TEXT    PRIMARY KEY,
  vendor       TEXT    NOT NULL,
  install_id   TEXT    NOT NULL,
  kind         TEXT    NOT NULL,  -- 'free_grant' | 'purchase' | 'consume' | 'refund'
  amount_cents INTEGER NOT NULL,  -- consume/refund 为正数，语义由 kind 决定符号方向
  request_id   TEXT,              -- kind='consume' 时记宝云 X-AiHub-Request-Id，用于对账
  order_id     TEXT,              -- kind='purchase' 时关联 metered_orders.id
  created_at   INTEGER NOT NULL
);

-- 套餐订单
CREATE TABLE metered_orders (
  id              TEXT    PRIMARY KEY,
  vendor          TEXT    NOT NULL,
  install_id      TEXT    NOT NULL,
  package_id      TEXT    NOT NULL,   -- '59' | '99' | '199'
  amount_cents    INTEGER NOT NULL,   -- 用户实付
  credit_cents    INTEGER NOT NULL,   -- 到账额度（是否 1:1、是否有赠送，见"未决问题"）
  status          TEXT    NOT NULL,   -- 'pending' | 'paid' | 'failed' | 'expired'
  gateway         TEXT    NOT NULL,   -- 'alipay' | 'wechat' | 'mock'
  gateway_txn_id  TEXT,
  created_at      INTEGER NOT NULL,
  paid_at         INTEGER
);

-- 异步任务（图片/视频）的费用查询要等终态，需要一张"待结算"队列，避免代理层同步阻塞等待
CREATE TABLE metered_pending_costs (
  request_id  TEXT    PRIMARY KEY,   -- 宝云 X-AiHub-Request-Id
  vendor      TEXT    NOT NULL,
  install_id  TEXT    NOT NULL,
  task_id     TEXT,                  -- 异步任务的 task_id，轮询终态用
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
```

### 3.4 核心 trait 草案

```rust
/// 一个可以被计量代理转发的上游端点。不涉及"发 key"，只涉及"转发 + 事后算账"。
pub struct MeteredVendorConfig {
    pub id: &'static str,               // "baoyun"
    pub base_url: String,               // "https://ai-api.baoyun.com"
    pub master_api_key: String,         // broker 自己持有的唯一一把宝云 key
    pub free_grant_cents: i64,          // 10_00 = 10.00 CNY
    pub packages: Vec<Package>,         // 59 / 99 / 199
}

pub struct Package { pub id: &'static str, pub price_cents: i64, pub credit_cents: i64 }

/// 从一次代理调用里拿到"这次到底花了多少钱"。宝云用 RemoteCostResolver；
/// 没有等价查询接口的厂商，退化到 LocalPriceTable（吃 usage 字段 + 本地价格表，会随涨价漂移）。
#[async_trait]
pub trait CostResolver: Send + Sync {
    async fn resolve(&self, ctx: &ProxiedCallContext) -> Result<CostOutcome, VendorError>;
}
pub enum CostOutcome { Settled(i64), Pending /* 异步任务未结算，进 metered_pending_costs 队列重试 */ }

/// 支付网关，59/99/199 到账走这个接口。Mock 用于商户号申请下来之前打通全链路。
#[async_trait]
pub trait PaymentGateway: Send + Sync {
    async fn precreate(&self, order: &Order) -> Result<PaymentIntent, GatewayError>; // 返回二维码/跳转链接
    async fn verify_webhook(&self, headers: &HeaderMap, body: &[u8]) -> Result<WebhookEvent, GatewayError>;
}
```

### 3.5 请求生命周期

1. **Claim**（一次性）：`POST /v1/metered/claim {vendor, install_id}` → 按 `(vendor,
   install_id)` upsert `metered_accounts`（首次发 `free_grant_cents`，重复 claim 幂等、
   不重复发放）→ 生成 device_token（明文只返回这一次，落库存 hash，跟现有"只存 hash"
   的安全惯例一致）→ 返回 `{base_url: "<broker>/v1/metered/baoyun", device_token, models}`。
2. **代理调用**：`ANY /v1/metered/{vendor}/*path`，客户端拿 device_token 当 Bearer。
   broker：校验 token → 查余额，**≤ 0 直接硬阻断**（复用已定的"额度耗尽=硬阻断"产品
   决策）→ 用 master key 替换 Authorization，转发到 `{base_url}{path}` → 流式转发响应
   （`axum::body::Body::from_stream`，本仓库从零写）→ 转发完成后读 `X-AiHub-Request-Id`。
3. **计费**：同步端点（chat completions）转发完直接调 `GET /v1/billing/cost`；如果
   `billing not settled`，退避重试几次；异步端点（图片/视频）直接写入
   `metered_pending_costs`，由一个后台轮询任务在探测到 `task_id` 终态后再查费用——
   拿到金额后写 `metered_ledger_events(kind='consume')` 并原子扣减 `metered_accounts`。
4. **额度状态**：`POST /v1/metered/quota/status {vendor, install_id}` 直接读本地账本，
   不用像模式 A 那样问 vendor——返回结构可以跟现有 `QuotaStatusResponse` 保持字段兼容，
   让 dream-core/dream-ui 少判断一次"这是哪种模式"。
5. **购买**：`POST /v1/metered/orders {vendor, install_id, package_id}` → 建 pending 订单
   → `PaymentGateway::precreate` → 返回二维码；`GET /v1/metered/orders/{id}` 供轮询；
   `POST /v1/metered/orders/webhook/{gateway}` 验签后标记 paid + 记
   `metered_ledger_events(kind='purchase')` + 原子加余额。

### 3.6 关键技术风险与对策

- **并发扣费竞态**：同一 `(vendor, install_id)` 可能有并发请求同时扣费，SQLite 没有行锁，
  必须用 `BEGIN IMMEDIATE` 事务把"读余额→判断→写余额"串行化，防止双花式透支。
- **硬阻断只能挡"下一次"请求，挡不住当次透支**：费用是转发完之后才知道的，理论上
  余额还剩 0.01 元时仍能发起一次请求，等结算完才发现扣多了、变成负数。这是计量代理的
  通用限界（多数按量计费系统都这样，包括宝云自己对终端用户），先接受"有界透支"，
  不做预扣/预估拦截；如果透支金额在实测中明显失控（比如视频类大额调用），再加一层
  "按 `max_tokens`/固定单价上限做事前粗略估算拦截"。
- **异步任务费用查询要等终态**：不能在代理转发返回时同步等图片/视频任务跑完再查费用，
  必须走 `metered_pending_costs` 队列 + 后台轮询，避免把用户请求拖住。
- **宝云账户速率限制是全体 dream 用户共享的**（§2.1 表格）：这是产品/成本决策，不是纯
  技术问题——需要跟"免费额度用户预期规模"一起估算,可能需要在上线前找宝云要更高等级
  账户或专属配额。
- **薅羊毛/免费额度重复领取**：`install_id` 是本地生成的，重装 App/清空数据即可拿到新
  install_id 反复领 10 元——这个弱点在模式 A（OpenRouter）的设计里也存在，但那边"发一把
  $1/月的 key"和这里"直接发 10 元真金白银的可用余额"，被刷的下限成本不一样。现有
  `src/rate_limit.rs`（按 IP）是唯一现成防线，是否需要加更强的设备指纹或人工审核阈值，
  是产品需要拍板的问题（见下节）。

### 3.7 broker 新增 API 面（汇总）

| Method & Path | 用途 |
| --- | --- |
| `POST /v1/metered/claim` | 首次领取（发免费额度 + device_token） |
| `ANY /v1/metered/{vendor}/*path` | 推理流量转发（含流式） |
| `POST /v1/metered/quota/status` | 查本地账本余额 |
| `POST /v1/metered/orders` | 创建套餐订单，拿支付二维码 |
| `GET /v1/metered/orders/{id}` | 轮询订单状态 |
| `POST /v1/metered/orders/webhook/{gateway}` | 支付网关回调 |

## 四、dream-core 改动面

- **新响应类型**：`TrialKeyResponse`（`crates/dream-core-api-types/src/provider.rs:352-373`）
  是模式 A 专用形状（"这里有一把 key 给你"），**不能复用**——模式 B 没有可以直接下发的
  vendor key。新增一个 `MeteredAccessResponse { base_url, device_token, models }`，
  `base_url` 指向 broker 自己的代理地址而不是宝云。
- **新 service**：仿照 `crates/dream-core-system/src/trial_key.rs`（`TrialKeyService`，
  `broker_base_url` + `reqwest::Client` + `client_pref_repo`，install_id 复用同一套
  `client_preferences` 持久化机制）新增一个平行模块，调 broker 的 `/v1/metered/*`。
  两者共享 install_id 的读取逻辑，但不合并成一个 service——避免为了"复用"把两种本质不同
  的流程（发 key vs 代理凭证）耦合在一起。
- **Provider 落地**：`CreateProviderRequest` 本身是通用行（`platform/base_url/api_key/
  models`），确认可以直接拿 `MeteredAccessResponse` 建一个 `platform: 'custom'` 的
  provider，`base_url`=broker 代理地址，`api_key`=device_token——**不需要在 dream-core
  后端新增"宝云"这个平台的编译期概念**。
- **错误分类**：现状"两条独立分类路径"仍然成立——`protocol/send_error.rs` 的
  `looks_like_spent_allowance`（line 703-715）和 `manager/dream_engine/error.rs` 的
  `aionrs_provider_status_to_send_error`（line 146）。**但模式 B 有机会比模式 A 更干净**：
  broker 自己就是"额度耗尽"这件事的权威来源（不像 OpenRouter 是转述上游的 403），可以让
  broker 直接返回一个结构化状态（比如 `402 + {code:"QUOTA_EXHAUSTED"}`），dream-core 按
  状态码 + broker 自定义 code 直接映射到 `UserLlmProviderQuotaExhausted`，**不依赖文本
  嗅探**。仍建议同时把对应措辞喂给 `looks_like_spent_allowance`，保留"一个判定函数、
  两条路径共享"的既有纪律，防止未来分叉。

## 五、dream-ui 改动面

- **`useTrialModelClaim.ts`**（`TRIAL_PROVIDER_ID` 硬编码 `'trial-openrouter'`，claim 逻辑
  也是 OpenRouter 专属字符串）需要泛化成按 vendor 参数化，才能加一个 `'trial-baoyun'`
  而不是复制一份几乎一样的 hook。
- **推广位**：`TrialModelBanner.tsx` / `TrialModelCard.tsx` 目前写死 OpenRouter；
  `trialOfferVisibility.ts` 的 `isTrialOfferRedundant`（判断"是否已经有这个免费模型了"）
  硬编码 `BUILT_IN_FREE_MODEL='openrouter/free'`。两个促销位同时出现在首页右下角会显得
  乱——建议同一时刻只展示一个（按优先级选一个 vendor 展示），需要产品拍板优先级顺序。
- **额度显示是"接好线但没人用"的死代码**：`ipcBridge.ts:1271` 的 `trialKeyQuota` 目前
  **在整个 renderer 里没有任何调用方**。这次要把它（或一个泛化后的版本）真正接到 UI 上，
  显示"剩余 ¥X.XX"。
- **购买弹窗要从零做**：`MessageTips.tsx:109-165` 现在只把 `resolution` 渲染成静态提示
  文案，**没有任何"点击去充值"的 CTA 逻辑**。需要新增一个套餐选择 + 二维码 + 轮询组件，
  并在检测到 `structuredError.code === 'USER_LLM_PROVIDER_QUOTA_EXHAUSTED'`
  **且 provider 是我们自己发的 metered-trial provider**（不是用户自己手动配置的宝云
  key）时弹出——需要一个字段能区分"这是我们发的 trial provider"还是"用户自己填的"，
  可以借用 `TrialKeyResponse` 里已经有的 `vendor` 字段模式。
- 所有新增文案走 i18n 流程（13 语种），复用现有 `USER_LLM_PROVIDER_QUOTA_EXHAUSTED`
  的多语种模式。

## 六、分阶段实施计划（建议顺序，供后续排期用）

1. **Phase 1 — broker 通用骨架**：✅ **已完成（2026-09-02）**。四张新表
   （`migrations/0003`）+ `CostResolver`/`PaymentGateway` trait + claim/代理转发/quota/
   orders/order-status/webhook 六个端点 + 宝云的 `RemoteCostResolver`（调
   `GET /v1/billing/cost`）+ `MockGateway` + 异步费用后台轮询（`src/metered/poller.rs`）。
   产出：一个能跑通、但收不了真钱的完整闭环。集成测试 `tests/metered.rs` 覆盖
   claim 幂等、零余额硬阻断、master key 替换、按 resolver 计费、订单充值幂等、轮询结算。
2. **Phase 2 — dream-core 打通**：✅ **已完成（2026-09-02）**。`MeteredAccessService` +
   `MeteredAccessResponse`/`MeteredQuotaStatusResponse`/`MeteredOrderResponse` +
   `/api/providers/metered/{claim,quota,orders,orders/{id}}` 四路由 + 结构化 402 →
   `UserLlmProviderQuotaExhausted` 的两条路径错误映射 + `wiremock` 集成测试。
   provider 创建仍是前端的活（Phase 3）。
3. **Phase 3 — dream-ui**：✅ **代码完成（2026-09-02）**，分支 `feat/baoyun-metered-phase3`。
   vendor 泛化的 `useTrialModelClaim`、`TrialVendorOptions` 选供应商弹窗（合并原来的两个
   promo 位）、`useTrialQuota` + `TrialQuotaBadge` 余额显示、`MeteredTopUpModal` 充值弹窗
   （套餐→下单→轮询→刷新）、`MeteredTopUpCta`（`QUOTA_EXHAUSTED` 时）、13 语种 i18n。
   tsc/check-i18n/vitest(139) 全绿。**差 CDP 真机全链路**（要先 build Phase 2 dreamcore +
   本地起 BAOYUN broker），细节见 dream-ui `docs/guides/session-2026-09-02-baoyun-metered-phase3.zh-CN.md`。
4. **Phase 4 — 真实收款（外部依赖阻塞）**：支付宝/微信支付商户号下来之后，实现真实
   `AlipayGateway`/`WechatGateway`，做一次安全审查（走 `security-review` skill——重点是
   webhook 验签、幂等、密钥管理），真机（CDP）验证整条购买链路，再上线。

## 七、未决问题清单（需要人拍板或外部确认，不阻塞 Phase 1-3 的架构落地）

1. **问宝云的 5 个技术问题**（额度能否程序化设置/追加、能否程序化查询余额、耗尽时
   返回什么错误、管理接口要不要额外的合作方权限）——**至今未回复**。
2. **支付宝/微信支付商户号**——申请中，Phase 4 的硬前提。
3. **套餐定价细则**：59/99/199 元是否 1:1 兑换成余额，还是有赠送比例（比如充 100 送 10）？
   是否设置有效期？
4. **免费 10 元的防刷策略**：只按 install_id 去重是否够用，需不需要加更强的设备指纹或
   限速阈值？
5. **宝云账户等级采购**：broker 用哪个等级的宝云账户（付费版 100 次/分钟够不够全体
   体验用户共用）？

## 八、本次已完成的改动（决策 Mode B 之前做的独立小改动）

- [`dream-ui/packages/desktop/src/renderer/utils/model/modelPlatforms.ts`](../../dream-ui/packages/desktop/src/renderer/utils/model/modelPlatforms.ts)：
  新增 `Baoyun` 作为手动可配置的 custom 平台条目（`base_url: https://ai-api.baoyun.com/v1`，
  暂无专属 logo，走默认图标）。这个入口跟本文档的"一键体验+免费额度"架构完全独立，
  服务的是"已经自己在宝云控制台开了 key 的用户"，随时可用，不受本文档进度影响。

## 九、实现进度（2026-09-02，Phase 1 落地记录）

### 9.1 已落地的文件

| 文件 | 内容 |
| --- | --- |
| `migrations/0003_metered_proxy.sql` | `metered_accounts` / `metered_ledger_events` / `metered_orders` / `metered_pending_costs` 四张表 + consume/purchase 幂等的 partial unique index |
| `src/metered/mod.rs` | `MeteredVendorConfig` / `Package` / `CostResolver` / `PaymentGateway` / `MeteredRuntime` + `now_ms`/`sha256_hex`/`new_device_token` |
| `src/metered/store.rs` | 账本读写（claim upsert、`apply_consume` 幂等、订单、pending 队列），RMW 全走事务 |
| `src/metered/baoyun.rs` | `BAOYUN` 常量、`config_from_env`、`RemoteCostResolver`（`GET /v1/billing/cost`） |
| `src/metered/gateway.rs` | `MockGateway`（带 shared secret 校验） |
| `src/metered/proxy.rs` | `ANY /v1/metered/proxy/{vendor}/*path` 流式转发 + 事后计费 |
| `src/metered/poller.rs` | 异步费用后台轮询（`poll_once` 已导出供测试） |
| `src/metered/service.rs` | claim / quota / orders / webhook 的 HTTP-independent 流程 + axum handler |
| `tests/metered.rs` | 7 个集成测试，真 router + stand-in 上游 + scripted resolver |

### 9.2 与原设计的偏差（实现时的决定，都写进代码注释了）

1. **代理路由带 `/proxy/` 段**：`/v1/metered/proxy/{vendor}/*path` 而不是设计里的
   `/v1/metered/{vendor}/*path`。原因：axum(matchit 0.7) 的 catch-all 会和
   `/v1/metered/orders/{id}` 等固定路由冲突。claim 返回的 `base_url` 相应变成
   `{PUBLIC_BASE_URL}/v1/metered/proxy/{vendor}`。
2. **新增 `PUBLIC_BASE_URL` 配置**：claim 要返回 broker 自己的绝对地址，默认
   `http://<LISTEN_ADDR>`（只够本地用），生产要设成 nginx 外部地址（带路径前缀）。
3. **claim 每次轮换 device_token**：设计说"重复 claim 幂等不重复发放"——免费额度确实
   只发一次（`free_grant` 账本事件 + `free_grant_cents` 只在首次写），但 device_token
   每次 claim 都换新、旧 token 立即失效。重装/重领对同一 install_id 不会多拿钱，返回的
   还是能用的 token。
4. **`metered_pending_costs` 多了 `next_attempt_at` 列**：轮询要按退避时间调度，设计表
   里没这列。退避 30s 起、翻倍、封顶 10 分钟；`MAX_ATTEMPTS=20` 后放弃并 error 日志
   （接受"有界漏账"，同 §3.6）。
5. **金额取整到分**：宝云 `amount` 是 CNY 小数字符串（`"0.220008"`），`RemoteCostResolver`
   四舍五入到整分，单次最多丢 0.5 分。账本是整数分，这是固有取舍。
6. **`BAOYUN_TRIAL_MODELS` 占位**：没验证过宝云的 chat 模型 slug，未设该环境变量时发
   一个占位 `deepseek-chat` 并打 warn 日志。**推广前必须核对真实 catalog 再定这个列表和
   顺序**（宝云是预付费，没有 OpenRouter 那种 $0 免费池可以放第一）。
7. **结构化 402**：余额耗尽时 proxy 直接返回
   `402 {"error":"quota_exhausted","code":"QUOTA_EXHAUSTED","vendor":...,"currency":...,"remaining_cents":...}`。
   这正是 §4 说的"broker 是权威来源、dream-core 按 code 映射、不做文本嗅探"的落地点——
   Phase 2 直接认 `code == "QUOTA_EXHAUSTED"`。
8. **并发扣费**：设计要求 `BEGIN IMMEDIATE`。现在 `db::init_pool` 是单连接池
   （`max_connections(1)`，原本就是刻意的），事务期间独占唯一连接，RMW 天然串行，等价
   保证。注释里写明：连接数一旦放开就要改成显式 `BEGIN IMMEDIATE`。
9. **当次透支仍可能发生**：硬阻断只挡"下一次"（费用是转发后才知道的），同 §3.6，先接受。

### 9.3 Phase 2（dream-core 侧）已实现（2026-09-02）

在 dream-core `fix/enterprise-bootstrap-and-admin-ui` 分支上，两个提交：
`feat(system): relay metered-proxy (mode B) trial access to the broker` +
`fix(errors): map the broker's structured QUOTA_EXHAUSTED to spent-allowance`。
细节文档：dream-core `docs/guides/session-2026-09-02-baoyun-metered-phase2.zh-CN.md`。

- **新 service** `crates/dream-core-system/src/metered_access.rs` `MeteredAccessService`
  （不合并进 `TrialKeyService`，只共享抽出来的 `crate::install_id`）。方法 `claim` /
  `read_quota_status` / `create_order` / `get_order` 转发 broker `/v1/metered/*`。
- **新 api-type** `MeteredAccessResponse` / `MeteredQuotaStatusResponse` /
  `MeteredOrderResponse`（`dream-core-api-types/src/provider.rs`）——字段与 broker 的
  `ClaimResponse` / `QuotaResponse` / `OrderResponse` 对齐。
- **新路由**（dream-core 对前端的面）：`POST /api/providers/metered/claim {vendor}`、
  `GET /api/providers/metered/quota?vendor=`、`POST /api/providers/metered/orders
  {vendor, package_id}`、`GET /api/providers/metered/orders/{id}`。
- **错误分类**：broker 结构化 402 的 `code`/`error` `quota_exhausted` 已加进
  dream-core 的 `looks_like_spent_allowance`，两条分类路径（`protocol::send_error` 文本、
  `manager::dream_engine::error` 状态码）都映射到 `UserLlmProviderQuotaExhausted`；
  文本路径里 spent-allowance 检查移到了 402/billing 块之前。
- 读同一个 `DREAM_TRIAL_BROKER_URL`（broker 一个服务两种模式）；未配置时报"未配置"。

### 9.4 Phase 3（dream-ui）接手要点

- Phase 4 之前 `gateway` 恒为 `MockGateway`，webhook 路由是
  `POST /v1/metered/orders/webhook/mock`，body 要带 `{order_id, paid, secret}`，secret
  来自 `MOCK_GATEWAY_SECRET`（默认 `mock-secret`）。真实网关按同一 `PaymentGateway`
  trait 加，不动订单表和账本。
- 购买弹窗在 `structuredError.code === 'USER_LLM_PROVIDER_QUOTA_EXHAUSTED'` **且 provider
  是我们发的 metered-trial provider** 时弹出（见 §5）。
- claim 返回的 `base_url` 是 broker 自己的代理地址
  `{PUBLIC_BASE_URL}/v1/metered/proxy/{vendor}`，`api_key` = `device_token`，platform
  建成 `custom`。

### 9.5 Phase 3 CDP 真机全链路验证（2026-09-03，已过）

无真实宝云 key，用本地 mock 上游跑通了全链路：mock 上游（返 `X-AiHub-Request-Id` +
`/v1/billing/cost`）+ broker（`BAOYUN_BASE_URL` 指 mock、`MockGateway`）+ 现 build 的
Phase 2 dreamcore + `DREAM_TRIAL_BROKER_URL=... bun run dev`。CDP 逐一验证并截图：
领宝云 → `platform:custom` provider 指向 broker 代理；设置里「剩余 ¥X.XX」badge；选供应商
弹窗两 vendor + i18n；**真发一条 mock-model 消息 → broker 402 → dream-core 映射 →
「体验额度已用完」错误卡 + 「去充值」CTA + 错误码 `USER_LLM_PROVIDER_QUOTA_EXHAUSTED`**；
CTA → 充值弹窗 → 套餐 → 下单 → mock webhook → 轮询到 paid → badge 刷新。全过。

---

## 十、Phase 4 交接：接真实收款（宝付）——⚠️ 已被 §十一 取代，仅作历史记录

> **状态：本节写于 2026-09-20 当天更早些时候，几小时后宝云上线账户 API、三端切到
> 模式 A，这一整节的前提（"宝云只能走模式 B，收款要靠宝付网关"）不再成立。** 免费
> 试用额度现在完全不需要宝付/收款网关——直接见 §十一。真要给终端用户做付费充值，
> 也不再是"接宝付网关+本地订单表"这套，而是"收到钱之后调用
> `TokenVendor::top_up`"，见 §十一.3。本节原文保留在下面，只是别再照着执行。

### 10.1 前因后果（新会话先读这段）

- 产品要「宝云一键体验」：每个 dream 用户免费 ¥10 额度，用完弹 59/99/199 三档充值套餐。
- 宝云（`ai.baoyun.com`）是预付费余额制、没有 OpenRouter 那种程序化发限额子 key 的能力，
  所以走**模式 B 计量代理**：broker 用一把 master key 代理所有推理流量、按宝云
  `GET /v1/billing/cost` 的官方净扣费记本地账本、额度耗尽硬阻断。详见 §一~§三。
- Phase 1（broker 骨架）/ Phase 2（dream-core 接线）/ Phase 3（dream-ui 弹窗+余额+CTA）
  全部完成，见 §九。整条链路 CDP 真机验证过（§9.5）——**唯一用的是 `MockGateway`**，
  订单→模拟 webhook→加余额跑通，但收不了真钱。
- **收款渠道定的是宝付（上海宝付网络科技 `baofoo.com`，聚合支付），不是直连支付宝/微信。**
  卡在两件外部事：①宝付商户号还在申请中；②给对接方/宝付的几个问题还没回复
  （具体问题清单在用户手上，新会话直接问用户要「宝付对接待回复问题」那个 thread）。

### 10.2 架构已经就位，Phase 4 只碰「网关」这一层

`PaymentGateway` trait（`src/metered/mod.rs`）是唯一要新实现的东西。它下游的所有东西
**已经完成且网关无关**，不要动：

- `metered_orders` / `metered_ledger_events` 表、`store::mark_order_paid_and_credit`
  （**按 `order_id` 幂等**，webhook 重投多次只加一次余额）
- 后台异步费用轮询 `poller.rs`（跟支付无关，是宝云计费的）
- dream-core 的 `/api/providers/metered/orders` + `/orders/{id}` 中继
- dream-ui 的 `MeteredTopUpModal`（下单→轮询订单状态→到账刷新）

trait 三个方法：
```rust
fn id(&self) -> &'static str;                          // 返回 "baofu"
async fn precreate(&self, order: OrderView<'_>)        // 向宝付下单，返回给客户端的付款信息
    -> Result<PaymentIntent, MeteredError>;            //   PaymentIntent { gateway_txn_id, payload: Value }
async fn verify_webhook(&self, headers, body)          // 宝付异步通知：验签 → 取 order_id + 是否已付
    -> Result<WebhookOutcome, MeteredError>;           //   WebhookOutcome { order_id, paid, gateway_txn_id }
```

### 10.3 具体要做的（商户号下来后）

**broker（`dream-trial-broker`）**

1. `src/metered/gateway/baofu.rs`（或直接扩 `gateway.rs`），`BaofuGateway` 实现 `PaymentGateway`：
   - `id()` → `"baofu"`
   - `precreate`：调宝付「下单/收银台」API。宝付一般是 form-post + RSA 签名。产品形态
     （H5 收银台跳转 URL / 扫码 QR / 快捷）取决于批下来的商户号类型 —— **先问清楚宝付给的是
     哪个产品**，`payload` 的 shape 跟着定（`{pay_url}` 还是 `{qr_content}`）。
     金额：`order.amount_cents` 是**分**，宝付接口多半要元的小数字符串或分的整数，按其文档换算。
   - `verify_webhook`：验宝付异步通知的签名（RSA/MD5，用宝付下发的公钥），取商户订单号
     （= 我们的 `metered_orders.id`）和交易状态，返回 `WebhookOutcome`。**验签失败一律返回
     `MeteredError::WebhookRejected`。**
2. `src/config.rs` 加：`BAOFU_MERCHANT_ID` / `BAOFU_PRIVATE_KEY`（我方私钥，签名用）/
   `BAOFU_PUBLIC_KEY`（宝付公钥，验签用）/ `BAOFU_API_BASE` /（可选）`BAOFU_NOTIFY_URL`
   默认 `{PUBLIC_BASE_URL}/v1/metered/orders/webhook/baofu`。私钥**绝不进日志**。
3. `src/main.rs` `build_metered_runtime`：按 env 选网关 —— `BAOFU_MERCHANT_ID` 存在就用
   `BaofuGateway`，否则 `MockGateway`。（`MeteredRuntime.gateway` 现在是**单个** `Arc<dyn>`，
   不是 map；一次只有一个网关。要同时跑 mock+真实再改成 map，非必须。）
4. **webhook 响应格式的坑**：`service::handle_webhook` 现在返回 `Json({"ok":true,...})`。
   宝付/支付宝这类要求异步通知**回一个特定纯文本**（通常是 `SUCCESS`/`OK`），否则会一直重投。
   要改 `webhook_handler` 的返回：验签成功且入账后回宝付要求的 ack 字符串（`text/plain`），
   失败回它要求的失败标记。这是 Phase 4 必须动的一处已有代码。
5. 订单超时：`metered_orders.status` 有 `expired` 但没人置。可加一个后台 sweep 把超 N 分钟
   的 `pending` 订单标 `expired`，或下单后轮询宝付订单状态。优先级低。
6. `src/metered/baoyun.rs` 的 `PACKAGES` 常量：现在 `credit_cents == price_cents`（1:1）。
   §七 未决 —— 是否充 100 送 10、是否设有效期，产品拍板后改这里（字段都支持非 1:1）。
7. 测试：仿 `gateway.rs` 里 `MockGateway` 的两个单测，给 `BaofuGateway` 加：mock 掉 HTTP、
   用一份已知签名的 fixture 测 `verify_webhook` 验签通过 / 篡改后拒绝。
8. **跑 `security-review` skill**：重点 webhook 验签、幂等（已有）、密钥管理、重放防护、
   金额/币种一致性、错误不泄露内部信息。

**dream-ui（`dream-ui`）**

- `MeteredTopUpModal.tsx` 现在把 `order.payment.pay_url` 当纯文本显示 + 「等待支付…」轮询。
  真实网关：H5 收银台 URL 要**在桌面端打开**（浏览器/webview），QR 要渲染成**真二维码图片**。
  这是 Phase 4 的 dream-ui 活，按宝付返回的 `payload` shape 做。
- 现有轮询逻辑（`meteredGetOrder` 每 3s，超时 5min，`paid` → 刷新余额 → done 态）不用改。

**部署（broker）**

- broker 部署在 `43.163.105.71`（systemd，无 Docker），`deploy/redeploy.sh`。新增的
  `BAOFU_*` 环境变量写进服务器上的 systemd unit / `.env`。
- 打包版 dream-ui 默认连 `https://work.1oneclaw.com/trial-broker`
  （`packages/web-host/src/backend-launcher.ts` `TRIAL_BROKER_URL_DEFAULT`）——
  那台 broker 上必须同时配好 `BAOYUN_MASTER_API_KEY` + `BAOFU_*` 功能才真的能用。

### 10.4 验证

- 宝付有 sandbox 就先 sandbox 跑通下单→通知→入账。
- 没 sandbox 就上一档最小真实支付（可临时加个 ¥1 测试套餐），付完在宝付后台退款。
- CDP 真机重跑 §9.5 那条链路，只是把 `MockGateway` 换成 `BaofuGateway`、webhook 由宝付
  真实回调触发（不再是手动 curl）。

### 10.5 未决（问用户 / 等外部）

1. 宝付商户号 —— 申请中，硬前提。
2. 给宝付/对接方的几个问题 —— 没回复，清单在用户手上（问「宝付待回复问题」thread）。
3. 宝付给的是哪个支付产品（H5 收银台 / 扫码 / 快捷）—— 决定 `precreate` 和 dream-ui 付款 UI 的形态。
4. 套餐定价细则：59/99/199 是否 1:1、是否赠送、是否设有效期（§七）。
5. 免费 ¥10 的防刷：现在只按 `install_id` 去重，是否要设备指纹 / 限速阈值（§七、§3.6）。

---

## 十一、宝云迁移到模式 A（2026-09-20，取代 §十）

### 11.1 发生了什么

用户拿着 §7"未决问题"里当初问宝云的 4 个问题（能否程序化设额度/事后追加/查用量/
识别耗尽报错），主动去找宝云要来了答案——宝云控制台新开了「账户 API」
（`/apis/v1`，系统访问令牌鉴权，跟 `/v1` 推理接口用的 `sk-` key 是两套完全独立的
凭据）。四个问题全部有了肯定答案：

1. `POST /apis/v1/api-keys` 创建 Key 时可传 `remain`/`daily_limit`/`monthly_limit`
   程序化设额度，不限于控制台手动点。
2. `PATCH /apis/v1/api-keys/{id}` 传 `remain_delta` 原子追加——宝云文档原话"充值场景
   推荐用此字段，避免 GET 再 SET 与并发扣费互相覆盖"。
3. `GET /apis/v1/api-keys/{id}` 返回 `remain`/`used`，查询已用/剩余毫无问题。
4. `/v1` 推理接口鉴权失败给出干净的机器可读 `error.code`（`token_quota_exhausted`
   / `pre_consume_token_quota_failed` / `insufficient_user_quota` 等），不用像现在
   dream-core 里那样靠文本启发式猜。

这正是 `dream-trial-broker/src/vendor/mod.rs` 里 `ProvisioningMode::IssuedKey`
（模式 A）成立的前提——宝云现在跟 OpenRouter 一样，能发限额子 Key。用户拍板：
宝云直接切到模式 A，快速做完；模式 B 现有代码不删，轻改造成"不指名宝云的通用
参考实现"，只是前端不再展示，留给以后真遇到做不到限额 Key 的中转站用。

**顺带查到的、这次没用上但以后有用的**：`GET /apis/v1/account` 能查**我们自己**
的宝云账户余额（`balance`/`used`），可以以后接进 `/internal/stats` 做余额监控；
`GET /apis/v1/logs` 分页查用量日志（消费/错误/退款，可按 Key 名/模型/时间过滤），
以后能做"用户查自己消费明细"。**账单与定价页确认**：宝云自己的"充值"
（支付宝/微信/银行转账，可开自动充值）是给**我们自己的宝云账户**充值用的，不是
给终端用户个人充值的 API——"我们要不要自己维护账户池子里有钱"这件事，宝云已经
包圆了，不用接任何支付渠道；但"终端用户自己掏钱买套餐"这个产品功能如果要做，
收这笔钱依然得我们自己接（宝付/支付宝/微信商户号），这点没变。

### 11.2 三端改了什么（已完成、已测试、已提交）

**`dream-trial-broker`**（commit 在本仓 `master`，仓库无 remote，只在本机）：
- 新增 `src/vendor/baoyun.rs`：`BaoyunVendor` 实现 `TokenVendor`（`issue_key`/
  `read_usage`/`set_limit`/`revoke`，外加 trait 新增的 `top_up` 原子实现，用
  `remain_delta`）。
- `AppState.vendor`（单个）→ `AppState.vendors: HashMap<vendor_id, Arc<dyn
  TokenVendor>>`，OpenRouter 必配、宝云按 `BAOYUN_ACCESS_TOKEN` 是否存在 opt-in。
- 每日熔断按 vendor 分开算（原来全局一个 `daily_budget_usd_cap`，混不同币种是错的）。
- 新增 `POST /internal/vendors/{vendor}/trial-keys/{install_id}/topup`——运维/未来
  支付 webhook 用的原子充值端点，跟 `/internal/stats` 同一信任层级（不对外、不需要
  dream-ui 调）。
- `TokenVendor` trait 新增 `top_up(handle, delta) -> KeyUsage`，默认实现走
  `read_usage`+`set_limit`（OpenRouter 用默认），宝云覆写成 `remain_delta` 原子调用。
- `KeyUsage`/`VendorClientConfig`/`TrialKeyResponse`/`QuotaStatusResponse` 都加了
  `currency` 字段，前端不再假设所有 vendor 都是美元。
- `src/metered/*`（模式 B）功能完全没动，只改了模块级文档注释说明"现在是参考实现，
  默认不接任何 vendor，宝云已经用不着它了"。
- 67/67 单测过，clippy 干净。

**`dream-core`**（commit + push 到 `origin/main`）：
- `TrialKeyClaimRequest{vendor}` / `TrialQuotaQuery{vendor}`（新类型，照抄已有的
  `MeteredClaimRequest`/`MeteredQuotaQuery`）。
- `TrialKeyResponse`/`TrialQuotaStatusResponse` 加 `currency`（默认 `"USD"`，兼容
  老 broker）。
- `TrialKeyService::request_trial_key`/`read_quota_status` 加 `vendor` 参数转发
  给 broker；`/api/providers/trial-key` 系列路由跟着改。
- 955/955 `dream-core-system` 测试过，clippy 干净。

**`dream-ui`**（commit 到 `main`，push 中）：
- `METERED_TRIAL_VENDORS` 从 `['baoyun']` 改成 `[]`——`isMeteredTrialVendor`/
  `claimMeteredAccount`/`MeteredTopUpModal`/`MeteredTopUpCta` 全部保留、
  `claimMeteredAccount` 单独导出保持单测覆盖，只是现在没有 vendor 会走到那条分支。
  `TrialVendorOptions.tsx` 完全不用改，两个 vendor 现在统一走 `claimIssuedKey`。
- `remainingLabel` 按 `currency` 字段选符号（`¥`/`$`），不再硬编码美元。
- 宝云试用文案（13 语种）去掉"用完可充值"承诺——这轮只做免费额度发放+查余额，
  跟 OpenRouter 现状对齐，充值 UI 还没接给任何一个 vendor。
- tsc 干净，118/118 provider 单测过，i18n 检查过。

### 11.3 没做的事（明确不在这轮范围内）

- **终端用户付费充值**：`top_up`/`remain_delta` 这个能力本身已经写好、测试过、
  能通过 `/internal/vendors/.../topup` 调用，但"用户点了购买按钮之后钱从哪来"
  （宝付/支付宝/微信商户号）完全没做——这个是独立的、以后再排期的工作，两个
  vendor（OpenRouter 和宝云）现状对齐，都停在"能发免费额度，不能收费"这一步。
- 宝云自己的 `GET /apis/v1/account`（我方账户余额监控）、`GET /apis/v1/logs`
  （用户消费明细）都还没接进任何地方，见 §11.1 最后一段。

### 11.4 §十（宝付集成）还有用吗

**没有了，除非以后真的要做"用户点按钮付款"这个功能**。§十当初设想的整套
"broker 自己接宝付网关、维护订单表、处理 webhook"是**给宝云 mode B 用的**——
mode B 需要 broker 自己算账、自己触发充值。现在宝云是 mode A，充值只是调一次
`vendor.top_up()`，不需要 broker 自己维护订单/账本这套东西了。如果以后真做
"用户按钮付款"，需要的是"某个支付渠道通知我们钱到账了"这一小块（可以是宝付，
也可以是别的，跟 vendor 是不是宝云无关），收到通知后调 `top_up` 就完了——
比 §十设想的"整套订单系统"轻得多。
