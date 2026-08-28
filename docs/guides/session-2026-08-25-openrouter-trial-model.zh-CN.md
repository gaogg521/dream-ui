# 2026-08-25：OpenRouter 一键体验免费模型

> **新会话/新 AI 首读**：本文档记录"一键体验免费模型"功能的完整实现（跨 dream-ui / dream-core /
> 新建的 `dream-trial-broker` 三个仓库），包括为什么这么设计、踩过的坑、以及怎么验证。
> dream-core 侧的对应细节见 dream-core 仓库同名文档。

## 背景 / 决策过程

目标：新用户打开 One Work 后，不需要自己去 OpenRouter 注册、不需要粘贴 API Key，点一个
"一键体验免费模型"按钮就能立刻用上一个真实可用的模型 provider。

讨论过程中确认了两个关键事实（已用 OpenRouter 官方文档核实）：

- OpenRouter 的 `:free` 免费模型限流是**账号级别、全局生效**的（未充值 50 请求/天，充值满
  $10 后 1000 请求/天）。官方原话："Making additional accounts or API keys will not affect
  your rate limits, as we govern capacity globally." —— 无论"一个账号发多把 key"还是"自动
  注册多个匿名账号"，都拿不到更多免费额度。后者本质是批量注册机器人，不做。
- 可行路径是用 OpenRouter 的 **Management/Provisioning Keys API**
  （`POST https://openrouter.ai/api/v1/keys`），给每个用户发一把**真实计费、但设了每日 $1
  硬顶**的 key（`limit: 1, limit_reset: "daily"`）。这把 key 能访问全量模型目录（不局限于
  `:free`），额度由 OpenRouter 原生按日历重置，不需要自己做模型白名单代理拦截。花的是公司
  自己的真实预算（体验费用），不是薅 OpenRouter 免费池子。

本期只做 $1/天体验版；$7/月付费订阅套餐（收费但只发一部分额度赚差价）是明确的 Phase 2，
本轮不实现，详见下方"未做事项"一节。

## 架构

```
dream-ui（点击"一键体验免费模型"）
        │
        ▼
dream-core 本地服务：POST /api/providers/trial-key（无需请求体）
        │ TrialKeyService 内部：
        │   1. 解析/生成本机稳定的 install_id（存在 client_pref 表里，
        │      key = trial_broker_install_id，user_id = system_default_user）
        │   2. POST 到 dream-trial-broker
        ▼
dream-trial-broker（新建仓库，D:\dream\dream-trial-broker，Rust + Axum + sqlx）
   - 唯一持有 OpenRouter Management Key 的地方
   - install_id 去重 + 按 IP 限流 + 每日 $50 熔断
   - 调用 OpenRouter POST /api/v1/keys（limit=1, limit_reset=daily, expires_at=+90d）
        ▼
OpenRouter（在公司账号下新增一条 key 记录，返回明文 key）
        │
        ▼
broker 记录发放流水（只存 key 的 hash），把 {key, base_url, models} 返回
        ▼
dream-core 原样转发给 dream-ui
        ▼
dream-ui：拿到结果后直接调用已有的 POST /api/providers（CreateProviderRequest）
   落成一条普通、用户可编辑的 provider（id 固定为 "trial-openrouter"，platform=OpenRouter）
```

关键设计决策：

1. **推理请求直连 OpenRouter，不走 broker 代理转发**——broker 只在"发 key"这一下参与，之后
   完全不介入，没有推理流量成本和延迟负担。
2. **`install_id` 由 dream-core 自己解析/生成，不由前端传入**——如果让 Electron 渲染进程生成
   并传递这个 id，等于信任一个客户端可控的值，容易被绕过去重。dream-core 本身就是这台机器上
   唯一的本地服务实例，用它自己的 `client_pref` 表（`system_default_user` 作用域，这是本仓库
   单租户桌面安装的既有身份约定，见 `routes.rs` 里 `PROVIDER_CREDENTIAL_OWNER` 的注释）持久化
   一个稳定 id，天然更可信。
3. **没有复用 `dream-core-system::managed_provider`（企业 SSO 渠道同步机制）**——那套机制是为
   "服务端持续下发完整渠道列表、客户端做增量对账"设计的（企业管理员配置 → 成员机器同步），
   语义是"授权关系持续存在"。而这里是"点一次按钮、领一次 key"的一次性事件，硬套上去反而
   增加复杂度。改为直接调用已有的普通 `POST /api/providers` 创建接口，生成一条用户可编辑的
   普通 provider——反正额度硬顶在 $1/天，允许用户手改风险很低。
