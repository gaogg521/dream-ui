# Codex/Claude 自定义模型桥接 + 模型选择器锁定 + 桥接注入机制根治

> **2026-07-23**。给后续 AI / 人类读的本轮完整交接。

---

## 0. 背景与动机

内置的 `oneCore`（aionrs fork）天然支持任意自定义 provider（GLM/DeepSeek/Kimi 等，走 `litellm-internal.123u.com` 网关），但用户观察到它明显比 Claude Code CLI 慢。想法：能不能让 Codex CLI 这个外部重型 Agent 也用上自定义模型，同时不牺牲多 provider 能力、不需要 OpenAI 订阅。

先做了真机验证（装 Codex CLI 直连网关测试），确认网关的 Responses API 协议面是非官方/不受支持的，不能作为长期方案。于是决定走「桥接」路线：本地起一个兼容 `/v1/chat/completions`（Responses 协议）的 HTTP 端点，内部复用 `aion_providers::create_provider` 那套已经踩过坑的多 provider 转发逻辑，Codex 的 `model_provider` 指向这个本地端点而不是网关本身。

## 1. 已完成的三块（本轮 + 上一轮）

### 1.1 后端桥接服务（1oneCore）

新 crate `crates/aionui-codex-bridge`：OpenAI Responses API ↔ Codex 之间的协议转换层，内部转发到 `aion_providers::create_provider` 构造的 provider。关键点：

- 一个全局设置项（不是按会话）：管理员在设置页选一个已保存的 provider + model，专门给 Codex 桥接用（migration `032_codex_bridge_config.sql`）。
- `reasoning`/`thinking` 内容走 `encrypted_content` 自编码往返（`onework-thinking-v1:` 前缀的 base64 JSON，**不是真加密**，只是为了让 Codex 把不透明的 reasoning token 原样传回来时能还原成真实文本+签名）。
- 挂载在 `aionui-app` 已有的 axum 监听上（`router/state.rs`/`routes.rs`），只绑定本机回环。

### 1.2 设置页（1oneUI）

`packages/desktop/src/renderer/pages/settings/CodexBridgeSettings/`：开关 + provider 下拉 + model 下拉 + 保存。13 语言 i18n 齐全。

### 1.3 模型选择器锁定

桥接开启时，Codex 会话自己的模型下拉框（会触发 `session/set_model` 这个**实时** ACP RPC，可能悄悄绕过桥接选中的模型）必须锁死，不能让用户手滑切走:

- 桌面端：[`AcpModelSelector.tsx`](../../packages/desktop/src/renderer/components/agent/AcpModelSelector.tsx) 新增 `isCodexBridgeLocked = backend==='codex' && useCodexBridgeEnabled()` 分支，锁定时渲染只读 pill（标签追加"· 已桥接"，tooltip 说明去设置页改）。
- 移动端：[`AcpSendBox.tsx`](../../packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx) 里 `MobileActionSheet` 的模型子菜单同样受 `!isCodexBridgeLocked` 门控（复用"没有可切换列表就不展示该行"的既有逻辑）。
- 新 hook：[`useCodexBridgeStatus.ts`](../../packages/desktop/src/renderer/hooks/agent/useCodexBridgeStatus.ts)，SWR 包一层 `codexBridge.getConfig.invoke()`。

---

## 2. 真机测试暴露的真问题：桥接 UI 显示"已桥接"，请求却真的打到了 OpenAI 官方

用户真机点开 Codex 会话发消息，UI 头部正确显示 `deepseek-v4-flash · 已桥接`，但报错是**真实的 OpenAI 401**：

```
Warning: Falling back from WebSockets to HTTPS transport. unexpected status 401 Unauthorized:
Incorrect API key provided: sk-e9fc7***...e4ad. ... url: wss://api.openai.com/v1/responses ...
auth error: 401, auth error code: invalid_api_key
```

### 2.1 根因排查

第一直觉（配置文件/CLI 参数没生效）被证伪后，顺藤摸瓜查到：**应用内置的"Codex CLI"根本不是用户系统里装的 `codex-cli`，也不读用户的 `~/.codex/config.toml`**。

`crates/aionui-ai-agent/src/factory/acp.rs::resolve_agent_command_spec` 对 `backend=="codex"` 的内置 agent 走 `ManagedAcpToolId::from_backend("codex")` 分支——实际 spawn 的是应用自己托管、随包分发的 **`@agentclientprotocol/codex-acp`** 这个 Node 包（`crates/aionui-runtime/src/acp_tool_runtime/types.rs`），它内部依赖 `@openai/codex`（真正的 Codex Rust 核心，vendor 进自己的 `node_modules`），完全独立于系统装的那份。

