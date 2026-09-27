# 充值预览没打折：数字对，前端不知道（2026-09-27）

## 现象

用户截图：宝云（体验）显示"剩余 ¥5.87"，配的问题是"用户默认领取了5元，他充值1元
后为什么看到的金额是5.87？"

## 根因排查（现场核对，不是猜的）

SSH 到 broker 生产服务器，`sqlite3` 查出这就是某个真实用户的 issuance
（`install_01a0e177-...`，vendor key handle `1190`），拿这个 handle 直接问宝云
真实账户 API：

```json
{"remain": 5.87, ...}
```

跟截图分毫不差。broker 端的 15% 加价逻辑（`dream-trial-broker` §11.13 拍板的
设计）本身完全正确：`5 (免费额度) + granted_for_payment(1.15, 1.0) = 5 + 0.87 =
5.87`。**这不是后端 bug**。

真正的 bug 在 `TrialTopUpModal.tsx`：

```ts
// 改之前
const previewAfter = amountValid && balanceNow !== null ? balanceNow + amount : null;
```

弹窗从来不知道有加价这回事，选 ¥1 就直接显示"充值后 ¥6.00"，但实际到账只有
¥5.87。付款完成后的"已到账"提示犯了同一个错——读的是 `order.amount`（付款
金额），不是实际到账金额。**前端在向用户承诺一个交付不了的数字。**

用户确认了产品要求：**加价对用户必须无感**——不是不修，而是修完之后连"含
手续费"这类说明文案都不要加，用户全程只应该看到一个准确、自洽的最终数字。

## 修法

三仓镜像链路里新增一个只读字段（跟这条链路里已有的模式完全一致）：

| 仓库               | 改动                                                                                                                                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dream-trial-broker | `QuotaStatusResponse` 加 `topup_price_markup: Option<f64>`，`read_quota_status`/`apply_top_up` 两处构造都填上 `state.config.topup_price_markup`                                                                                   |
| dream-core         | `TrialQuotaStatusResponse` 镜像加同名字段（纯透传，`trial_key.rs` 不用改）                                                                                                                                                        |
| dream-ui           | `TrialQuotaStatusResponse` 类型加字段；`useTrialQuota.ts` 新增 `grantedForPayment(markup, paidAmount)`，逐行照抄 broker `granted_for_payment` 的除法+四舍五入到分逻辑；`TrialTopUpModal.tsx` 的"充值后"预览和"已到账"提示都改用它 |

字段缺失（老 broker、或非 issued 类型的 quota）时 `grantedForPayment` 退化成
markup=1（无加价），不会显示一个交付不了的数字，也不会因为除以 0/负数而崩溃。

## 前后端加载

- broker 侧改动需要重新部署才会真正下发这个字段（否则 dream-core 拿到的
  `topup_price_markup` 永远是 `None`，前端照旧退化成无加价预览）。
- dream-core/dream-ui 都是纯代码改动，**要等下次各自发版打包**才对已安装用户
  生效——这跟这条充值链路里其余几处修复（白屏崩溃、死色值等）是同一个状态，
  不是这次新引入的限制。

## 验证

- broker：`quota_status_reports_the_vendors_spend_position` 补充断言新字段；
  135 个测试全绿。
- dream-ui：新增 `tests/unit/renderer/useTrialQuota.test.ts`（`grantedForPayment`
  纯函数，含精确复现这次真实故障的用例：`5 + grantedForPayment(1.15, 1.0) ≈
5.87`）+ `tests/unit/settings/TrialTopUpModal.dom.test.tsx`（组件级回归，
  断言预览文本是"充值后 ¥13.70"而不是错误的"¥15.00"，以及原样复现用户报的
  ¥5→付¥1→¥5.87 场景）。`tsc --noEmit`、`vitest run --changed origin/main`
  （17 文件 137 测试）全过。

## 跨仓交接

完整记录（含 SSH 现场核对细节、production 数据）在 `dream-trial-broker`
`docs/baoyun-metered-proxy-handoff.zh-CN.md` §11.21 与
`docs/HANDOFF.zh-CN.md` §3/§7。
