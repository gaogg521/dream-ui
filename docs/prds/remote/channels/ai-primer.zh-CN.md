# 渠道配置（Channels）— 现状总览与 AI 入门

> 读者：第一次接触「设置 → 远程连接 → 频道」这块的其他 AI。
> 更新：2026-11-24 重写（桌面 3.0.19，dreamcore pin `v0.1.106`）。
> 写法约定：**"已真机验证"只指仓库里有具名证据的项**；找不到记录的写"未找到记录"，不写成"没测过"，也不写成"通过"。本文作者没有重新登录任何平台复测，所有测试结论都来自下文 §2 列出的证据，请以证据为准。

---

## 0. 一页纸结论

| 渠道      | `plugin_id` | 后端实现                              | 真实平台验证（有证据的部分）                                                                                     | 桌面 UI 入口               |
| --------- | ----------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 飞书/Lark | `lark`      | ✅ WebSocket + 交互卡片               | ✅ 真实群/私聊、配对、撤权重配对、模型回复、卡片（继续/重新生成/新会话）；10-11 抓到并修复"平台重投导致重复执行" | 早已开放                   |
| 微信      | `weixin`    | ✅ 扫码登录 + 长轮询                  | ✅ 用户日常在用；文本/附件回执；**重启后上下文持久化冷重启 3 次通过**                                            | 早已开放                   |
| 钉钉      | `dingtalk`  | ✅ Stream 长连接 + 卡片               | ✅ 10-16 真实连接+配对；10-30 客户端真实往返（群内 @ 后卡片流式回复）、重启自动重连                              | 早已开放                   |
| 企业微信  | `wecom`     | ✅ 智能机器人 WebSocket（10-16 实现） | ✅ WebSocket 真实认证（errcode 0）；用户 10-28 亲测消息往返通过；⚠️ 附件下发仅协议模拟                           | **桌面 3.0.15（10-31）起** |
| Telegram  | `telegram`  | ✅ 长轮询                             | 未找到真实平台验收记录（仅单元/集成测试）                                                                        | 早已开放                   |
| Slack     | `slack`     | ✅ Socket Mode                        | 未找到真实平台验收记录（仅单元测试）                                                                             | 已开放（版本未核对）       |
| Discord   | `discord`   | ✅ Gateway                            | 未找到真实平台验收记录（仅单元测试）                                                                             | 已开放（版本未核对）       |

要点：

- **企业微信不是"未实现"**：旧 PRD 一度这么写，那是 09-18 的状态。现在完整可用，但**只收文本/语音转文字、只能一次性发 markdown（不能编辑已发消息）**。
- **SSO 登录和机器人是两条独立链路**。飞书/钉钉/企业微信各有"登录应用"凭据和"机器人"凭据，互不通用，各自验收（§9）。
- **渠道配置只在用户自己的客户端本地**，企业服务器不下发（§9）。

## 1. 这是什么

用户在「设置 → 远程连接」把 **IM 机器人**接到 One Work 上，之后在 IM 里给机器人发消息，由本机的 AI 助手回复。页面上 7 张可折叠卡片，顺序固定（与截图一致）：Telegram、Slack、Discord、飞书/Lark、钉钉、微信、企业微信；扩展（extension）还能追加卡片，带蓝色 `ext` 角标。卡片 header 的开关 = 启用/停用该渠道。

各渠道的接入与能力差异（已核对源码）：

| 渠道      | 接入方式                   | 凭据（`credentials.*`）                                    | 收（入站）                   | 回写方式                                         | 节流   |
| --------- | -------------------------- | ---------------------------------------------------------- | ---------------------------- | ------------------------------------------------ | ------ |
| Telegram  | 长轮询                     | `token`                                                    | 文本/命令/图片/文档/贴纸     | 编辑原消息                                       | 500ms  |
| Slack     | Socket Mode                | `token` + `app_token`                                      | 文本                         | 编辑原消息                                       | 1200ms |
| Discord   | Gateway WS                 | `token`                                                    | 文本（群内须 @，私聊直通）   | 编辑原消息                                       | 1000ms |
| 飞书/Lark | WebSocket（protobuf 帧）   | `app_id` `app_secret` [`encrypt_key` `verification_token`] | 文本/图片/文件/音频          | 更新交互卡片                                     | 500ms  |
| 钉钉      | Stream 长连接              | `client_id` `client_secret`                                | 文本/图片                    | 卡片流式更新（带按钮=终稿）                      | 500ms  |
| 微信      | 扫码登录 + 长轮询（ilink） | `account_id` `bot_token`（扫码完成事件下发，无手填）       | 文本/语音转文字/媒体项       | **不能编辑**：edit 即新发一条                    | 500ms  |
| 企业微信  | 智能机器人 WebSocket       | `app_id`=Bot ID，`app_secret`=Secret                       | 文本/语音转文字（单聊+群聊） | **不能编辑**：edit 直接报错；markdown 一次性发送 | 500ms  |

