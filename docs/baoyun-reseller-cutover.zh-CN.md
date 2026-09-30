# 宝云分销成员 `onework` 切换运行手册

## 已确定的计费边界

宝云主账号是上游成本账户；`onework` 是宝云的下级分销成员。OneWork 用户不会注册宝云账号，也不会共用一把 API Key：broker 为每个 install 签发独立的宝云 Key，Key 归属 `onework`，调用按照 `onework` 的成员折扣计费。

因此产品充值不再做 OneWork 自己的加价换算：用户支付 ¥N，成功结算后该用户 Key 的 `remain` 增加 ¥N。主账号成本、成员售价和利润由宝云分销报表计算。

## 安全切换步骤

1. 在部署的 secret store 写入，不要提交 `.env`：

   ```dotenv
   BAOYUN_ACCESS_TOKEN=<onework 系统访问令牌>
   BAOYUN_ISSUER_ACCOUNT=onework
   BAOYUN_LEGACY_ACCESS_TOKEN=<切换前主账号系统访问令牌>
   TOPUP_PRICE_MARKUP=1.0
   ```

2. 部署包含 migration `0011_baoyun_issuer_account.sql` 的 broker。历史 `issuances.baoyun_account` 保持 `NULL`，代表主账号；新签发的 Baoyun Key 写入 `onework`。
3. 重启前核对：只要仍有活跃的历史 Baoyun 行，就必须保留 `BAOYUN_LEGACY_ACCESS_TOKEN`。broker 在缺少它时拒绝启动，避免将历史 Key 错发到子账户查询。
4. 部署后用一个新 install 申领 Key，并检查宝云 `onework` 子账户的 API Key 列表出现该 Key；用最小文本调用后，在主账号的“分销管理 → 数据报表”检查成员 `onework` 的销量、成本和利润。

## 兼容规则

- 历史 Key 不迁移、不重发、不改余额；查额度、找回明文、充值和用量日志始终使用主账号令牌。
- 新 `onework` Key 只使用子账户令牌；其充值为 1:1，不再使用过去的可见余额/影子账本换算。
- 当所有历史主账号 Key 都过期或被明确停用后，才可删除 `BAOYUN_LEGACY_ACCESS_TOKEN`。在此之前绝不能为了清理配置而删掉它。

## 验收证据

已完成一次独立的子账户烟雾测试：以 `onework` 系统令牌创建了仅允许 `deepseek-v4-flash`、余额上限 ¥0.10 的测试 Key；该 Key 的实际调用已出现在该子账户的用量日志中。金额极小，宝云金额字段按精度显示 ¥0.00；这不影响 Key 归属与调用链路的验证。