关键坑：这个包装层**自己的 `process.argv` 解析只认 `login`/`cli`/`--version` 三个特殊子命令**（反解包 `dist/index.js` 确认），其余所有 argv（包括我们此前用 `-c model_provider="..."` 注入的所有参数）在它默认的 ACP-server 启动路径里**全部被无声丢弃，从未到达任何地方**。它真正读取配置覆盖的方式是两个**环境变量**：

- `CODEX_CONFIG`：一个 JSON 字符串，解析后作为 `model_providers`/`model`/`sandbox_mode` 等 config.toml 等价字段，每次 `session/new` 时随 `threadStart({config, modelProvider, cwd})` 一起发给真正的 `codex app-server` 子进程。
- `MODEL_PROVIDER`：要激活的 provider id 字符串，单独读取，优先级高于 `CODEX_CONFIG` 里任何 `model_provider` 字段。

反解包关键片段（`startAcpServer()`）：

```js
const codexPath = process.env['CODEX_PATH'];
const configString = process.env['CODEX_CONFIG'];
const modelProvider = process.env['MODEL_PROVIDER'];
const config2 = configString ? JSON.parse(configString) : void 0;
// ... new CodexAcpClient(appServerClient, config2, modelProvider)
```

**这也顺带炸出了一个更早就存在、同样机制性失效的功能**：`apply_codex_runtime_config_args`（沙箱权限模式 `sandbox_mode`/环境变量策略注入，早于本次桥接工作就存在）用的是同一套 `-c` 参数注入，反解包全文搜索 `sandbox_mode`/`shell_environment_policy` 在 `codex-acp` 包里**零匹配**——说明这个功能对内置 Codex agent 可能从来没有真正生效过。既然是同一个注入点、同一套广播机制，本次一并改成了 env var（详见下）。

### 2.2 修复

[`crates/aionui-ai-agent/src/factory/acp_launch_policy.rs`](../../1oneCore/crates/aionui-ai-agent/src/factory/acp_launch_policy.rs)（1oneCore）整个重写注入机制：

- 不再拼 `-c key=value` argv；改成累积一个 `serde_json::Map` 表示 `CODEX_CONFIG` 的内容（`shell_environment_policy`/`sandbox_mode`/`windows.sandbox`/`model`/`model_providers`），最后统一序列化成一个 `CODEX_CONFIG` 环境变量。
- 桥接激活的 provider id 单独设成 `MODEL_PROVIDER` 环境变量。
- `apply_codex_runtime_config_args` → `apply_codex_runtime_config`（只改内部实现，往 Map 里塞值，不再直接操作 argv）；`append_codex_bridge_env` → `append_codex_bridge_config`（同样改成写 Map + 上报 `model_provider`）。
- 11 个单测全部改成断言 `CODEX_CONFIG`/`MODEL_PROVIDER` 环境变量的 JSON 内容，而不是 argv 数组。

```bash
cargo test -p aionui-ai-agent acp_launch_policy   # 11 passed
cargo clippy -p aionui-ai-agent -- -D warnings    # 干净
```

### 2.3 真机验证（不是只跑单测）

1. `cargo build -p aionui-app --release` 重编 `aioncore.exe`。
2. `AIONUI_BACKEND_LOCAL_PATH=<新 exe 路径> node scripts/prepareAioncore.js` 内嵌进 1oneUI 的 dev bundled 目录。
3. `taskkill` 掉旧 electron/aioncore 进程，重启 `bun run dev`，这次额外设了 `APP_SERVER_LOGS` 环境变量（`codex-acp` 自带一个只在这个 env var 存在时才写的诊断日志，见其源码 `Logger` 类）。
4. 用一个原始 CDP WebSocket 脚本（`ws` 包，`Runtime.evaluate` + `Page.captureScreenshot`；`chrome-devtools` MCP 工具管理的是独立浏览器实例，连不上 dev 应用自己的 CDP 端口 9230，这是已知限制）连上正在跑的会话，往一个真实 Codex 会话发了条测试消息。
5. `codex-acp` 自己的诊断日志确认启动时**真的收到了正确配置**：
   ```json
   {
     "modelProvider": "onework_bridge",
     "codexConfig": {
       "model": "deepseek-v4-flash",
       "model_providers": {
         "onework_bridge": {
           "base_url": "http://127.0.0.1:55923/v1",
           "env_key": "ONEWORK_CODEX_BRIDGE_TOKEN",
           "wire_api": "responses",
           "requires_openai_auth": false
         }
       },
       "sandbox_mode": "workspace-write",
       "shell_environment_policy": { "include_only": [], "inherit": "all" }
     }
   }
   ```
