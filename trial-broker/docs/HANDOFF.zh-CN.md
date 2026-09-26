# 交接文档：dream-trial-broker 试用/充值/查询体系

> **给谁看**：任何第一次接手这个系统的 AI 或人类，不用先读完 §十一 那 17 段
> 历史记录也能干活。这份文档只写"现在是什么样"，**不是**按时间顺序的施工日志——
> 那份日志在 [`baoyun-metered-proxy-handoff.zh-CN.md`](baoyun-metered-proxy-handoff.zh-CN.md)，
> 只有当你需要知道"为什么是这样设计的"时才去翻它。
>
> 本文档写于 2026-09-25，所有数据是当天现场核对过的（SSH 到生产、查真实
> SQLite），不是从记忆或旧文档转抄的。之后谁改了代码但懒得更新这份文档，
> 这里的内容就会跟代码脱节——**看到矛盾以代码/生产现状为准**，然后顺手
> 把这份文档修回来。

## 1. 30 秒说清楚这是什么

三个独立仓库合作，让 dream-ui 桌面客户端的新用户不用自己申请 API Key 也能
免费试用一次模型：

| 仓库                   | 角色                                                   | git remote                                             |
| ---------------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| **dream-trial-broker** | Rust/Axum 独立服务，唯一持有真实上游 vendor 凭据的地方 | **没有 remote**，只在这台机器上，靠 tar+scp 部署（§6） |
| **dream-core**         | 桌面客户端的本地后端，转发 IPC 请求到 broker           | GitHub `gaogg521/dream-core`，走正常 PR/main 流程      |
| **dream-ui**           | Electron 渲染层 UI                                     | GitHub `gaogg521/dream-ui`，走正常 PR/main 流程        |

dream-core/dream-ui 从不直接持有 vendor 的凭据或密钥——所有真实调用都是
`dream-core → https://work.1oneclaw.com/trial-broker → vendor`。

## 2. 系统架构现状

`README.md` 有更完整的版本，这里只列和"试用/充值/查询"这条链路相关的部分。

### 2.1 三种模式（互不共享代码和表）

- **Mode A（issued key，当前唯一在跑的）**：broker 拿公司自己的 vendor
  管理密钥，帮每个新用户铸造一把**真实存在于 vendor 那边、带消费上限**的
  子 key，broker 之后完全不经手推理请求——客户端直接拿这把 key 打 vendor。
  当前 vendor：`baoyun`（有真实充值能力）、`openrouter`（只有免费额度，不能
  充值、不能重新揭示明文、不提供用量日志——见 §5 的"设计如此"清单）。
- **Mode B（计量代理）**：已废弃使用（迁移记录见journal §11.1），代码还在
  但生产没有启用（`BAOYUN_MASTER_API_KEY` 没配）。
- **Mode C（托管搜索）**：跟试用/充值无关，是独立的联网搜索代理，见
  README，本文档不展开。

### 2.2 路由面（`src/routes.rs`，只列 Mode A 相关）

| 路由                                                          | 谁调                                              | 作用                                                                                                                           |
| ------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `POST /v1/trial-keys`                                         | dream-core                                        | 首次申领；重复申领会走"活着就返明文/死了就找回"分支，不是简单 409（journal §11.12）                                            |
| `POST /v1/quota/status`                                       | dream-core                                        | 查这个 install 当前 key 的余额                                                                                                 |
| `POST /v1/topup/orders`                                       | dream-core                                        | 创建真实充值订单（拿二维码）                                                                                                   |
| `GET /v1/topup/orders/:id`                                    | dream-core                                        | 轮询订单状态，`success` 时原子入账（按 15% 加价折算）                                                                          |
| `POST /v1/keys/usage`                                         | **`/usage` 页面自己**，不经过 dream-core/dream-ui | 粘 key 查用量——按 `sha256(key)` 精确匹配 `issuances.key_hash`，找不到就是 404                                                  |
| `GET /usage`                                                  | 浏览器直接访问                                    | 独立静态页面（`webui/usage.html`，`include_str!` 编进二进制），dream-ui 只是 `openExternalUrl` 跳过去，**不是** IPC/嵌入式弹窗 |
| `GET /internal/vendors/:vendor/topups`                        | 运维手工查                                        | 对账：install → 当时那把 key 的充值记录                                                                                        |
| `GET /internal/vendors/:vendor/usage/:install_id`             | 运维手工查                                        | 这个用户在 vendor 那边的真实调用明细（`GET /apis/v1/logs` 透传）                                                               |
| `POST /internal/vendors/:vendor/trial-keys/:install_id/topup` | 运维手工调                                        | 不加价的人工补偿接口（今天补用户 ¥10 用的就是这个）                                                                            |

