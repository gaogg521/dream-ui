# 渠道配置（Channels）— 给 AI 的入门指南

> 读者：第一次接触「设置 → 频道/渠道配置」这块的其他 AI。
> 目的：10 分钟内搞清楚它是什么、代码在哪、数据怎么流、哪些文档已经过期。
> 写于 2026-11-24，结论均来自对 dream-ui 与 dream-core 源码的直接阅读（文中标了文件位置）。

---

## 1. 这是什么

用户在「设置 → 频道」页（桌面端是 WebUI / 频道 两个 Tab，截图标题「渠道配置」）把 **IM 机器人**接到 One Work 上。接好之后，用户可以在 Telegram / Slack / Discord / 飞书 / 钉钉 / 微信 / 企业微信里给机器人发消息，由本机的 AI 助手回复。

页面上 7 张可折叠卡片，顺序固定：

| 顺序 | 渠道      | `plugin_id` | 接入方式                    | 凭据                                                        |
| ---- | --------- | ----------- | --------------------------- | ----------------------------------------------------------- |
| 1    | Telegram  | `telegram`  | 长轮询                      | Bot Token                                                   |
| 2    | Slack     | `slack`     | Socket Mode                 | Bot Token（`xoxb-`）+ App-Level Token（`xapp-`）            |
| 3    | Discord   | `discord`   | Gateway WebSocket           | Bot Token（需开 MESSAGE CONTENT intent）                    |
| 4    | 飞书/Lark | `lark`      | WebSocket                   | App ID + App Secret（可选 Encrypt Key、Verification Token） |
| 5    | 钉钉      | `dingtalk`  | Stream 长连接               | Client ID + Client Secret                                   |
| 6    | 微信      | `weixin`    | 扫码登录（二维码）          | 无需手填，扫码后后端拿 accountId + botToken                 |
| 7    | 企业微信  | `wecom`     | 智能机器人 WebSocket 长连接 | Bot ID + Secret                                             |

卡片 header 有启用开关；开关 = 启用/停用该渠道。展开卡片后是各渠道自己的配置表单。扩展（extension）还能动态追加渠道卡片，带蓝色 `ext` 角标。

## 2. 文档地图（先读哪个）

| 文档                                              | 位置                                                                                              | 可信度                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 渠道 PRD（10 个功能点 F-WEBUI-12~21）             | `dream-ui/docs/prds/remote/channels/channels.md`                                                  | **大体可信，但有 3 处已过期，见 §8** |
| 本文                                              | 同目录 `ai-primer.zh-CN.md`                                                                       | 以源码为准                           |
| 数字员工结果推送（把运行结果发到用户自己的 bot）  | `dream-core/docs/employee-result-notifications.md`                                                | 可信，且比 PRD 新                    |
| 推送目标选择器的 UI 侧说明                        | `dream-ui/docs/guides/session-2026-10-13-automation-templates-push-and-member-knowledge.zh-CN.md` | 可信                                 |
| 手机 H5 适配（频道表单 PreferenceRow 抽共享组件） | `dream-ui/docs/guides/session-2026-11-14-webui-mobile-h5.zh-CN.md`                                | 可信                                 |

`channels/` 目录下的 `dingtalk/ exwechat/ lark/ telegram/ tg/ wechat/` 子目录**全是空的**，不要在里面找东西。

## 3. 代码在哪

**前端（dream-ui）**，目录 `packages/desktop/src/renderer/components/settings/SettingsModal/contents/channels/`：

| 文件                                                                | 作用                                                                     |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `ChannelModalContent.tsx`（988 行）                                 | 页面主体：拉全部渠道状态、监听实时事件、组装 7 张卡片、处理开关          |
| `{Telegram,Slack,Discord,Lark,DingTalk,Weixin,Wecom}ConfigForm.tsx` | 各渠道配置表单（每个 600–800 行，结构高度相似）                          |
| `PreferenceRow.tsx`                                                 | 表单里「标签+描述+控件」行，桌面横排、手机纵排（7 份重复已抽成共享组件） |
| `ManualPairingInput.tsx`                                            | 手动输 6 位配对码的兜底输入框（Telegram/Lark/DingTalk/Wecom/Weixin 用）  |
| `assistantBinding.ts`                                               | 渠道绑定哪个助手的解析逻辑，只信后端规范化过的 `assistant_id`            |
| `ChannelHeader.tsx` / `ChannelItem.tsx` / `types.ts`                | 卡片外壳；`ChannelConfig.status` 取值 `active \| coming_soon`            |

**后端（dream-core）**，crate `crates/dream-core-channel/src/`（约 1 万行）：