4. **本地去重用固定 provider id**（`trial-openrouter`）而不是额外的本地标记状态——好处是
   `isTrialProviderClaimed(providers)` 直接查现有的 providers 数组就行，且第二次创建请求会在
   本地 `POST /api/providers` 这一步自然 409（`create_provider_with_duplicate_id_returns_conflict`
   这条已有测试验证了这个行为），和 broker 侧的 409 语义一致。

## 改了什么

### 新仓库：`dream-trial-broker`

`D:\dream\dream-trial-broker`（独立 git 仓库，未加远程，未部署）。核心端点
`POST /v1/trial-keys`：install_id 去重 → 按 IP 限流 → 每日 $50 熔断 → 调用 OpenRouter →
持久化发放记录（只存 key 的 hash）→ 返回 `{key, base_url, models}`。详见该仓库自己的
`README.md`。**这是全新的基础设施，需要单独决定部署在哪里、由谁运维**——本轮只完成了本地
可编译可测试的代码，没有做任何部署。

### dream-core

- `dream-core-api-types::TrialKeyResponse`（新增，`crates/dream-core-api-types/src/provider.rs`）
- `dream-core-system::trial_key::TrialKeyService`（新增文件 `trial_key.rs`）：解析/生成
  install_id、转发给 broker、把 broker 的 409/429/503 映射成 `SystemError::Conflict` /
  `RateLimited` / `ServiceUnavailable`
- `SystemError` 新增 `RateLimited` / `ServiceUnavailable` 两个变体（`error.rs`）
- 新路由 `POST /api/providers/trial-key`（`routes.rs`），无请求体、无需用户身份
- `SystemRouterState` 新增 `trial_key_service` 字段；`dream-core-app` 的
  `build_system_state()` 里用 `DREAM_TRIAL_BROKER_URL` 环境变量构造（`None` 时功能直接报
  "未配置"，不会静默失败）——**这个环境变量目前没有在任何地方设置，功能默认是关闭的**，
  需要部署 broker 之后再配置。

### dream-ui

- `common/types/provider/providerApi.ts`：新增 `TrialKeyResponse` 类型
- `common/adapter/ipcBridge.ts`：新增 `mode.requestTrialKey`（`httpPost<TrialKeyResponse, void>`）
- `renderer/hooks/agent/useTrialModelClaim.ts`（新文件）：`claimTrialModel()` 纯函数 +
  `useTrialModelClaim()` hook，封装"领 key → 建 provider → 刷新 SWR 缓存"全流程，
  `isTrialProviderClaimed()` 用固定 id `trial-openrouter` 判断是否已经领过
- 入口一：`renderer/pages/settings/components/TrialModelCard.tsx`（新文件），接入
  `AddPlatformModal.tsx` 顶部
- 入口二：`renderer/pages/guid/components/TrialModelBanner.tsx`（新文件），接入
  `GuidPage.tsx`，仅在 `isGeminiMode && modelList.length === 0` 时显示
- i18n：`settings.json` 新增 `trialModel*` 系列 key、`guid.json` 新增 `trialModel.*`，
  已加到全部 13 个语种（`i18n:types` + `check-i18n.js` 均已跑过，无新增错误）

## 验证情况（本轮做了什么、没做什么）

按用户要求，**本轮只验证到编译/类型检查/单元测试，没有打包和跑桌面端手动测试**——用户另
一个会话的企业版拆分还没结束，要等那边收尾后一起测试。

已验证：

- `dream-trial-broker`：`cargo build` + `cargo test` 全绿（7 个测试：2 个限流单测 + 5 个
  集成测试，覆盖首次领取成功 / 409 去重 / 429 限流 / 503 熔断 / 502 上游失败不落库）
- `dream-core`：`cargo check --workspace` 全绿；`cargo test -p dream-core-system` 全绿
  （含新增的 `trial_key` 模块单测）；6 个既有的 `SystemRouterState` 构造测试文件已同步补上
  新字段，没有回归
- `dream-ui`：`bunx tsc --noEmit` 无错误；`bun run i18n:types` + `node scripts/check-i18n.js`
  通过（新增 key 均已同步全部语种，无新增 unknown-key 警告；输出里的大量 warning 是本仓库
  已有的翻译缺口，与本次改动无关）

**没有做**（留给下一个接手的人）：

- 没有 `bun run dev` 起桌面端点击验证（两个入口的 UI 交互、领取成功后能否正常发消息）
- 没有对 OpenRouter 真实 Management API 做手工验证（建两把极小额度的测试 key，确认
  `limit_reset: "daily"` 的实际生效行为和响应字段与文档一致）