`/internal/*` 只受"只监听 127.0.0.1:8787、nginx 不转发"这层网络位置保护，
没有额外鉴权。

### 2.3 数据表（`issuances` 是核心）

```
issuances(id, vendor, install_id, vendor_key_handle, key_hash, disabled, issued_at, expires_at, ...)
topup_credits(order_id, vendor, install_id, vendor_key_handle, amount, credited_at)  -- amount 是真实到账金额，未打折
```

`key_hash` 是 2026-09-24 才加的列（migration `0008`），**可空**——不是每把
key 都查得到用量，见 §5。

## 3. 端到端走一遍：一个用户从 0 到能查自己的用量

这是最容易让新接手的人卡住的地方，所以完整走一遍真实调用链：

1. **首次申领**：dream-ui 点"一键体验免费模型" → dream-core
   `TrialKeyService::request_trial_key` → broker `POST /v1/trial-keys` →
   `service::issue_trial_key`：查不到这个 (vendor, install_id) 的 issuance
   → **顺手问一次 vendor 的充值历史**（`paid_total`，防止 broker 本地记录
   丢了但用户其实充过钱，journal §11.14）→ 铸造新 key（同时算好
   `key_hash` 存进这条 issuance）→ 返回明文给客户端。
   **模型档位**（09-26，journal §11.19）：铸造的 key 默认钉死免费模型
   白名单（宝云侧 `model_limits_enabled` + `resolve_trial_models`）；
   若 `paid_total > 0`（这个 install 付过钱）则 `unrestricted_models=true`
   直接发无白名单 key——付费档解锁在签发时就地生效。
2. **正常使用**：客户端直接拿这把 key 打 vendor，broker 完全不参与，也
   不知道具体花了多少（Mode A 的本质）。
3. **key 在 vendor 那边没了**（被删/风控/账户异常）：客户端再次申领同一个
   install_id 时，broker 先问 vendor `key_alive_models`——活着就
   `reveal_key` 原样返回明文；死了就查 `paid_total`、按 15% 折算加进新
   key 的额度、旧 issuance 标 disabled、发一把新 key（journal §11.12）。
4. **充值**：`TrialTopUpModal.tsx` 选金额 → `POST /v1/topup/orders`
   拿二维码 → 用户扫码付给 vendor → 3s 轮询 `GET /v1/topup/orders/:id` →
   `success` 时 `topup::credit_once` 用 `ON CONFLICT DO NOTHING` 保证只
   入账一次，`granted_for_payment(1.15, 实付金额)` 打折后调
   `vendor.top_up`。**入账成功后随即解锁该令牌的模型白名单**
   （`set_model_limits(handle, true)`，best-effort——免费档到此升付费档，
   失败不回滚已入账的钱，下次充值或运维操作重试；journal §11.19）。
5. **查用量**：点击余额药丸菜单里的"查询用量" → `openExternalUrl` 直接
   跳系统浏览器到 `https://work.1oneclaw.com/trial-broker/usage#key=<明文key>`
   （fragment，浏览器不发给服务器）→ 页面自己的 JS 读 fragment、立刻
   `history.replaceState` 抹掉、`POST v1/keys/usage {vendor, key}` →
   broker 算 `sha256(key)` 精确匹配某条未 disabled 的 issuance → 查到就调
   `vendor.read_usage` + `vendor.usage_logs` 拼出余额和明细。

**这条链路里 dream-core/dream-ui 唯一知道的 URL 是硬编码的
`https://work.1oneclaw.com/trial-broker/usage`**（`TrialQuotaBadge.tsx`），
查询本身完全绕开了它们俩，直接打生产 broker。

## 4. 部署与当前生产状态（2026-09-25 现场核对）

- 服务器 `43.163.105.71`，systemd 管，`/opt/dream-trial-broker/`，监听
  `127.0.0.1:8787`，nginx 转发 `work.1oneclaw.com` / `1work.vip` /
  `workgo.vip` 的 `/trial-broker/` 前缀。完整 runbook：
  [`../deploy/DEPLOY.md`](../deploy/DEPLOY.md)。
- **部署方式是 tar+scp，服务器上根本没有 git checkout**（`/root/build/` 下
  只有一堆 `.tgz` 和一个不带 `.git` 的源码目录）。这意味着"本地提交了"和
  "生产跑的是这份代码"是两件独立的事，必须靠重新打包部署才能同步——不能
  假设 git log 能告诉你生产在跑什么。
- 当前二进制：`2026-09-24 22:37` 装的，`systemctl is-active` = `active`。
- `key_hash` 回填覆盖率（现场 SQL 查的）：

  | vendor     | 活跃 issuance 数 | 有 key_hash | 说明                                                                                                                     |
  | ---------- | ---------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------ |
  | baoyun     | 2                | 2（100%）   | 启动回填任务 + 之后新发的 key 都会自动补                                                                                 |
  | openrouter | 43               | 0（0%）     | **按设计**——OpenRouter 不支持 `reveal_key`，回填任务对它天生跳过；这些用户永远查不了用量，除非以后 OpenRouter 一侧也接了 |