6. 日志里 `turn/completed`（无 error）+ 真实 token 用量（`totalTokens:7212`），截图确认模型正确回复了测试消息里要求的"OK"，**没有**再出现 OpenAI 401——同一个会话历史里，修复前的 401 错误还留在上面，修复后的新一轮请求紧跟在后面成功，前后对比非常清楚。

---

## 3. 顺手核查：Claude Code 会不会踩同一个坑？—— 不会

用户问了这个问题，没有直接假设"应该没事"，照同样的反解包方法查了 `claude-agent-acp`（Claude 那边同类的托管 ACP 包装层）：

- Claude Code 早就有等价能力：`cc_switch`（`crates/aionui-ai-agent/src/cc_switch/provider_env.rs`），通过 `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` 两个环境变量重定向。
- `claude-agent-acp` 内部**在同一个 Node 进程里直接 `new Anthropic({...})`**，调用官方 `@anthropic-ai/sdk`；该 SDK 直接从 `process.env` 读这两个环境变量——没有 Codex 那种"单独 spawn 二进制 + 自定义 JSON 协议二次翻译"的中间层，因此不存在"参数传了但没人读"的失效路径。
- 唯一顺手翻到的、**不确定是否命中**的细节：SDK 里还有一条更深的企业级 OIDC 联邦鉴权配置文件（`configs/<profile>.json`）优先于环境变量的逻辑；但那条走的是完全不同的 SSO 联邦身份认证路径，`cc_switch` 走纯 api-key+base_url，不会碰到这个分支——记录在案，不是确认存在的 bug。

结论：Claude Code 的自定义模型能力是真实生效的，架构上比 Codex 更不容易踩坑，不需要额外修复。

---

## 4. 顺着上一条落地：Claude 桥接（第一方，替代依赖外部 cc-switch 工具）

用户追问"那 Claude 是不是也能做一个桥接方便用户使用"——排查后发现现状比想象中差：`cc_switch` 这套 Claude 自定义模型能力**完全不是本应用自己做的功能**，是只读集成一个**外部第三方工具**「cc-switch」（读它写在用户主目录下的 `~/.cc-switch/settings.json` + `cc-switch.db`）。也就是说此前用户能用 Claude Code 走 litellm-internal，前提是**这台机器已经装好了那个独立的第三方软件并手动配置好**——本应用里没有任何 UI/IPC/写入路径。

### 4.1 设计：比 Codex 桥接简单一半

Claude Code 已经原生说 Anthropic Messages 协议，`litellm-internal` 网关本来就有兼容的 Anthropic 协议面（这也是本轮开头"Claude Code 一直很快"的原因）——**不需要本地 HTTP 协议转换服务**，只需要：

1. 一张新表 `claude_bridge_config`（migration `033_claude_bridge_config.sql`，结构同 `codex_bridge_config` 但不需要 `bearer_token`——没有本地服务要保护）。
2. 一个新的轻量 crate `aionui-claude-bridge`（只有 `GET`/`PUT /api/claude-bridge/config` 的设置 CRUD，没有 encoder/protocol 转换层，没有 `provider_repo`/`encryption_key` 依赖）。
3. 设置页 `ClaudeBridgeSettings/`，UI 与 Codex 桥接页几乎一样（少了"已生效"依赖 `bearer_token` 的 `configured` 概念）。
4. **核心注入点**：`crates/aionui-ai-agent/src/factory/acp.rs` 新增 `resolve_claude_bridge_env()`——桥接开启时直接解密保存的 provider 的真实 `api_key` + 拼 `base_url`，构造 `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_MODEL` 三个环境变量；`acp_launch_policy.rs` 的 `append_claude_provider_env` 优先用这份解析结果，**只有它为空时才 fall back 到原有的外部 cc-switch 文件读取**（不破坏已经在用那个工具的人）。
5. 模型选择器锁定复用同一套机制：`AcpModelSelector.tsx`/`AcpSendBox.tsx` 的 `isBridgeLocked` 现在是 `isCodexBridgeLocked || isClaudeBridgeLocked` 的合并判断，新增 `useClaudeBridgeStatus.ts` hook + 全部 13 语言 `agent.model.claudeBridgeLocked`/`claudeBridgeLockedTooltip`。