- 没有部署 `dream-trial-broker`，`DREAM_TRIAL_BROKER_URL` 没有在任何环境配置——功能在生产
  环境里目前是"关闭"状态，直到有人部署 broker 并配置这个环境变量
- Phase 2（$7/月付费订阅、支付渠道对接、订阅生命周期与 OpenRouter key 状态同步）完全没有
  开始，只在讨论阶段记录了设计要点

## 后续谁接手需要做什么

1. ~~决定 `dream-trial-broker` 部署在哪、怎么发布~~ → 已部署，见下方"2026-08-28 补充"
2. ~~部署后设置 `DREAM_TRIAL_BROKER_URL` 环境变量~~ → 已由 `packages/web-host` 内置默认值
3. 补一次**打包桌面端**手动冒烟：两个入口点击 → 出现 provider → 能正常发消息 → 二次点击/
   重启后正确显示"已体验"（2026-08-28 只用 headless 的 aioncore 二进制验到 `POST
   /api/providers/trial-key` 这一层，没点过真实 UI）
4. 如果要做 Phase 2 付费订阅，重新读一遍本文档"背景"一节里关于 `limit_reset` 不认支付
   状态的坑（订阅到期必须主动 `PATCH` 降额/禁用 key，不能只靠 OpenRouter 自动重置）

---

## 2026-08-28 补充：broker 已部署 + dream-ui 接线

### broker 部署（生产环境已上线）

| | |
|---|---|
| 机器 | `43.163.105.71`（Rocky Linux 10，腾讯云，跑着 nginx + certbot + `operone`） |
| 方式 | **不用 Docker**，源码在服务器上 `cargo build --release`，systemd 拉起，跑在 `127.0.0.1:8787` |
| 服务用户 | `dreambroker`（system / nologin），app 目录 `/opt/dream-trial-broker/` |
| 公网入口 | `https://work.1oneclaw.com/trial-broker` —— 复用已有证书的 `work.1oneclaw.com`，nginx 加一段 `location`（`/etc/nginx/conf.d/1onework-www.conf`），**没有新加 DNS、没有新签证书** |
| `/internal/stats` | 公网返回 404，只有 `127.0.0.1:8787` 能访问 |
| 熔断/额度 | 默认值：`$50/天` 全局熔断、`$1/key/天` 硬顶、90 天过期、每 IP 5 次/小时 |
| Management Key | 存在服务器 `/opt/dream-trial-broker/.env`（0600，仅 `dreambroker` 可读），代码里从不出现 |
| 源码 + 工具链 | 服务器 `/root/build/dream-trial-broker` 留着源码 + rustup，更新跑 `deploy/redeploy.sh` |

部署脚本、systemd unit、nginx 片段、运维手册都进了 broker 仓库的 `deploy/` 目录
（`deploy/DEPLOY.md` 是完整手册）。

**真实链路已验证**（当天用真实 Management Key 跑通，测试 key 已全部 `DELETE` 清理、broker
DB 已重置）：

- `POST /trial-broker/v1/trial-keys` → OpenRouter 真实签发一把 key，返回 `{key, base_url, models}`
- 签出来的 key：`limit=1` / `limit_reset="daily"` / `expires_at=+90d`，与设计完全一致
- 用这把 key 真实调 `deepseek/deepseek-chat` → 正常返回
- 同一 `install_id` 二次请求 → 409 `already_issued`
- 用**打包用的 bundled aioncore 二进制**（`resources/bundled-aioncore/win32-x64/`，当天构建）
  设 `DREAM_TRIAL_BROKER_URL` 后打 `POST /api/providers/trial-key` → 200 拿到真实 key；
  二次 → 409 "this device has already claimed a trial model key"

### dream-ui 接线（`packages/web-host`）

`aioncore` 只有拿到 `DREAM_TRIAL_BROKER_URL` 才会开这个端点。为了"开箱即用"，改成由
`packages/web-host/src/backend-launcher.ts` 在 spawn aioncore 时注入默认值：

- 新增常量 `TRIAL_BROKER_URL_DEFAULT = 'https://work.1oneclaw.com/trial-broker'`
- 新增 `resolveTrialBrokerUrl(isPackaged, raw?)`，优先级：
  **显式非空 env 覆盖 > 显式空值（关闭）> 未设时看 `isPackaged`**
- `buildSpawnEnv(dirs, { isPackaged })` 统一 normalize，保证 aioncore 只会看到"一个可用
  URL"或"完全没有"，不会拿到继承来的空串（dream-core 会把空串当成配错了的值）