| 文件                                                           | 作用                                                                                                                         |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `plugin.rs`                                                    | `ChannelPlugin` trait：`initialize → start → stop`、`send_message`、`edit_message`、`bot_info`、`status`… 每个 IM 平台实现它 |
| `plugins/{telegram,lark,dingtalk,wecom,weixin,slack,discord}/` | 各平台实现，由同名 cargo feature 门控；`plugins/mod.rs::create_plugin` 是工厂                                                |
| `manager.rs`                                                   | `ChannelManager`：启停插件、凭据加密落库、状态广播、启动时 `restore_plugins`                                                 |
| `routes.rs`                                                    | 全部 HTTP 路由（见 §5）                                                                                                      |
| `pairing.rs`                                                   | 配对码生成/批准/拒绝/过期清理，并向前端广播事件                                                                              |
| `action.rs`                                                    | 收到 IM 消息后的总入口：鉴权 → 按钮回调 / 系统命令 / 普通对话                                                                |
| `session.rs`                                                   | 每个 (用户, chat) 一个会话，保证不同群/私聊上下文隔离                                                                        |
| `message_service.rs` + `stream_relay.rs` + `orchestrator.rs`   | 把消息交给 AI 会话，并把流式输出节流后回写 IM                                                                                |
| `channel_settings.rs`                                          | 每个渠道绑定的助手/默认模型，存在 `client_preferences`                                                                       |
| `push_targets.rs`                                              | `GET /api/channel/push-targets`，给定时任务/数字员工选推送对象                                                               |
| `plugin_state.rs`                                              | 插件运行态（如微信 context token、轮询游标）的加密持久化                                                                     |

## 4. 一条消息的完整旅程

```
IM 用户发消息
  → 平台插件收到（长轮询/WebSocket），转成 UnifiedIncomingMessage，经 mpsc 通道交给 Manager
  → ActionExecutor.handle_incoming_message                         [action.rs]
       ├─ 查 (owner, 平台用户ID, 平台类型) 是否已授权
       │     └─ 未授权 → request_pairing：生成 6 位码(10 分钟有效)，广播 channel.pairingRequested，回复用户配对码
       ├─ 按钮回调（regenerate / continue）→ 只认「当前会话」，不接受按钮携带的会话ID或提示词
       ├─ 系统动作：session.new / session.status / help.* / settings.show
       └─ 普通文本 → SessionManager 取/建会话 → 返回 Dispatched
  → ChannelOrchestrator：同一会话同时只处理一条（in_flight 占位）
  → ChannelMessageService 创建/复用 conversation，调用 AI Agent
  → ChannelStreamRelay 订阅流式事件，按平台节流（默认 500ms）反复 edit_message 回写
```

要点：

- **授权靠配对码**，不是靠凭据。凭据只决定 bot 能连上；谁能和 bot 对话要用户在设置页（或手动输入框）点「批准」。
- 配对码 6 位数字，用 `getrandom` 生成；同一用户再次请求会让旧码过期。
- 各平台消息长度上限不同（Telegram 4096、飞书/钉钉/Slack 4000、Discord 2000、企业微信 markdown 4096 字节），在 `constants.rs`。

## 5. 前后端接口对照

前端通过 IPC 桥 `channel.*` 调用，落到 HTTP：

| 前端调用                                                  | HTTP                                                                                                 |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `getPluginStatus`                                         | `GET /api/channel/plugins`                                                                           |
| `enablePlugin({plugin_id, config})`                       | `POST /api/channel/plugins/enable`                                                                   |
| `disablePlugin`                                           | `POST /api/channel/plugins/disable`                                                                  |
| `testPlugin`                                              | `POST /api/channel/plugins/test`                                                                     |
| `getPendingPairings` / `approvePairing` / `rejectPairing` | `GET /api/channel/pairings`、`POST …/approve`、`POST …/reject`                                       |
| `getAuthorizedUsers` / `revokeUser`                       | `GET /api/channel/users`、`POST …/revoke`                                                            |
| 活动会话                                                  | `GET /api/channel/sessions`                                                                          |
| 每渠道助手/模型                                           | `GET /api/channel/settings/{platform}`，以及 default-model 的 PUT，`POST /api/channel/settings/sync` |
| 推送目标                                                  | `GET /api/channel/push-targets`                                                                      |
| 微信扫码登录（WebUI 浏览器端）                            | `GET /api/channel/weixin/login`（SSE）；Electron 端走 `electronAPI.weixinLogin*` IPC                 |

实时事件（WebSocket 推送）：`channel.pluginStatusChanged`、`channel.pairingRequested`、`channel.userAuthorized`。

## 6. 凭据怎么存、怎么重新启用

- `enablePlugin` 的 `config.credentials` 是统一结构，**不同渠道复用同一组字段名**。已核实的映射：
  - 企业微信：`app_id` = Bot ID，`app_secret` = Secret（`WecomConfigForm.tsx:181`，后端 `plugins/wecom/plugin.rs:168`）
  - Telegram/Discord：`token`；Slack：`token` + `app_token`；飞书：`app_id`/`app_secret`/`encrypt_key`/`verification_token`；钉钉：`client_id`/`client_secret`；微信：`account_id` + `bot_token`（见 `PluginCredentials`）
- 后端把整个 config 序列化后用安装级密钥加密存库（`manager.rs::enable_plugin`），表 `ChannelPluginRow.config`。
- **重新启用开关发空 config**：后端发现没带新凭据就回落到库里已存的那份（`load_stored_config`）。所以前端用 `pluginStatus.hasToken` 判断「是否已配置过」，而不是看输入框。
- 授权用户数 > 0 时，前端把凭据输入框和 Test 按钮禁用（防止误改导致已授权用户断连）。提示语：先关闭渠道并删除所有授权用户才能改配置。