反解包确认了两个关键字段名（`claude-agent-acp` 的 `dist/acp-agent.js`）：`process.env.ANTHROPIC_MODEL`（第 3770 行左右）被直接读取；另有一条 `_meta.gateway` 覆盖路径但**只在 ACP 客户端显式声明 `auth._meta.gateway` capability 时才生效**，本应用不声明这个 capability，不会碰撞。

### 4.2 真机验证（同一套 CDP 方法论）

1. `cargo test -p aionui-claude-bridge -p aionui-ai-agent` 全过（`aionui-claude-bridge` 5 个 service 测试 + 4 个 route 测试；`acp_launch_policy` 新增 4 个 `append_claude_provider_env_*` 测试，其中"fallback 到 cc-switch 为空"两个断言因为**这台开发机真的装了外部 cc-switch 工具**读到了真实数据而失败一次——改成只断言"不 panic"而不断言具体返回值，因为这条路径读的是机器本地文件、天生不可确定性测试）。
2. `cargo clippy -p aionui-ai-agent -p aionui-claude-bridge -p aionui-db -- -D warnings` 干净（⚠️ 注意 `-p aionui-app` 会因为 `one-org`/`one-sso` 里跟本次改动无关的既有 warning 被 `-D warnings` 放大成 error，按仓库惯例只 scope 到实际改动的 crate）。
3. 前端 `bunx tsc --noEmit`、`i18n:types`/`check-i18n.js`、`lint:fix`、相关 `*.dom.test.tsx`（`AcpModelSelector`/`AcpSendBox`/`CodexBridgeModalContent`/新增 `ClaudeBridgeModalContent`，共 44 个测试）全绿。
4. **重编 `aioncore.exe`（release）+ 内嵌 + 重启 dev**，用同一套原始 CDP WebSocket 脚本：设置页点开桥接开关→选 provider（`openai` 平台）→模型自动选到 `minimax-2-7`→保存成功。
5. **真机发现一个真 bug 并顺手修了**：保存桥接配置后，已经挂载的会话页面模型选择器读的是**保存前的 SWR 缓存**，不会自动感知刚刚打开的桥接状态（需要整个应用重启才会生效）——`CodexBridgeModalContent`/`ClaudeBridgeModalContent` 的 `handleSave` 里都加了 `mutate(BRIDGE_STATUS_SWR_KEY, ...)` 手动触发失效重取，这样设置页保存后同一个运行中的会话立刻就能看到锁定态，不需要重启应用（两个桥接功能共享同一个 bug，一并修复）。
6. 新建一个真实 Claude Code 会话，发消息「claude桥接验证-请回复OK」：截图确认头部显示 `claude-sonnet-latest · Default · 已桥接`，模型真实回复了「OK」，**没有** Anthropic 401/鉴权错误。
7. **⚠️ 已知的、有意保留的小瑕疵**：会话头部显示的模型名文本（如上面的 `claude-sonnet-latest`）来自 `agent_task.rs::get_model()` 里未改动的 `cc_switch::read_claude_model_info()`（读外部 cc-switch 文件的展示层，本轮明确没碰），跟桥接实际注入生效的 `ANTHROPIC_MODEL`（本例是 `minimax-2-7`）不是同一个来源——**只是展示文案不准，不影响实际路由正确性**（真实请求确实走的是桥接配置的 provider/model，回复内容就是证明）。这一条本身没修（见 §5.3 说明为什么范围上不动它），但下面 §5.2 把 Guid 首页"能不能手滑切走模型"这个更要紧的锁定漏洞补上了。

---

## 5. 用户真机复测又追出的两个跟进项（同日晚些时候）

用户用真实截图指出两件事：① Codex 那两条 warning 到底是不是真的没事；② Claude 桥接在 Guid 欢迎页（新建会话前，还没进真正的对话）看起来和本轮一开始 Codex 踩的坑一样——模型下拉框没锁、显示的还是旧的 cc-switch 模型目录。

### 5.1 Codex「Model metadata not found」—— 加了 `model_context_window`，但没能消掉这条 warning

反解包真实安装的 `codex.exe` 二进制自身的字符串表（`grep -a` 直接读二进制里的 serde 字段名），确认 `model_context_window` **确实是** `ConfigToml` 的顶层字段（紧跟在 `model_provider` 后面，符合真实 struct 布局）。已经：