- `TOPUP_PRICE_MARKUP` **没有写进生产 `.env`**，所以吃的是代码里的编译期
  默认值 `1.15`（`config.rs:104`）——效果是对的，但如果以后有人改了代码
  默认值又忘了同步公告，价格会在没人注意的情况下悄悄变。建议找个时机把
  它显式写进 `.env`，别依赖默认值。

## 5. 按设计就是这样、不是 bug 的几件事

- **OpenRouter 用户查不了用量**：这个 vendor 的 `TokenVendor` 实现继承
  `reveal_key`/`usage_logs` 的默认 `Unsupported`，不是漏做，是它的账户
  API 本来就不支持。
- **`/internal/*` 没有鉴权**：靠"只监听 loopback、nginx 不转发"这层网络
  位置保护，故意不做成 public API。
- **`/v1/keys/usage` 是公开路由、没有鉴权头**：能算出某把 key 的
  `sha256` 前提是手里真的握着这把 key 的明文，这跟直接拿这把 key 去调用
  模型是同一个信任等级，鉴权就是"哈希对得上"本身。
- **`topup_credits.amount` 是打折前的真实到账金额，`vendor.top_up` 收到
  的是打折后的**——对账要看前者，用户实际拿到多少可用额度看后者。

## 6. 已知的坑（分布在多轮踩过，压缩列一遍）

| 坑                                                     | 一句话                                                                                                                             |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Arco `Trigger`（Tooltip/Dropdown）直接包 IconPark 图标 | React 19 删了 `findDOMNode`，图标不转发 ref，白屏；vitest 默认测不出来，要 fake timers                                             |
| UnoCSS `[rgb(var(--arco变量))]`                        | Arco 调色板是逗号分隔通道，UnoCSS 编出空格语法，声明被浏览器静默丢弃；判据只能是 computed style，不是看 class 名或生成的 CSS       |
| 密钥类的东西传给网页                                   | 用 URL fragment（`#key=`），不能用 query string（会进 nginx/broker 日志）；fragment-only 导航不触发文档重载，必须监听 `hashchange` |
| "老数据优雅降级"这个说法本身就该被怀疑                 | 写这几个字之前先算它多久会被自然更新；试用 key 活 90 天且只有主动找回才换新，等于是"永久损坏"不是"降级"                            |
| 本地记录丢失 ≠ 记录压根不存在                          | 只处理"key 存在但被标记死"的恢复分支，防不住"broker 自己的 issuance 行先丢了"这种情况；两者都要查一次 vendor 的付款历史兜底        |
| 送文本到这台 Linux 服务器前                            | `git archive`、Python `write_text` 都会偷偷转 CRLF，验证行尾再传                                                                   |

## 7. 未完成 / 待办

1. **加价 15% 没有用真实新充值单独验证过**——现有证据只有单测 +
   `apply_top_up`（运维接口，不走打折逻辑）测试出的 ¥10 补偿。要验证得
   真花钱：付 ¥11.5 看到账是不是精确 ¥10.0。
2. **`TOPUP_PRICE_MARKUP` 建议显式写进 `.env`**，别依赖代码默认值（见 §4）。
3. **dream-ui 这边的修复还没进任何发布包**——白屏崩溃、41 处死色值、
   充值/查询重做全在 `main`，用户装的包里没有，下次打包才生效。
4. **dream-trial-broker 没有 git remote**——考虑要不要建一个，否则这几十
   个提交只存在这台机器的磁盘上。
5. **43 条 OpenRouter issuance 永远查不了用量**——设计如此（§5），但如果
   以后想给这批用户开查询入口，得先想清楚"没有明文可揭示"这个硬约束
   怎么绕。

## 8. 深入阅读

- 完整决策过程 + 每轮真机验证记录（17 段，按时间顺序）：
  [`baoyun-metered-proxy-handoff.zh-CN.md`](baoyun-metered-proxy-handoff.zh-CN.md)
- vendor 抽象层 + 付费层设计：
  [`vendor-abstraction-and-paid-tier.zh-CN.md`](vendor-abstraction-and-paid-tier.zh-CN.md)
- dream-ui 侧这轮 UI 重做的细节（Arco/React 19 根因、41 处死色值判据）：
  dream-ui 仓 `docs/guides/session-2026-09-24-trial-quota-ui-and-dead-color-classes.zh-CN.md`
- 部署 runbook：[`../deploy/DEPLOY.md`](../deploy/DEPLOY.md)