### 1.1 各渠道配置字段（逐项）

核对自各 `*ConfigForm.tsx` 与 en-US 文案。"提交字段"指 `enablePlugin` 时放进 `config.credentials` 的键。

**所有渠道共有**（凭据之后的部分）：

- **助手 Assistant**：这个渠道用哪个助手回复，存为后端规范化的 `assistant_id` 绑定。
- **默认模型 Default Model**：仅当所选助手是 dream-engine 兼容类型时可选；否则禁用并提示"随 CLI 运行时的模型"。
- 连接状态、下一步引导（Next Steps）、待批准配对、已授权用户。
- **手动输入 6 位配对码**的兜底框只有 Telegram、飞书、钉钉、微信、企业微信五个有，**Slack、Discord 没有**。
- 凭据一旦保存，输入框占位显示 `••••••••••••••••`，不回读明文；已授权用户数 > 0 时凭据框和测试按钮禁用（微信没有输入框，不适用）。

**各渠道独有字段**：

| 渠道      | UI 字段                                  | 必填 | 占位符               | 提交字段                                                                                                        | 界面里的获取说明                                                             | 按钮                                                         |
| --------- | ---------------------------------------- | ---- | -------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Telegram  | Bot Token（密码框，可切换可见）          | 是   | `123456:ABC-DEF...`  | `token`                                                                                                         | 打开 Telegram，找 @BotFather 发送 `/newbot` 获取                             | Test，成功后自动启用                                         |
| Slack     | Bot Token                                | 是   | `xoxb-...`           | `token`                                                                                                         | 创建 Slack 应用并安装到工作区，复制 Bot User OAuth Token                     | Test（**只校验 Bot Token**），启用时带两个 token             |
| Slack     | App-Level Token                          | 是   | `xapp-...`           | `app_token`                                                                                                     | 开启 Socket Mode，生成带 `connections:write` 权限的令牌                      | 同上                                                         |
| Discord   | Bot Token                                | 是   | `MTAx...`            | `token`                                                                                                         | 创建 Discord 应用、添加 Bot、**开启 MESSAGE CONTENT intent**，复制 Bot Token | Test，成功后自动启用                                         |
| 飞书/Lark | App ID                                   | 是   | `cli_xxxxxxxxxx`     | `app_id`                                                                                                        | 链接到飞书开放平台文档                                                       | Test & Connect                                               |
| 飞书/Lark | App Secret                               | 是   | `xxxxxxxxxxxxxxxxxx` | `app_secret`                                                                                                    | 同上                                                                         | 同上                                                         |
| 飞书/Lark | Encrypt Key（折叠在"显示可选设置"里）    | 否   | —                    | `encrypt_key`                                                                                                   | 事件加密，来自事件订阅设置                                                   | 空值不提交                                                   |
| 飞书/Lark | Verification Token（同上）               | 否   | —                    | `verification_token`                                                                                            | 事件校验，来自事件订阅设置                                                   | 空值不提交                                                   |
| 钉钉      | Client ID                                | 是   | `dingxxxxxxxxxx`     | `client_id`                                                                                                     | 链接「DingTalk Open Platform」（⚠️ 见 §12）                                  | Test & Connect                                               |
| 钉钉      | Client Secret                            | 是   | `xxxxxxxxxxxxxxxxxx` | `client_secret`                                                                                                 | 同上                                                                         | 同上                                                         |
| 微信      | **无输入框**；「Account ID」行里是扫码区 | —    | —                    | `account_id` + `bot_token`，由扫码完成事件（SSE 或 Electron IPC，载荷 `{accountId, botToken}`）下发后前端再提交 | 提示"请用微信扫描二维码"                                                     | 无 Test；扫码确认即启用；已连接后有 Disconnect               |
| 企业微信  | Bot ID                                   | 是   | 无                   | `app_id`                                                                                                        | 链接到企业微信开发文档；提示条说明长连接模式无需回调 URL/域名/公网 IP        | **Save & Enable**（无 Test）；已存凭据且两框都留空时按钮禁用 |
| 企业微信  | Secret                                   | 是   | 无                   | `app_secret`                                                                                                    | 同上                                                                         | 同上                                                         |