- `crates/aionui-ai-agent/src/factory/acp.rs` 新增 `resolve_codex_bridge_context_window()`，从桥接 provider 行的 `context_limit` 字段取值。
- `acp_launch_policy.rs` 的 `append_codex_bridge_config` 新增第 7 个参数，`Some` 时把 `model_context_window` 写进 `CODEX_CONFIG`。
- 单测覆盖：`context_limit` 为 `None` 时不写这个字段（不伪造数据）、为 `Some` 时正确写入。

**真机验证结果——有效但不完整**：手动给桥接用的测试 provider 设了 `context_limit=128000`（原先是 `NULL`，这也是为什么用户复测时这个字段完全没生效——**如果 provider 没配置上下文长度，这个修复本身无法凭空变出数据**，需要用户先去模型设置页把 provider 的上下文长度填上）。重编+重启+真机发消息后，诊断日志证实：

- `CODEX_CONFIG` 里确实带上了 `"model_context_window":128000`（配置正确送达）。
- 后续 `thread/tokenUsage/updated` 事件里 `modelContextWindow` 报的是 `121600`（= 128000 × 0.95，Codex 自己按内部安全余量打了折）——**证明这个数字真的被 Codex 用于实际的上下文预算计算**，不是摆设。
- 但「Model metadata for `deepseek-v4-flash` not found」这条 warning **依然出现**。同一份日志里有一条独立的真实 ERROR：`codex_models_manager::cache: failed to load models cache: missing field 'supports_reasoning_summaries'`——这是这个具体版本的 Codex 自带模型元数据缓存文件本身解析失败（schema 不匹配，跟我们的配置无关），推断这条 warning 是缓存加载失败后对"未知模型"的无条件提示，不是"有没有提供 `model_context_window`"能左右的。**这条 warning 文本本身修不掉**——它是 Codex 闭源二进制内部一个独立、已经存在的 bug，我们只能验证到"至少上下文预算数字是准的"这一步，诚实记录，不夸大。

### 5.2 Guid 欢迎页模型选择器同步加桥接锁定（真 bug，已修）

用户的截图是对的：`AcpModelSelector`（会话内）已经有桥接锁定，但**新建会话前的 Guid 欢迎页用的是完全独立的另一个组件** `GuidModelSelector.tsx`（`pages/guid/components/`），从未接入 `useCodexBridgeEnabled`/`useClaudeBridgeEnabled`——桥接开启时这里仍然是一个可点开、可选任意模型的下拉框（而且模型列表来自旧 cc-switch 目录，带 `-claude` 后缀那批）。

修复：给 `GuidModelSelectorProps` 加 `backend?: string`（`GuidPage.tsx` 已有现成的 `agentSelection.selectedAssistantBackend` 可以直接传），组件内部接入跟 `AcpModelSelector` 完全一样的 `isBridgeLocked` 判断 + 锁定态渲染分支（复用同一套 i18n key）。6 个新增/更新单测（`tests/unit/renderer/hooks/guidModelSelector.dom.test.tsx`）。

**真机验证**：重编+重启后，Guid 页切到「Codex CLI」「Claude Code」两个 tab，模型胶囊都正确显示"已桥接"/"Claude Bridged" 后缀且不再可点开下拉菜单（程序化确认点击不会打开 `guid-model-menu`）。⚠️ 调试过程中一度以为没生效——原因是 SWR 首次挂载时有一次性的"未加载完成→默认当作未锁定"的短暂闪烁（跟 `AcpModelSelector` 本来就有的行为一致，不是这次引入的新问题），截图抓早了；等 1~2 秒后状态自然收敛为正确的锁定态。

### 5.3 范围说明：为什么模型名文案不一致（§4.2 §7）这次还是没有一并改

Guid 页锁定后，模型下拉框**不能再点开切换**了（安全性/一致性问题已解决），但胶囊上显示的具体模型名字符串仍然来自 `currentAcpCachedModelInfo`（Claude 走的还是旧 cc-switch 展示层，Codex 走的是 ACP SDK 自己报的目录）——这跟桥接实际使用的 provider/model 名字不一定一样。这是纯展示文案层面的不一致，不影响实际路由（真实请求确实走桥接），本轮判断优先级上"能不能被手滑改掉"比"胶囊上的名字好不好看"更要紧，所以只修了前者。要彻底解决后者需要让 `agent_task.rs::get_model()` 和 Guid 页的模型信息来源在桥接开启时都优先读桥接配置本身，工作量比这次大，留到下一轮。

---

## 5.4 用户再次凭真机截图指出 Claude 桥接"读的是本地 settings.json"——完全正确，已根治