**关键决策：默认值只在打包版生效**（`app.isPackaged === true`）。理由是这个 broker 签出的
每一把 key 花的都是**公司自己的 OpenRouter 预算**，所以：

| 场景 | `isPackaged` | 默认行为 |
| --- | --- | --- |
| 打包发布的桌面安装包 | `true` | **开** —— 新用户开箱即用 |
| `bun run dev` / `bun start` | `false` | 关（想测就显式设 env） |
| `bun run webui` 自建服务端 | `false`（`scripts/webui.ts` 写死） | 关 |
| 企业 SSO / Docker 部署 | `false` | 关 —— 不会让别人的部署替公司花钱 |

任何一档都能用显式 `DREAM_TRIAL_BROKER_URL=<url>` 强开、用空值强关。

测试：`backend-launcher.test.ts` 新增 6 条（3 条直接测 `resolveTrialBrokerUrl` 的优先级矩阵、
3 条测 `buildSpawnEnv` 的注入/剔除），该文件 49 passed；`tsc --noEmit`（web-host tsconfig）无错。

### dev 真机验证（2026-08-28，CDP 逐一验证）

用 `DREAM_MULTI_INSTANCE=1`（`dream-ui-Dev-2`，一个**全新空 profile**，才能触发首页空状态
横幅）+ `DREAM_DEVTOOLS_CDP_PORT=9231` 起 dev，用 CDP 驱动真实点击。六项全过：

| # | 场景 | 结果 |
| --- | --- | --- |
| 1 | 全新 profile 打开首页 | 空状态横幅"还没有配置模型 / 一键体验免费模型"正常出现 |
| 2 | 点横幅按钮 | broker 真实签发 → provider 落库（`id=trial-openrouter`，3 个模型）→ 横幅自动消失 → 成功 toast → 模型选择器自动切到 `deepseek/deepseek-chat` |
| 3 | 用领到的模型真实发消息 | 发"只回复两个字：收到"→ 模型回"收到"。**开箱即用这条链路是真的通的** |
| 4 | 「添加模型 → 手动添加」弹窗里的卡片 | 显示对勾 + 已领取文案，`disabled` 属性在位 |
| 5 | 删掉这条 provider 后再点横幅 | 409 → toast"这台设备已经体验过了"（**注意**：Arco 的 Message 3 秒就消失，验证时若隔太久再断言会误判成"没有任何提示"，我第一次就踩了这个坑） |
| 6 | 完整重启 App 后再领 | 仍然 409 —— `install_id` 确实持久化在 `client_pref` 里，**重启不能绕过去重** |

另外单独验证了本次改动的核心行为：**dev 下不设 `DREAM_TRIAL_BROKER_URL` 时**，
`POST /api/providers/trial-key` 返回 400 `trial key issuance is not configured on this
deployment` —— isPackaged 门禁在真实运行链路里生效，不只是单测里成立。

测试期间签出的真实 key 已全部从 OpenRouter `DELETE`，broker 的 `issuances` 表已清空。

### 一个未修的既有问题（不是本次引入）

首页横幅的 CTA 按钮用的是全仓通用的 `bg-primary text-white`，而当前主题
`--primary: #22d3ee`（青色），实测对比度只有 **1.81:1**，远低于 WCAG 的 4.5:1。
但这是**主题层面的既有问题**，不是这个组件引入的——同屏的"1ONE CLI"徽章 2.34:1、
"对话模式" 1.33:1 同样不达标，`bg-primary text-white` 在仓库里另有 6 处在用。
按 AGENTS.md 的 ratchet 规则，改主题的 on-primary 文字色是独立一件事，没有在本次改动里做。

### 打包版验证

`bun run build-win:x64:fast` 产出 `out/win-unpacked/1onecode.exe`，用 Playwright 的
`_electron.launch()` 拉起（**CDP 在打包版被代码明确拒绝**，见 `devtoolsCdp.ts`，所以打包版
只能走 Playwright 这条路），并用仓库自带的 `DREAM_E2E_TEST=1` +
`DREAM_E2E_USER_DATA_DIR=<沙箱>` 把 userData 指到一次性目录——**绝对不能直接裸跑打包版**，
否则会写进 `%APPDATA%\1ONE Code` 这个本机真实生产数据目录（见 CLAUDE.md 顶部的
dev/打包测试警告）。

### 仍未做

- dream-ui 这个改动**还没发版**——需要走 release 流程（版本号 + tag + 产物），桌面用户才拿得到
- Phase 2（$7/月订阅）没动