几点容易搞错：

- **"测试连接"和"启用"提交的字段形状不一样。** `POST /api/channel/plugins/test` 的请求体是 `{plugin_id, token, extra_config?: {app_id, app_secret}}`，后端按平台再映射成凭据：飞书→`app_id`/`app_secret`（`token` 传空串）；钉钉→`client_id`=`token`、`client_secret`=`extra_config.app_secret`；微信→`bot_token`=`token`、`account_id`=`extra_config.app_id`；其余→`token`（`routes.rs` 约 748–771）。也就是说**钉钉的 Test 把 Client ID 放在 `token` 字段里**，别被字段名误导。飞书的 Test 不带 Encrypt Key / Verification Token。
- **同一组 `credentials` 键被多个平台复用**：`app_id`/`app_secret` 同时是飞书的 App ID/Secret 和企业微信的 Bot ID/Secret；`token` 是 Telegram/Discord/Slack 的 Bot Token。看键名不能反推是哪个平台。
- **后端 `PluginConfig.config`（`mode`、`webhook_url`、`rate_limit`、`require_mention`）是预留字段**：前端不设置、插件不读取（非测试代码里只有 `routes.rs` 构造空值的地方），**别在文案里承诺"限速""群聊是否需 @"可配**。Discord 群内必须 @ 是插件里写死的。
- 扩展渠道的字段不在表里：它们由扩展 manifest 的 `credentialFields` / `configFields` 动态生成，见 PRD 的 F-WEBUI-21。

对"不能编辑"的平台（微信、企业微信），流式回写器会在工具调用前把已累积的助手文本先发出去，否则用户要等到整轮结束才看到东西（`stream_relay.rs` 的 `edit_is_new_send` 判定，只对 Weixin/Wecom 为真）。

单条消息长度上限：Telegram 4096、飞书/钉钉/Slack 4000、Discord 2000、企业微信 markdown 4096 字节（UTF-8 分段，不会截断丢字）。

## 2. 文档与证据地图（先读哪个）

### 当前可信

| 文档                    | 位置                                                                                              | 说明                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **本文**                | `dream-ui/docs/prds/remote/channels/ai-primer.zh-CN.md`                                           | 现状总览                                                                                   |
| 渠道 PRD                | 同目录 `channels.md`                                                                              | 逐功能点的 UI 行为与验收标准；已更正企业微信/pluginId；**验收清单的 `[ ]` 没勾不代表没做** |
| 数字员工结果推送        | `dream-core/docs/employee-result-notifications.md`                                                | 机器人如何被下游功能复用                                                                   |
| 员工通知验收报告        | `D:\dream\outputs\employee-notification-verification-1019.md`                                     | 微信真机附件投递、其余四平台仅协议模拟的边界                                               |
| 真实平台测试交接        | `dream-en/docs/handoff-2026-10-16-sso-and-bot-real-platform-testing.zh-CN.md`                     | 飞书/钉钉/企微 SSO+机器人逐项状态与证据文件名                                              |
| 暂停验收交接            | `dream-en/docs/handoff-2026-10-16-sso-bot-paused.zh-CN.md`                                        | 10-16 停在哪、哪些已通过哪些没有                                                           |
| 钉钉/企微预检与真人验证 | `dream-en/docs/test-report-2026-10-16-dingtalk-wecom-sso-preflight.zh-CN.md`                      | 含 60020、Contact.User.Read 等真实踩坑                                                     |
| 钉钉/企微协议评估       | `dream-en/docs/test-report-2026-10-11-dingtalk-wecom-protocol-review.zh-CN.md`                    | 对照官方 SDK 的 7 处修复                                                                   |
| 客户端 IM 验证口径      | `dream-en/docs/console-capabilities-and-laboratory.zh-CN.md`「IM：字段与客户端验证」              | 10-28/10-30 客户端真实往返的最新记录                                                       |
| 企微 SSO 接入手册       | `dream-en/docs/guide-wecom-sso-setup.zh-CN.md`                                                    | 备案域名、可信 IP 等前置条件                                                               |
| 手机 H5 适配            | `dream-ui/docs/guides/session-2026-11-14-webui-mobile-h5.zh-CN.md`                                | 频道表单在手机上的堆叠                                                                     |
| 推送到自己的机器人      | `dream-ui/docs/guides/session-2026-10-13-automation-templates-push-and-member-knowledge.zh-CN.md` | `push_target` 的 UI 侧                                                                     |