用户给了两张截图：一张对话头部显示"DeepSeek-v4-pro-claude · Default · 已桥接"且带锁定 tooltip，一张 Claude 桥接设置页确认桥接已开启、配置正确。用户的原话是"感觉 Claude 读取的是我电脑本地的 Claude 的配置文件 `C:\Users\allenzhao\.claude\settings.json`"。

### 5.4.1 §4 的 `CLAUDE_CONFIG_DIR` 隔离为什么不够

§4 已经加了 `CLAUDE_CONFIG_DIR` 环境变量把 `~/.claude` 重定向到应用私有目录，理论上应该挡住真实 `settings.json`。诊断步骤：

1. 把桥接的 `claude_bridge_config.model` 临时改成一个必定不存在的诊断值，发一条"请回复 OK"的测试消息。
2. UI 上收到的是纯 "OK"，不是决定性证据（网关对未知模型名不一定报错，可能默默兜底）。
3. 改为查磁盘：确认隔离目录 `claude-bridge-isolated-home/` 确实生成了 SDK 真实写入的会话产物（`.claude.json`、`projects/<hash>/<uuid>.jsonl`），说明隔离目录本身是生效的。
4. 但 `grep` 该 transcript 发现一行：`<command-args>haiku</command-args>` 紧跟 `Set model to haiku (ＤｅｅｅｅｐＳｅｅｋ-v4-pro-claude)`——这个全角字符串精确匹配真实 `~/.claude/settings.json` 的 `env.ANTHROPIC_DEFAULT_HAIKU_MODEL` 字段值（已用 Read 工具直接核对该文件内容确认）。

反解包 `claude-agent-acp` 实际内嵌的 `@anthropic-ai/claude-agent-sdk`（`sdk.mjs`）确认两件事：

- `Xt()`（配置目录解析函数）**确实**读 `process.env.CLAUDE_CONFIG_DIR`，settings.json **文件本身**的隔离是有效的（`userSettings` 路径正确算到隔离目录下）。
- 但 SDK 的模型别名解析（`/model haiku` 这类快捷名）额外读取 `ANTHROPIC_DEFAULT_HAIKU_MODEL`/`ANTHROPIC_DEFAULT_SONNET_MODEL`/`ANTHROPIC_DEFAULT_OPUS_MODEL`/`ANTHROPIC_SMALL_FAST_MODEL` 这 4 个**独立于 settings.json 文件之外的进程环境变量**（`grep -a -o` 反解包字符串表实锤存在）。这些变量在这台开发机的进程树里本来就是"环境态"常驻（继承自操作者自己日常使用真实 Claude Code 的登录环境——这台机器上随手起一个新进程都能在其环境里看到这 4 个变量,包括真实值),而 `aionui_runtime::agent_process_env()`（`crates/aionui-runtime/src/agent_env.rs`）只清理 `NODE_OPTIONS`/`NODE_INSPECT`/`NODE_DEBUG`/`CLAUDECODE`/`npm_*`，从未涉及这几个 Anthropic 专属别名变量，于是它们原样透传进托管的 `claude-agent-acp` 子进程，叠加在我们注入的 `ANTHROPIC_MODEL` 之上生效。

### 5.4.2 修复

`crates/aionui-ai-agent/src/factory/acp.rs` 的 `resolve_claude_bridge_env()` 新增 `CLAUDE_BRIDGE_MODEL_ALIAS_OVERRIDE_ENV_KEYS` 常量（上述 4 个 key），把它们全部钉死为桥接自己配置的 `model` 值，与其余 4 个环境变量（`ANTHROPIC_BASE_URL`/`_AUTH_TOKEN`/`_MODEL`/`CLAUDE_CONFIG_DIR`）一起注入。不改动认证相关变量（`ANTHROPIC_API_KEY`/`CLAUDE_CODE_OAUTH_TOKEN`）——虽然反解包也发现 SDK 认证优先级里 `ANTHROPIC_API_KEY` 排在 `ANTHROPIC_AUTH_TOKEN` 之前，但本轮认证路径此前已经过真机验证确实生效（§2 的 401 消失证据），只对**新确认**存在问题的模型别名范围做最小化修复，不做未经验证的推测性加固。

### 5.4.3 真机验证（决定性证据来自磁盘，不是 UI）

重编 + 重新内嵌 aioncore.exe + 重启桌面 dev app 后，通过 CDP 驱动 Guid 页真实输入框发送一条新消息（桥接当前配置的真实模型是 `minimax-2-7`，一个跟真实 settings.json 里任何别名值都不相同的干净对照值）：