## 7. 各渠道的特别之处

- **Telegram / Discord / Slack**：先点 Test（只校验 Bot Token：`getMe` / `GET /users/@me` / `auth.test`），成功后自动 enable。Slack 的 App-Level Token 只在建立 Socket Mode 时才用，Test 不校验它。
- **飞书**：必填 App ID/Secret，Encrypt Key 和 Verification Token 默认折叠；用 protobuf 帧的 WebSocket（`plugins/lark/frame.rs`）。
- **钉钉**：Stream 长连接，不需要回调 URL。
- **微信**：没有手填凭据，状态机 `idle → loading_qr → showing_qr → scanned → connected`。发消息需要「context token」，微信回复复用收到消息时的 token，所以后端把它**加密持久化**（迁移 063），重启后不必等对方再发一条才能主动推送。
- **企业微信**：智能机器人**长连接**模式（`wss://openws.work.weixin.qq.com`，订阅帧 `aibot_subscribe`），不需要回调 URL；按钮是「Save & Enable」一步完成，没有 Test。
- **扩展渠道**：前端按 `extensionMeta.credentialFields / configFields` 动态渲染表单，支持 text/password/select/number/boolean 五种字段；后端 `enable_extension_plugin` 目前**只存元数据，不执行扩展的运行时 JS**。

## 8. 已知的文档/代码不一致（学习时别被带偏）

以下 1–4 项已于 2026-11-24 在 `channels.md` 中更正，列在这里是因为**旧版文档、旧版本克隆、其他 AI 的缓存里可能还是错的说法**；5 是仍然存在的。

1. **企业微信已实现。** `channels.md` 的 F-WEBUI-17 曾在 2026-09-18 标为 `[未实现]`（当时确实没有后端），之后 dream-core 加了 `PluginType::Wecom` 和 `plugins/wecom/`（提交 `ec0f7e5 feat(channel): save WeCom bot adapter…`）。已改回 `[已实现]`，附录 C 里「warning 文案与字段名不一致」那条也已解决（现为 `settings.wecom.configureFirst`「Please save Bot ID and Secret first」）。
2. **`pluginId` 没有 `_default` 后缀。** 旧 PRD 写 `telegram_default`、`wecom_default`，代码里实际是 `telegram`、`wecom`。以 `PluginType` 的 Display（`types.rs`）和前端 `plugin_id: '…'` 为准。
3. **`PluginType` 枚举上 Slack/Discord 的注释仍写 "Reserved variant for future…"**（`types.rs`，**这条注释未改，仍是错的**）：两者早已有完整实现并编进插件工厂，看注释会误判。
4. 页面描述文案以 i18n key `webui.featureChannelsDesc` 为准（中文：「连接 Telegram、飞书/Lark、钉钉、微信，在即时通讯软件中与 One Work 交互。」），旧 PRD 写的是 "Telegram, Lark, and DingTalk"。
5. 部分文档仍称产品为 dream-ui；当前对外品牌名是 **One Work**（来源 `BRAND_DISPLAY_NAME` 常量），新增文案不要写字面量。

## 9. 改这块代码前必须知道的规则

- **i18n**：任何用户可见文案都要走 i18n key，不要硬编码；流程见 `dream-ui/.claude/skills/i18n/SKILL.md`。
- **UI 规范**：Arco Design 组件，不用裸 `<button>/<input>`；图标用 `@icon-park/react`；**不要把图标直接塞进 Arco 的 Tooltip/Dropdown**（IconPark 不转发 ref，React 19 下 hover 即整树卸载白屏）。
- **CSS**：这个项目里 Tailwind 的 `dark:` 变体不生效；没有 box-sizing 重置，`w-full` + `px` 要自己加 `box-border`；色值类名用 `rgba(var(--arco-变量),1)` 形式，`rgb(var(--x)/alpha)` 是死的。新 UI 必须深色模式真机截图。
- **改后端要发版才进安装包**：安装包里的 dreamcore 是 `package.json` 里 `dreamcoreVersion` 固定的下载版本，不是 dev 本地编的那个。
- **新平台插件**要同时做：`ChannelPlugin` 实现 + cargo feature + `create_plugin` 分支 + `PluginType` 变体（枚举改名/新增注意 serde alias 兼容）+ 前端 `BUILTIN_CHANNEL_TYPES` 与配置表单 + 卡片排序 + i18n。漏掉任何一处，表现都是「卡片在但点开报 400 Invalid platform」。
- 验证不要只看测试绿：真机走一遍「填凭据 → 启用 → IM 里发消息 → 拿到配对码 → 批准 → 收到回复」整条链路。

## 10. 一句话总结

> 渠道 = 「平台插件（Rust，每个 IM 一个）」+「配对码授权」+「按 (用户,chat) 隔离的会话」+「流式回写」。前端只是个按 `plugin_id` 分发的配置面板，真正的逻辑都在 `dream-core-channel`；凭据加密落库，授权靠配对码，推送复用同一套连接。
