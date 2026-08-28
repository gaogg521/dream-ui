# 通用 token 平台抽象 + 付费档设计

> 状态：**设计中，未实现**。本文只记录已经用真实 API 验证过的事实和据此推导的方案，
> 没验证的一律标注。实现前请先读完"未决问题"一节——里面有几个只有产品能拍板的选择。
>
> 已实现的现状见 [`../README.md`](../README.md)；部署见 [`../deploy/DEPLOY.md`](../deploy/DEPLOY.md)。

## 目标

1. **通用化**：现在只能对接 OpenRouter，要能接入其它大模型 token 平台（火山方舟、
   硅基流动、DeepSeek 官方等），且接一家的成本尽量低。
2. **免费额度 → 付费转化**：每月 $1 的体验额度用完后，弹出充值提示；用户购买套餐后
   继续使用，可重复充值。

## 一、已用真实 API 验证的事实（2026-08-28）

这几条是设计的地基，都是实际打过 OpenRouter 生产接口拿到的结果，不是文档推测。

### 1.1 子 key 可以有"累积型"上限，不只是周期重置

创建 key 时**不传 `limit_reset`**，返回的 key 是 `limit_reset: null` —— 上限累积消耗、
永不自动重置。这正是"预付充值额度"需要的形态。

| 形态 | 参数 | 语义 | 用途 |
| --- | --- | --- | --- |
| 周期重置 | `limit: 1, limit_reset: "monthly"` | 每个日历月自动回满 $1 | **体验档**（现状） |
| 累积 | `limit: N`，不传 `limit_reset` | 累计花到 N 就停，不回满 | **付费充值档** |

> ⚠️ 关键差异：`limit_reset: "monthly"` 是**按日历自动重置，完全不认支付状态**。
> 如果付费档用它来做"月度订阅"，用户停止付费后 OpenRouter 仍会每月把额度加满 ——
> 必须主动 `PATCH` 降额或禁用。**用累积型上限做预付充值可以完全绕开这个坑**，
> 这也是推荐走"充值"而不是"订阅"的技术理由。

### 1.2 额度耗尽时厂商返回什么

```
HTTP 403
{"error": {"message": "Key limit exceeded (total limit). Manage it using
 https://openrouter.ai/workspaces/default/keys/<hash>", "code": 403}}
```

两点必须注意：

- 是 **403**，不是 402/429。客户端识别"额度用完"要认这个码 + message 特征。
- 这条 message **会泄露公司内部 workspace 地址和 key hash**，
  **绝对不能原样透传给终端用户**。必须在客户端映射成自己的文案。

### 1.3 `PATCH /keys/{hash}` 能改上限，但改完不一定立刻恢复

`PATCH {"limit": 0.02}` 返回 200，`limit_remaining` 确实变正数了，
**但紧接着的推理请求仍然 403**。

