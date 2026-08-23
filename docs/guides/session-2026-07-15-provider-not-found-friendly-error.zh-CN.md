# 2026-07-15 历史会话引用已删除 Provider 时的友好提示

> 用户反馈截图：重新打开/续聊几条历史对话时，看到裸内部错误 `Provider 'ff9e8905' not found` / `Provider '38302ea7' not found`。前端 `1oneUI` + 后端 `1oneCore`（`aionui-ai-agent`/`aionui-conversation`/`aionui-api-types` 三个 crate）跨仓改动。已重编本机 dev 验证通过，未出正式安装包。

## 根因

直接查了正在运行的包的数据库（`providers` 表），确认这两个 provider ID 已经不在表里了——用户在这之前删除/重建过 provider（当前只剩 `2bfae26c` 自定义 / `eaf7a63d` Moonshot China，都是最近才建的）。几条历史对话（比如截图里"分析一下这个项目的前后端架构"，2026-07-12 创建）的 `model` 字段里固化的还是旧 provider ID，续聊时后端按这个 ID 查表查不到，抛出裸消息。

## 代码路径（关键教训：一开始判断错了触发路径）

`aionrs::build`（[`factory/aionrs.rs:84`](../../../1oneCore/crates/aionui-ai-agent/src/factory/aionrs.rs:84)）按会话记录的 `provider_id` 查 `providers` 表，查不到就报错。这条路径起初以为只会走"发送消息"同步 HTTP 报错（`ConversationError` → `ApiError` → 前端 toast），照这个假设改完、写完单测、tsc/oxlint 全过后，**用 CDP 实际发一条消息复现，发现真实报错走的是另一条路**：`sendMessage` 请求本身是成功的（消息已经排队），真正的构建失败发生在**异步**的 agent 任务构建阶段，通过 WebSocket 流式协议广播（`AgentSendError::from_agent_error_ref`，[`send_error.rs`](../../../1oneCore/crates/aionui-ai-agent/src/protocol/send_error.rs)），渲染成对话内的"上游 Agent 或模型服务商出错"卡片，而不是一个 toast。之前没加这条流式分类的分支，实测出来的是通用兜底文案 `UNKNOWN_UPSTREAM_ERROR`（原始消息仅出现在可展开的"技术详情"里）。

**教训**：光看代码 + 单测通过不代表覆盖了真实触发路径；这次靠往 dev 数据库里已经天然存在的"历史会话引用已删除 provider"数据（`d54cb7fd`/`aede5534`/`dfb5b0bc` 等）直接在 CDP 里发消息复现，才发现最初的假设是错的，及时补上了真正命中的那条分支。HTTP 路径（`ConversationError`/`ApiError`）那部分改动本身没错、不是浪费——`sendMessage` 请求同步校验失败时仍然会走它，只是不是本次这个具体 bug 的触发路径，两条链路都保留、都要覆盖。

## 修法（两条链路都补齐）

1. **新增专门的错误类型**（不是拿 `BadRequest` 塞字符串）：
   - `crates/aionui-ai-agent/src/error.rs`：`AgentError` 新增 `ProviderNotFound(String)` + `provider_not_found()` 构造函数。
   - `crates/aionui-conversation/src/error.rs`：`ConversationError` 新增对应 `ProviderNotFound { provider_id }`，`error_code()`/`to_agent_error()`/`From<AgentError>` 三处都补上映射，保持双向转换完整。
   - `crates/aionui-api-types/src/agent_error.rs`：`AgentErrorCode` 新增 `ProviderNotFound`（序列化为 `PROVIDER_NOT_FOUND`，跟前端 i18n key 直接对应）。

2. **HTTP 路径**（`sendMessage` 同步校验失败时命中）：
   - `crates/aionui-conversation/src/routes.rs`：`From<ConversationError> for ApiError` 加一支，复用已有的 `ApiError::coded(status, code, message, details)` 模式（`details` 带 `provider_id`）。
   - `crates/aionui-ai-agent/src/routes/error_mapping.rs`：还有一条独立的 `AgentError → ApiError` 直接映射（这个 crate 自己的路由用），同样要加，否则编译报"非穷尽匹配"（`#[non_exhaustive]` 只对外部 crate 生效，本 crate 内的穷尽 match 必须手动补全——这也是本次唯一一次编译报错，靠 `cargo build` 直接抓到）。

3. **流式路径**（真正命中的那条，agent 任务异步构建失败时）：
   - `crates/aionui-ai-agent/src/protocol/send_error.rs`：`from_agent_error_ref` 加一支，`title`="The model configured for this conversation no longer exists"，`ownership=UserLlmProvider`，`retryable=false`，`resolution=ChangeModel + ProviderSettings`（照抄 `UserLlmProviderModelNotFound` 等既有"换模型"场景的写法）。