### 已过期，别信

- `dream-en` 里 10-11、10-16 两份交接/评估中**"企业微信机器人尚未实现"**的表述：当时属实，10-16 当天已实现（提交 `ec0f7e5`）。
- 同批文档中"钉钉机器人完整回复未通过"：10-16 暂停时的状态，10-30 已在客户端真实往返通过。
- 旧 PRD 的 `*_default` 形式 pluginId。
- `channels/` 目录下 `dingtalk/ exwechat/ lark/ telegram/ tg/ wechat/` 六个子目录**全是空的**。

### 证据文件（只读，别改）

- `D:\dream\scratchpad\license-audit-20261010\`：飞书 IM 读回、撤权、卡片三动作、重投去重的 JSON/PNG。
- `D:\dream\scratchpad\enterprise-terminal-regression-20261012\`：飞书真实群对话、配对批准、桌面回跳截图。
- `D:\dream\scratchpad\sso-platform-regression-20261016\`：钉钉/企微 SSO 与企微机器人预检（含 `wecom-bot-preflight.json`、官方 SDK 只读副本）。
- `D:\dream\outputs\employee-notification-*-1019*`、`weixin-persistence-*-1019*`：微信附件投递、冷重启、备份恢复。

## 3. 代码地图

**前端 dream-ui**：`packages/desktop/src/renderer/components/settings/SettingsModal/contents/channels/`

| 文件                                                                | 作用                                                                             |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `ChannelModalContent.tsx`                                           | 页面主体：拉全部状态、监听事件、组装 7 张卡片、处理开关、`BUILTIN_CHANNEL_TYPES` |
| `{Telegram,Slack,Discord,Lark,DingTalk,Weixin,Wecom}ConfigForm.tsx` | 各渠道表单（结构高度相似）                                                       |
| `PreferenceRow.tsx`                                                 | 「标签+描述+控件」行，桌面横排、手机纵排                                         |
| `ManualPairingInput.tsx`                                            | 手动输 6 位配对码的兜底（事件漏推时用）                                          |
| `assistantBinding.ts`                                               | 渠道绑定哪个助手；只信后端规范化后的 `assistant_id`                              |

**后端 dream-core**：`crates/dream-core-channel/src/`（约 1 万行）

| 文件                                                     | 作用                                                                                                      |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `plugin.rs` / `plugins/<平台>/`                          | `ChannelPlugin` trait 与七个平台实现，各由同名 cargo feature 门控；`plugins/mod.rs::create_plugin` 是工厂 |
| `manager.rs`                                             | 启停、凭据加密落库、状态广播、启动 `restore_plugins`；运行时按 (owner, plugin_id) 隔离                    |
| `routes.rs`                                              | 全部 HTTP 路由                                                                                            |
| `action.rs`                                              | 入站消息总入口：鉴权→按钮回调→系统动作→普通对话                                                           |
| `pairing.rs`                                             | 配对码（6 位、10 分钟）、批准/拒绝、过期清理、事件广播                                                    |
| `session.rs`                                             | 每个 (用户, chat) 一个会话；`claim_delivery` 做投递去重                                                   |
| `orchestrator.rs` `message_service.rs` `stream_relay.rs` | 把消息交给 AI、串行化同会话回合、节流回写                                                                 |
| `channel_settings.rs`                                    | 每渠道绑定的助手/默认模型（存 `client_preferences`）                                                      |
| `push_targets.rs`                                        | `GET /api/channel/push-targets`                                                                           |
| `plugin_state.rs`                                        | 插件运行态（微信 context token、轮询游标）加密持久化                                                      |
| `formatter.rs`                                           | 按平台转换文本格式（TG→HTML；飞书/钉钉/企微→markdown；Slack→mrkdwn；微信→纯文本）                         |

测试：`crates/dream-core-channel/tests/`（manager、pairing、session_action、stream_relay、message_service、delivery_receipts 以及每平台 factory 集成），另有各插件内联测试。企业微信内联测试只有 3 个（上传回执、消息归一化、UTF-8 分段）。

## 4. 一条消息的旅程

```
IM 用户发消息
  → 平台插件收到，转成 UnifiedIncomingMessage，经 mpsc 交给 Manager
  → ActionExecutor.handle_incoming_message                         [action.rs]
       ├─ (owner, 平台用户ID, 平台) 未授权 → 生成 6 位配对码、广播 channel.pairingRequested、给用户回配对提示
       ├─ 按钮回调：chat.regenerate / chat.continue → 只认"当前会话"，不信按钮携带的会话ID或提示词
       ├─ 系统动作：session.new / session.status / help.* / settings.show（均由按钮触发）
       └─ 普通文本 → SessionManager 取/建会话 → Dispatched
  → ChannelOrchestrator：同一 (owner, session) 同时只处理一条（in_flight 占位）
  → ChannelMessageService：建/复用 conversation → 校验发送闸门 → 调 AI Agent
  → ChannelStreamRelay：订阅流式事件，按平台节流回写