这是充值流程最危险的一环：付了钱、额度加上了、用户还是用不了。
恢复时延的实测结论见 [§1.4](#14-充值后多久恢复)。

### 1.4 充值后约 16 秒恢复

实测：把一把已耗尽的 key 从 `limit 0.002` PATCH 到 `0.05`，

```
t+ 0s   HTTP 403   Key limit exceeded
t+16s   HTTP 200   恢复正常
```

是**缓存传播延迟，不是永久标记**（`disabled` 始终为 false/null）。

由此确定充值架构：

- ✅ **PATCH 现有 key 即可，不需要重新签发**，用户本地的 provider 配置完全不动。
  这是最好的结果——否则就得覆写用户可编辑的 provider，复杂度高一个量级。
- ⚠️ **必须处理 15~30 秒的生效空窗**。付款成功后立刻重试仍会 403；
  如果 UI 不做过渡态，用户会以为钱白付了。付款回调后应显示"充值成功，正在生效"，
  并在后台轮询 `read_usage` 直到 `limit_remaining` 生效，或直接给一个 ~30s 的等待动画。

## 二、通用 vendor 抽象

### 2.1 核心认知：不是每家平台都支持"签发带上限的子 key"

OpenRouter 的 Management/Provisioning Keys API 是这套架构成立的**前提**：
能用公司主 key 程序化签发带独立消费上限的子 key。因此 broker 只在"发 key"那一下参与，
**不进入推理链路** —— 没有流量成本、没有延迟、不用扩容。

**火山方舟 / 硅基流动 / DeepSeek 官方是否有等价能力，尚未验证。**
不能假设它们都长得像 OpenRouter。所以抽象必须容纳两种模式：

| | 模式 A：签发子 key | 模式 B：计量代理 |
| --- | --- | --- |
| broker 角色 | 只发 key，不碰流量 | **在推理链路里**，自己计 token 与费用，到额即断 |
| 客户端连谁 | 直连厂商 | 连 broker |
| 前提条件 | 厂商支持程序化签发 + 设上限 | 无，任何厂商都行 |
| 代价 | 无 | 延迟、带宽成本、流式转发复杂度、扩容、单点故障 |
| 状态 | OpenRouter 已跑通 | **只留接口，先不实现** |

**先只实现模式 A。** 模式 B 在 trait 里留位置，等真要接某家、且确认它不支持子 key 时
再补——不为想象中的需求提前付复杂度。

接一家新厂商的成本取决于它落在哪一列：模式 A 确实是"一个 issuer 实现 + 一行配置"；
模式 B 是一个新的转发子系统，量级完全不同。**对外承诺前先验证目标厂商的能力。**

### 2.2 trait 草案

```rust
/// 一家可以在其上签发限额 key 的上游 token 平台。
#[async_trait]
pub trait TokenVendor: Send + Sync {
    /// 稳定 id，落库并回给客户端（"openrouter" / "volcengine" / ...）。
    fn id(&self) -> &'static str;

    /// 该厂商用哪种方式约束额度。模式 B 的方法暂不实现。
    fn provisioning_mode(&self) -> ProvisioningMode;

    /// 客户端要拿去建 provider 的东西：平台标识、base_url、预置模型列表。
    fn client_config(&self) -> VendorClientConfig;

    async fn issue_key(&self, spec: KeySpec) -> Result<IssuedKey, VendorError>;

    /// 读取额度使用情况。付费档的对账和"是否已耗尽"都靠它。
    async fn read_usage(&self, handle: &str) -> Result<KeyUsage, VendorError>;

    /// 充值：抬高上限。
    async fn set_limit(&self, handle: &str, limit_usd: f64) -> Result<(), VendorError>;

    async fn revoke(&self, handle: &str) -> Result<(), VendorError>;
}
```

`handle` 是厂商侧不透明的 key 标识（OpenRouter 用的是 hash）。

> **重要且好用的性质**：OpenRouter 的管理 API 用 **hash** 寻址 key，而 broker 数据库里
> 存的正是 hash（明文 key 只在签发那一次返回，从不落库）。所以 broker **不持有明文也能**
> 查用量、改额度、禁用 key。付费档不需要为此降低现有的安全性。

### 2.3 数据模型改动

`issuances` 表加 `vendor` 列，`openrouter_key_hash` 改名为 `vendor_key_handle`。
去重键从 `install_id` 变成 `(vendor, install_id)`。

### 2.4 跨仓改动面

| 仓库 | 改动 |
| --- | --- |
| `dream-trial-broker` | `TokenVendor` 抽象、OpenRouter 实现、`vendor` 落库、额度查询端点 |
| `dream-core` | `TrialKeyResponse` 加 `platform` 字段；新增额度查询端点的透传 |
| `dream-ui` | 不再硬编码 `platform: 'OpenRouter'`，改读 `trial.platform`；额度耗尽时的充值提示 |

## 三、免费 → 付费转化

### 3.1 推荐走"充值"而非"订阅"

用户表述是"充值套餐 / 重复充值"，技术上也**强烈建议是预付充值**：

- 用 [§1.1](#11-子-key-可以有累积型上限不只是周期重置) 的累积型上限即可表达，
  天然绕开"日历重置不认支付状态"的坑
- 不需要周期扣款、续费、取消、失败重试这一整套订阅生命周期
- 不需要主动对账降额（订阅必须要，否则不续费的人会一直免费用下去）

### 3.2 客户端怎么知道"用完了"

现状：桌面端**直连厂商**，broker 不在推理链路上。所以额度耗尽是客户端先看到 403。

**被动识别（已实现，2026-08-28）**：dream-core 新增错误码
`USER_LLM_PROVIDER_QUOTA_EXHAUSTED`，在按状态码分类**之前**先匹配报文措辞
（`key limit exceeded` / `quota exceeded` / `usage limit reached` 等），并且该错误码
**不透传上游原文**。13 个语种都有文案，用户看到的是母语的"体验额度已用完"。

> 修这个时踩到的坑，值得记住：**错误分类不止一处**。
> `protocol::send_error`（按文本分类）和 `manager::dream_engine::error`（按 HTTP 状态码
> 分类）是两条独立路径，1ONE CLI 会话走的是后者。第一版只改了前者，单测全绿，
> **真机一测发现界面上一点没变**。现在判定逻辑抽成了共享函数、抑制逻辑放在
> `AgentSendError::new` 这个唯一收口，两条路不会再分叉。

**主动查询（未实现）**：broker 新增 `POST /v1/quota/status`（`install_id` 放 body，
不放 query string），内部用 `read_usage` 查。返回 `{vendor, limit_usd, used_usd,
remaining_usd, reset_period, resets_at, exhausted}`。厂商无关，还能做"额度快用完了"的
提前提醒——被动识别只能在用户已经撞墙之后才反应。

### 3.3 ⚠️ 免费模型不消耗美元额度，$1 上限对多数用户不是约束

实测：默认选中的 `openrouter/free` 走免费池，**成本为 $0，完全不碰 key 的 USD 额度**。
所以按现在"免费优先"的模型排序，普通用户**永远不会触发 $1/月的上限**，也就永远看不到
充值提示。

真正约束免费用户的是 OpenRouter 的**免费池请求配额，且它是账号级全局共享的**
（未充值 50 次/天，账号充值满 $10 后 1000 次/天）——所有体验用户共用这一个天花板，
而不是每人一份。这条在最初的设计文档里就用官方文档核实过。

对转化设计的直接影响：

- 想让用户碰到付费墙，模型排序就不能把免费池放第一，或者要把免费池排除在体验额度之外
- 想让免费体验顺畅，就得盯住账号级的那个共享配额，它比 $50/天的发放熔断更早成为瓶颈

**这是产品取舍，不是技术问题**，需要和定价一起决定。

### 3.3 尚未设计的部分

支付渠道对接（支付宝/微信支付）、订单与对账、发票、退款、异常处理，**完全没有设计**。
现有的 `dream-domain-billing` 只服务企业版 SSO 组织场景，个人充值是全新维度。
这部分工作量远大于上面的技术改造，需要单独立项。

## 四、已定的产品决策（2026-08-28）

- **额度耗尽 = 硬阻断**，不降级回免费池。
- **只做抽象，暂不接第二家厂商**。后续大概率是与 AI 中转站合作，那类平台通常是通用的
  （国内常见的 one-api / new-api 一系本身就有创建 token 并设额度/有效期/模型白名单的
  管理接口，与模式 A 对齐），但**仍需逐家验证**才能承诺。
- **充值提示跟随用户系统语言**。已随 `USER_LLM_PROVIDER_QUOTA_EXHAUSTED` 落地 13 语种。

## 五、未决问题（仍需产品拍板）

1. **充值额度与体验额度怎么共存？** 体验档是"每月回满 $1"（周期重置），充值额度是
   "累积消耗"。一把 key 只能有一种 `limit_reset`。所以要么：
   - (a) 用户一旦充值，key 转成累积型，**失去每月免费的 $1**；
   - (b) 一人两把 key，客户端配两条 provider —— 用户可见的复杂度变高；
   - (c) 充值额度也按月计（`limit = 1 + 本月已购`），但这样**未用完的充值额度会月底清零**，
     实质是订阅而非充值，对用户不友好。

   建议 (a)，最简单也最好解释："充值后按实际用量扣，用完再充"。但这是产品取舍。

2. **套餐怎么定价**（金额档位、是否有有效期、是否赠送额度）。

3. **模型排序要不要改**。见 [§3.3](#33-️-免费模型不消耗美元额度1-上限对多数用户不是约束)：
   免费池排第一意味着多数用户永远撞不到付费墙，转化路径事实上是断的。