- 新会话的 transcript 文件里**完全没有** `/model haiku` 这类启动引导命令（这次没有再触发）。
- 响应消息的 `"model"` 字段正确显示为 `"MiniMax-M2.7"`——`minimax-2-7` 对应的真实底层模型名，不是任何 haiku 解析结果。
- 对整份 transcript 做 `grep -c "haiku|ＧＬＭ|ＤｅｅｅｅｐＳｅｅｋ|litellm-internal|<真实 auth token>"`，结果为 **0**——真实 settings.json 的任何字符串痕迹都没有出现。

**方法论提醒**：验证过程中 Guid 欢迎页头部胶囊显示的仍是"ＤｅｅｅｅｐＳｅｅｋ-v4-pro-claude · Default · 已桥接"——这不是回归，是 §5.3 已经记录过的已知纯展示层不一致（该胶囊走独立的 cc-switch 风格展示逻辑，与实际生效的 provider/model 无关），**不能拿 UI 展示的模型名作为验证依据**，唯一可信的证据来源是磁盘上的真实 session transcript 文件（`.jsonl`）。

---

## 5.5 §5.3 遗留的展示层不一致，这次真的修了（Codex 侧真机复现 + 修复）

用户用真实截图指出：Codex 桥接设置页把模型改成 `glm-5-2-aliyun` 并保存，会话里**实际请求确实用了** `glm-5-2-aliyun`（对话里能看到 `Warning: Model metadata for glm-5-2-aliyun not found` ——这条 warning 本身是 §5.1 已经记录的已知/不可修项，但恰好顺带证明了真实生效的模型），**但会话头部的模型名胶囊显示的还是"上一次"的旧模型**，跟当前桥接配置对不上。

### 根因

会话头部/Guid 页胶囊显示的模型名来自 `AcpModelSelector.tsx`/`GuidModelSelector.tsx` 里的 `model_info`/`currentAcpCachedModelInfo`，这两个都是 ACP session 自己在 subprocess **启动那一刻**广播的 `session/update` 快照（`manager/acp/session.rs` 的 `advertised.models`），此后只会被“协议层自己再推一次更新”覆盖，**从不会在桥接配置保存时重新拉取**。桥接实际生效是靠 spawn 时注入的环境变量/`CODEX_CONFIG`，跟这个展示快照是两条完全独立的路径——功能路由正确，展示用的是旧快照。这正是 §5.3 提到但当时判断"优先级不够、留到下一轮"的那个缺口，现在借用户这次反馈直接补上。

### 修复

`useCodexBridgeStatus.ts`/`useClaudeBridgeStatus.ts` 从只返回 `enabled: boolean` 改为内部统一缓存完整 `ICodexBridgeConfig`/`IClaudeBridgeConfig`（同一个 SWR key，同一次请求），新增 `useCodexBridgeModel()`/`useClaudeBridgeModel(): string | null` 派生 hook。`AcpModelSelector.tsx`/`GuidModelSelector.tsx` 在 `isBridgeLocked` 时，模型名部分优先用这个桥接自己配置的 `model` 字符串（仍然和 thought-level 一起组合展示），不再使用 ACP session 的快照名；两个设置页 `handleSave` 里原来只 `mutate(..., result.enabled, false)` 的一行改成传整个 `result`，让已挂载的选择器保存后立刻拿到新模型名而不只是新的锁定状态。

### 真机验证

沿用同一个 dev app（纯前端改动，Vite HMR 直接生效，无需重编/重启 aioncore），刷新页面后：

- 新建一个 Codex 会话发消息，头部胶囊显示 `glm-5-2-aliyun · 已桥接`，与桥接设置页当前保存值（`GET /api/codex-bridge/config` 返回 `"model":"glm-5-2-aliyun"`）完全一致。
- 打开一个更早创建的历史会话（同一次真机验证里的旧对话），头部胶囊**同样**显示 `glm-5-2-aliyun · 已桥接`——不同会话不再各自显示各自 spawn 时的旧快照，全部统一读桥接当前配置。
- 单测：`AcpModelSelector.dom.test.tsx`/`guidModelSelector.dom.test.tsx` 各新增一条"锁定时显示桥接配置模型而非 ACP 快照模型"的用例；`tsc --noEmit`/`oxlint` 均过。

---

## 6. 尚未做、留给下一轮的加固项