```

可靠性机制（都有迁移/测试，不是口头约定）：

- **投递去重**：`channel_delivery_receipts`（迁移 061，`claim_delivery` 原子占位）。起因是飞书平台超时重投导致同一消息被模型执行两次（见 §6）。
- **同会话回合串行**：避免同一聊天并发两轮互相覆盖（`c48225b`）。
- **按钮"重新生成"原地更新同一张卡片**，不再多发一条（`4b56ad2`，`stream_relay_test::regeneration_reuses_card_without_sending_another_message`）。
- **文本命令**：插件会把 `/xxx` 标成 `Command` 类型，但 `action.rs` 里**没有按 Command 分发的代码**。`/new` 曾在 10-16 被拿来测试，**产品并未确认支持文本命令**；会话控制现在走卡片按钮的 `session.new` 等动作。别在文案里承诺文本命令。

## 5. 前后端接口对照

| 前端 `channel.*`                                                     | HTTP                                                                                            |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `getPluginStatus`                                                    | `GET /api/channel/plugins`                                                                      |
| `enablePlugin({plugin_id, config})` / `disablePlugin` / `testPlugin` | `POST /api/channel/plugins/{enable,disable,test}`                                               |
| `getPendingPairings` / `approvePairing` / `rejectPairing`            | `GET /api/channel/pairings`、`POST …/approve`、`POST …/reject`                                  |
| `getAuthorizedUsers` / `revokeUser`                                  | `GET /api/channel/users`、`POST …/revoke`                                                       |
| 活动会话                                                             | `GET /api/channel/sessions`                                                                     |
| 每渠道助手/模型                                                      | `GET /api/channel/settings/{platform}`、default-model 的 PUT、`POST /api/channel/settings/sync` |
| 推送目标                                                             | `GET /api/channel/push-targets`                                                                 |
| 微信扫码（浏览器端）                                                 | `GET /api/channel/weixin/login`（SSE）；Electron 走 `electronAPI.weixinLogin*`                  |

实时事件：`channel.pluginStatusChanged`、`channel.pairingRequested`、`channel.userAuthorized`。

## 6. 各平台现状与真机验证记录

### 飞书/Lark（验证最充分）

- **真实验收（10-11，证据目录 A/B）**：连接 → 真实群消息 → 收到配对码 → 产品内批准 → 建会话、调模型 → 回复卡片，从飞书侧读回与产品一致；撤销授权后下一条消息重新要求配对且不进模型。10-12/13 补验真实企业模型回复；10-27 私聊→配对→选「1ONE CLI + deepseek-flash-vision-latest」→飞书端实见 `QA1027-OK`。
- **卡片三动作**：继续 / 重新生成 / 新会话均真实点击验证；重新生成原地更新同一消息（群消息数 30→30），一次点击只新增一次模型执行，按钮为中文。
- **重投事故（重要）**：真实事件 `0c438ce9…` 的三次投递都因超时失败（约 3.76s），平台随之重投，造成第二次模型执行。修复三层：①ACK 保留关联头、完整拼包再 ACK 并采用 SDK 响应格式（`09b57bb`）；②兼容新版卡片事件信封（`e73992d`）；③持久化收件记录去重（`4b56ad2`）。另有真实 WebSocket 分片回调测试（`d64dda0`）。
- **未覆盖**：平台重启后重投的**真实平台**补验仍缺（数据库关闭重开/并发测试已过）。
- 显示名：简繁中文界面叫「飞书/Lark」「飛書/Lark」（`6009eb25`）。
- 10-27 验证后已把测试用的 Lark 插件恢复为关闭，加密凭据和授权用户保留。

### 微信（个人微信，非企业微信）

- 扫码登录状态机：`idle → loading_qr → showing_qr → scanned → connected`。
- **context token 是关键**：微信回复必须带收到消息时的 token。曾经只缓存在内存，**重启后主动推送会失败**（实测 `ret=-2 / prepare failed`，收到对方新消息后同一代码恢复）。10-19 已修（`8d53d54`，迁移 063）：token 与轮询游标加密落库、先落库再分发；空游标不会重置已保存位置；落库失败不推进游标。**冷重启 3 次通过**，备份跨机器恢复测试通过（随设置备份一起重加密）。需 dreamcore ≥ `v0.1.91`。
- **真实投递**：用户确认摘要、`result.md`、`report.csv`、失败任务原因"全部收到，附件可打开"；定时任务也获 `sent` 回执。附件走微信加密 CDN，已用真实 CDN 往返脚本验证。
- 微信的 `edit_message` 等于重新发一条。

### 钉钉

- 机器人协议层按官方 SDK 修了 3 处：嵌套卡片参数 `cardPrivateData.params.action`、EVENT 与 CALLBACK 两种 ACK 结构、畸形中文报文 panic（另有 SSO 的 authCode 修复，属于登录链路）。
- 10-16 真实：Stream 连接成功、群消息收到配对提示、管理员批准成功；回复闭环**当时未通过**——先遇到 Provider 空配置，修复后用户收到"仍在生成"。同批代码改为：机器人缺默认模型时返回可操作的配置提示、启动加 120s 超时。
- **10-30 客户端真实往返**：UI 填 Client ID/Secret →「测试并连接」→ Stream 注册 + WebSocket 连接 → 群内 @ 机器人，收到 AI 助理卡片流式回复；客户端重启后自动重连。
- **未覆盖**：钉钉卡片继续/重新生成/新会话的真实点击、断线重连与重复投递的真实矩阵。

### 企业微信

- **实现**：`plugins/wecom/plugin.rs`（499 行），协议参考官方 `aibot-node-sdk`；订阅帧 `aibot_subscribe`，收 `aibot_msg_callback`，发 `aibot_send_msg`（markdown），去重 10 分钟，有限次重连；收到 `disconnected_event` 视为被另一连接顶替而退出。Bot ID/Secret 与 SSO 的 Corp ID/Agent ID **是两套东西**。
- **能力边界**：入站仅文本与语音转文字（单聊 `single` + 群聊 `group`）；不收图片/文件；无交互卡片；出站 markdown 一次性发送、不可编辑；文件走分块上传 `aibot_upload_media_init/chunk/finish` 再 `msgtype:file` 发送（员工通知用）。
- **验证**：10-16 用真实 Bot ID/Secret 过 WebSocket 认证（errcode 0）；用户 10-28 在 DEV 亲自实测消息往返通过；UI 在桌面 **3.0.15（10-31）** 起开放（`81ce8d7e`：此前卡片是硬编码 `coming_soon`、字段名还是旧的 Token/EncodingAESKey）。
- **未覆盖**：文件下发只经协议模拟端验证，真实账号投递未验证；MFA、客户端内免登等是 SSO 的事，与机器人无关。

### Telegram / Slack / Discord

仓库内未找到真实平台验收记录。Slack、Discord 有较多内联单元测试（信封/Gateway 帧解析、去重、@ 提及剥离、速率限制），Telegram 有较完整的回调数据与消息解析测试；**这些不等同于真实账号验收**。

## 7. 凭据、授权与持久化

- 凭据统一放 `enablePlugin.config.credentials`（字段名见 §1 表）。后端把整份 config 序列化后用安装级密钥加密存库；状态接口只告诉前端 `hasToken`，不回读明文。
- **重新启用开关发空 config**：后端回落到库里已存的那份（`load_stored_config`）。所以前端用 `hasToken` 判断"是否配过"，不看输入框。
- **授权靠配对码，不靠凭据**：凭据只决定 bot 能不能连上；谁能和 bot 对话由用户批准配对决定。配对码 6 位、10 分钟、同用户重发会让旧码作废。
- 授权用户数 > 0 时前端锁住凭据输入框和 Test 按钮，防止误改后已授权用户断连。
- 同一平台、同一 owner 只有一条插件记录（行 id 就是 `plugin_id`）。
- 相关迁移：061 投递收件、062 `cron_jobs.push_target`、063 `assistant_plugin_state`（运行态）。设置备份包含运行态，跨机器恢复时与凭据一起用目标机密钥重加密。

## 8. 机器人被谁复用（下游功能）

- **定时任务推送**（`a607e5b` 等）：任务可指定自己的某个机器人 + 聊天（`push_target`），运行成功后把最终回复发过去，detached 投递、不拖慢任务。`push-targets` 只列"已启用的 bot + 它实际聊过的聊天"（平台只有首条消息后才暴露 chat id）；微信、Telegram 的私聊 id 就是用户 id，所以已授权用户在没聊过时也会被提供（`f443584`）。
- **数字员工结果通知**（`3d05a56`）：摘要 + `result.md` + 最多 5 个答案里明确链接的工作区内附件（单个 ≤20MiB、合计 ≤40MiB）。支持微信、企业微信、飞书、钉钉、Telegram；Slack/Discord 不在选择范围。投递记录 `one_employee_deliveries`（`sending/sent/failed`），运行 ID 唯一防重，模糊失败不自动重试，整体 120s 上限。**真实平台只验证了微信；其余四个平台的附件上传是协议模拟端验证。**
- 个人版与企业版客户端都用**本机**的机器人连接，不走企业服务器。

## 9. 与企业版的关系（最容易混淆）

- **两条链路**：飞书/钉钉/企业微信各自有「SSO 登录应用」（后台配、给全公司登录用）和「机器人」（客户端配、给用户自己聊天用）。凭据不通用，验收也分开；"凭据有效"只证明能换 token，不证明回调、权限、可见范围、订阅都对。
- **渠道配置不下发**：企业服务器上登记的 IM 资产不会下发到客户端，也不会让客户端启动机器人。"成员机器人"页只显示服务器能看见的记录，本机机器人不会自动出现。要统一管理需要渠道配置安全分发 + 指定运行节点 + 会话归属上报，尚未做。
- **SSO 真人验证里踩过的坑**（调试机器人时也会遇到类似）：
  - 钉钉：用户资料需个人委托权限 `Contact.User.Read`，URL 的 scope 里要带；回调同时带同值 `code` 与 `authCode` 曾被误判为重复字段。
  - 企业微信：`60020` 里的 `from ip` 才是平台看到的真实出口（通用查 IP 站可能不同，曾出现两个出口）；网页授权可信域名要求**国内备案**域名并部署校验文件，校验文件 HTTP 200 不代表平台已批准；回调域、可信域名、可信 IP 是三个不同字段。
  - 飞书：回调域要和实际网关地址一致，开放平台白名单不全会报 `20029`。

## 10. 排错与易错点

1. **配置保存成功 ≠ 验收通过**。凭据检测、连接、配对、收发要分别记录。
2. **同一个 bot 凭据两个进程同时连会互相抢**：微信是抢轮询，企业微信会收到 `disconnected_event` 被顶下线。做真机验证时 10-19 的做法是先把原 DEV 的 bot 停掉、用拷贝库的实例验证、验完再恢复。
3. **起用户的真实 DEV 会真的补跑 cron 并推送 IM**。验证前先关掉 `assistant_plugins` 与 `cron_jobs`，用完删副本。
4. **微信 `ret=-2 / prepare failed`**：多半是缺会话 context token，让对方先发一条消息；dreamcore ≥ `v0.1.91` 重启后不再丢。
5. **飞书/钉钉回调必须在几秒内 ACK**，超时平台会重投；看到"同一条消息跑了两次模型"先查 `channel_delivery_receipts` 和 ACK 耗时。
6. 企业微信的 `edit_message` 会直接报错，新增功能时别对它调用"更新消息"；微信的"编辑"是新发一条。
7. 企业微信 UI 在 3.0.15 之前是 `coming_soon`；旧安装包里没有这个入口是正常的。

## 11. 改这块代码前必须知道的

- **i18n**：用户可见文案一律走 i18n key（13 种语言），见 `dream-ui/.claude/skills/i18n/SKILL.md`。
- **UI 规范**：Arco 组件，不用裸 `<button>/<input>`；图标用 `@icon-park/react`，**别直接塞进 Arco 的 Tooltip/Dropdown**（不转发 ref，React 19 下 hover 即整树卸载白屏）。
- **CSS**：本应用 Tailwind `dark:` 变体不生效；无 box-sizing 重置，`w-full`+`px` 要加 `box-border`；色值用 `rgba(var(--arco变量),1)`，`rgb(var(--x)/alpha)` 是死的。新 UI 必须深色模式真机截图。
- **改后端要发版才进安装包**：安装包里的 dreamcore 是 `dreamcoreVersion` 固定的下载版本，不是 dev 本地编的。
- **新增平台插件**要同时改：`ChannelPlugin` 实现、cargo feature、`create_plugin` 分支、`PluginType` 变体（注意 serde alias 兼容）、`formatter.rs`、`BUILTIN_CHANNEL_TYPES`、配置表单、卡片排序、i18n。漏一处的典型表现是"卡片在，点开报 400 Invalid platform"。后端有 `builtin_ids_all_parse_as_a_plugin_type` 断言防止清单与枚举漂移。
- **验证要走真实点击路径**，并按§6 的口径写清哪些是真机、哪些是协议模拟。

## 12. 仍未覆盖 / 待办

- Telegram、Slack、Discord：没有真实平台验收记录。
- 飞书：平台重启后重投的真实验证。
- 钉钉：卡片三动作、断线重连、重复投递的真实矩阵。
- 企业微信：文件下发的真实投递；图片/文件入站与交互卡片（不在当前实现范围）。
- 员工通知：飞书/钉钉/企业微信/Telegram 的真实附件投递。
- 渠道配置的企业级安全分发（§9）。
- 后端 `PluginType` 枚举上 Slack/Discord 的 "Reserved variant for future…" 注释仍是错的（早已实现）。
- **钉钉表单的文档链接疑似写错**：`DingTalkConfigForm.tsx` 里 `DINGTALK_DEV_DOCS_URL = 'https://1one.1oneclaw.com'`，链接文字却是「DingTalk Open Platform」。它不是钉钉域名（本仓库其他处用的官网是 `work.1oneclaw.com`，这个子域在仓库里只出现这一次）；旧 PRD 写的是"GitHub Wiki 配置指南"。应改成钉钉开放平台或其 Stream 机器人文档的真实地址——**正确 URL 我没能联网核实，所以没有改**。同一份表单里的飞书、企业微信链接分别指向各自官方文档，是对的。

## 13. 时间线

| 日期  | 事件                                                                                 |
| ----- | ------------------------------------------------------------------------------------ |
| 09-18 | 清掉后端清单里没有实现的企业微信假条目；加防漂移断言                                 |
| 10-11 | 飞书卡片动作、ACK、持久化去重；钉钉 authCode/卡片/ACK 协议修复（企业版 1.0.4 包含）  |
| 10-13 | 定时任务结果推送到自己的机器人（迁移 062）                                           |
| 10-16 | 企业微信机器人适配器落地（`ec0f7e5`，dreamcore v0.1.89）；钉钉/企微 SSO 真人扫码通过 |
| 10-19 | 数字员工结果通知；微信 context 持久化（迁移 063，v0.1.91）；冷重启 ×3                |
| 10-24 | 配对重复批准时保留过期原因                                                           |
| 10-27 | 飞书私聊真实往返（QA1027-OK）                                                        |
| 10-28 | 企业微信 UI 字段修复并开放；用户亲测消息往返通过                                     |
| 10-30 | 钉钉客户端真实往返、重启自动重连                                                     |
| 10-31 | 桌面 3.0.15 发布（含企业微信入口）                                                   |
| 11-14 | 手机 H5 适配（频道表单堆叠）                                                         |
| 11-24 | 本文重写                                                                             |