4. **前端**：
   - `packages/desktop/src/renderer/pages/conversation/utils/conversationCreateError.ts` 的 `getConversationRuntimeWorkspaceErrorMessage`（`DreamEngineSendBox.tsx`/`AcpSendBox.tsx` 共用这一个函数）加 `payload?.code === 'PROVIDER_NOT_FOUND'` 分支——覆盖 HTTP 路径。
   - 流式路径那张卡片本来就是通用组件 `MessageTips.tsx`，靠 `t('conversation.agentError.codes.${errorCode}.title'/'.body')` 动态取 key，不用改代码，只要 i18n key 齐了就自动生效。
   - i18n：`conversation.json` 的 `agentError.codes.PROVIDER_NOT_FOUND` 组，13 个 `supportedLanguages`（读 `i18n-config.json` 拿到的当前列表）全部补齐，`bun run i18n:types` + `node scripts/check-i18n.js` 都过（后者报的 70 条 `memory.*` 未知 key 警告是别的会话遗留，跟本次无关）。

## 测试

- Rust：`AgentError::provider_not_found` 消息格式、`ConversationError` 双向转换、`error_code()` 各加了单测；`cargo test -p aionui-ai-agent -p aionui-conversation -p aionui-api-types`（586+310+其余全部通过，唯一失败 `create_rejects_unavailable_workspace_with_trailing_whitespace_in_request` 跟本次改动无关——零 diff 覆盖到该测试涉及的 `service.rs`/`service_test.rs`，Windows 下工作区路径尾随空格处理的既有问题）。
- `cargo clippy -p aionui-ai-agent -p aionui-conversation -p aionui-api-types -- -D warnings`：0 warning。
- 前端：`tests/unit/renderer/utils/conversationCreateError.test.ts` 加一个 `PROVIDER_NOT_FOUND` 用例；`bunx tsc --noEmit` / `oxlint` / `oxfmt --check` 全过。

## 实测（桌面端 CDP，2026-07-15）

dev 数据库（`%APPDATA%\1one-Dev`）里天然就有引用已删除 provider 的历史会话（`d54cb7fd`/`aede5534`/`dfb5b0bc`），直接拿 `d54cb7fd` 用：

1. 改代码前先复现：把它的 `model` 字段的 `provider_id` 改成不存在的 `deadbeef01`，在这条会话里发消息 → 界面显示"上游 Agent 或模型服务商出错 / UNKNOWN_UPSTREAM_ERROR"，原始消息只在"技术详情"里能看到，坐实前面说的"一开始判断错了触发路径"。
2. 补上流式分类分支后重编 + 重启 dev，再发一条消息 → 卡片变成"该会话使用的模型已被删除 / 这条历史会话原本使用的模型配置已被删除或替换。请在发送前重新选择一个当前可用的模型。"，建议文案"请选择当前账号可用且支持该请求的模型。"，"技术详情"里仍保留 `错误码: PROVIDER_NOT_FOUND` + 原始 `Provider 'deadbeef01' not found`（供排查用，不作为主文案）。
3. 验证完把 `d54cb7fd` 的 `model` 字段改回原值 `{"provider_id":"8e4a9e94","model":"kimi-k2-6","use_model":null}`，未污染 dev 数据。

## 踩坑

- `backend-rebuild.ps1` 的 `prepareAioncore` 两次报 `EPERM`/`Device or resource busy`——第一次是残留的 dev `aioncore.exe` 孤儿进程（没有父 electron 进程）占着 `resources/bundled-aioncore`，`Stop-Process` 杀掉即可；第二次是 Windows 侧瞬时文件锁（跟 07-14 那次一样的现象），`Remove-Item -Recurse -Force` 配几次重试退避就通过了，不是真的被进程占用。
- CDP MCP 工具默认连的是自己独立的 Chrome 实例，不是这个桌面应用的 9230 端口；继续用 node 原生 WebSocket 直连 `/json` 拿到的 page `ws://` 地址跑 `Runtime.evaluate`（helper 见 scratchpad `cdp-eval.mjs`），模拟真实发送要注意 React 受控 `<textarea>` 必须走原生 value setter + 派发 `input`/`keydown` 事件，直接赋值不生效。
- Arco 的 `Message.error` toast 会自动消失（约几秒），CDP 里分两次调用去看很容易扑空；改成在同一次 `Runtime.evaluate` 里"填内容 → 派发 Enter → 等 1.5~2s → 立即读 DOM"一口气做完才稳定抓到。

## 提交 / 推送

见对应 commit（1oneCore + 1oneUI，均推 one-main）。