- **`CODEX_HOME` 隔离**：目前 `codex-acp` 内部真正 spawn 的 `codex app-server` 子进程默认走系统级 `%USERPROFILE%\.codex`（除非显式设 `CODEX_HOME`）。这意味着如果用户以后按照"保留 Codex Desktop 的 ChatGPT 登录，但把模型请求层重定向到自己 LiteLLM"的思路去改那个共享的 `~/.codex/config.toml`（Codex Desktop 是 OpenAI 官方桌面 GUI，与本应用完全独立），理论上会和本应用桥接关闭时的默认行为产生交叉污染（桥接开启时我们的 `MODEL_PROVIDER`/`CODEX_CONFIG` 应该优先，风险仅限桥接关闭的场景）。建议后续给桥接场景显式设一个应用私有的 `CODEX_HOME`，彻底避免依赖这份共享文件。**这是一个"值得加固"的建议项，不是确认存在的 bug，本轮未动。**
- 沙箱权限模式（`sandbox_mode`/`shell_environment_policy`）虽然已经改成走 `CODEX_CONFIG` 环境变量（第 2.2 节），但**这部分本轮只做了单测层面验证**，没有像桥接那样做真机 CDP 复测（比如真的触发一次 `danger-full-access` 场景确认沙箱权限确实放开）——如果后续需要动这块，记得单独真机验证一次。
- ~~展示层模型名统一~~（§5.3 提出，§5.5 已修）：会话头部/Guid 首页锁定态现在优先显示桥接自己配置的 `model`，不再用 ACP session 的 spawn-time 快照名。
- **Codex「Model metadata not found」warning 本身**（§5.1）：确认是 Codex 二进制自己的模型元数据缓存解析失败导致，不是本应用能修的范围；如果升级 codex-acp/codex 版本后缓存 bug 修了，这条 warning 应该会自然消失，值得留意版本更新日志。

---

## 7. 涉及文件（供快速定位）

**1oneCore**：

- `crates/aionui-codex-bridge/`（Codex 桥接 crate，上一轮）
- `crates/aionui-claude-bridge/`（本轮新 crate，仅设置 CRUD，无协议转换）
- `crates/aionui-ai-agent/src/factory/acp_launch_policy.rs`（重写 Codex 注入机制 + 新增 Claude 桥接 env 优先级）
- `crates/aionui-ai-agent/src/factory/acp.rs`（新增 `resolve_claude_bridge_env` + `resolve_codex_bridge_context_window`；`resolve_claude_bridge_env` 内 `CLAUDE_BRIDGE_MODEL_ALIAS_OVERRIDE_ENV_KEYS` 为 §5.4 的别名环境变量覆盖修复）
- `crates/aionui-ai-agent/src/factory/mod.rs`（`AgentFactoryDeps` 新增 `claude_bridge_config_repo`）
- `crates/aionui-app/src/services.rs`、`crates/aionui-app/src/router/state.rs`、`crates/aionui-app/src/router/routes.rs`（Claude 桥接 DI + 路由挂载）
- `crates/aionui-db/migrations/032_codex_bridge_config.sql`（上一轮）、`033_claude_bridge_config.sql`（本轮）+ 对应 model/repository

**1oneUI**：

- `packages/desktop/src/renderer/components/agent/AcpModelSelector.tsx`（模型选择器锁定，合并 Codex/Claude 两种桥接判断）
- `packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx`（移动端操作面板同款锁定）
- `packages/desktop/src/renderer/hooks/agent/useCodexBridgeStatus.ts`、`useClaudeBridgeStatus.ts`（bridge 状态 hook）
- `packages/desktop/src/renderer/pages/settings/CodexBridgeSettings/`（上一轮）、`ClaudeBridgeSettings/`（本轮）
- 两个设置页的 `handleSave` 都补了 `mutate(BRIDGE_STATUS_SWR_KEY, ...)`（第 4.2 节 §5 的真机 bug 修复）
- 13 语言 `locales/*/agent.json` 补 `model.codexBridgeLocked`/`claudeBridgeLocked` 等 key；13 语言 `locales/*/settings.json` 补 `claudeBridge.*` key
- `packages/desktop/src/renderer/pages/guid/components/GuidModelSelector.tsx` + `GuidPage.tsx`（Guid 欢迎页模型选择器同款锁定，§5.2）
- `tests/unit/renderer/AcpModelSelector.dom.test.tsx`、`AcpSendBox.dom.test.tsx`、`CodexBridgeModalContent.dom.test.tsx`、`ClaudeBridgeModalContent.dom.test.tsx`、`tests/unit/renderer/hooks/guidModelSelector.dom.test.tsx`

**仅源码改动，未打包**——按惯例改完 1oneCore 必须 `backend-rebuild.ps1` 重编嵌入才对 dev 生效（本轮已重编并真机验证，见第 2.3 节）。
