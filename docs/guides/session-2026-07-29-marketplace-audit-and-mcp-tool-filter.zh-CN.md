# 2026-07-29：专家市场功能审查 + MCP 默认分发 + 单工具级 schema 过滤修复

## 背景

承接 07-28 专家市场 + 聊天框专家选择器那批改动，用户提出三个问题：①这批新功能有没有调用链 BUG；②装进"我的助手"的专家为什么好像不能编辑；③打包给终端用户时，专家人设和 MCP 工具是否会一起带过去。查完之后用户又追问："ftshare/stock-sdk 这两个 MCP 是我给股票专家用来查股票的，而且我确认没有存 Key 进去，能不能推给终端用户"，以及"那个已知的工具名不合法 bug 能不能修，不能越修越坏"。全程是纯代码审查 + 真机（CDP 直连开发环境）验证，没有臆测。

## 一、专家市场功能审查（纯排查，未改代码）

逐个查了 07-28 新增的调用链（`marketplace_install`、`materialize_marketplace_personas`、`ExpertMarketplaceGrid.tsx`、`GuidExpertPickerGrid.tsx`、`GuidPage.tsx` 的 `handleInstallAndSelectPersona`、`TeamCreateModal.tsx` 的 `handleInstallAndSelectAssistant`），核心逻辑（幂等 upsert、`delete_missing` 防孤儿行、IME 合成事件抑制、搜索合并去重）没问题。

**找到一处轻微不一致（未修，记录在案）**：07-28 第七节新增的三处"未安装专家点击自动安装"入口，错误处理不统一——设置页专家市场卡片和团队创建/添加成员弹窗都有 `Message.error` 提示 + 防重复点击锁；唯独 Guid 页"+"菜单的 `handleInstallAndSelectPersona`（`GuidPage.tsx`）只有 `console.error`，装失败时界面上什么反馈都没有，卡片也没有防连点锁。影响面很小（只在安装失败时才会暴露），本轮未修，后续要补的话是照抄 `TeamCreateModal.tsx` 那套 `pendingAssistantId` 锁 + `Message.error` 的写法。

顺带核实 `AssistantListPanel.tsx` 里有一处仍是旧写法（`assistant.source === 'user'` 精确匹配 `canDelete`，没有升级到 07-28 新加的 `isMutableAssistantSource()`），但这个文件全仓没有任何地方引用（孤儿文件），不影响现在的界面，未处理。

## 二、"专家不能编辑"——核实为非预期，非 BUG

前端 `isReadOnlyAssistant`/`isIdentityLocked` 只对 `source==='builtin'` 生效，后端 `update`/`write_rule`/`set_avatar` 的每个分支都明确包含 `AssistantSource::Imported`（[`assistantTypes.ts`](../../packages/desktop/src/common/types/agent/assistantTypes.ts) 注释原文："`user`（手写）和 `imported`（人设库导入）都完全可编辑/可删除"）。判断专家市场装进来的助手和手写助手权限完全一致，可以编辑名字/头像/描述/系统提示词/模型/技能/MCP 默认值。最可能的原因是"我的助手"列表三点菜单里编辑入口文案是"设置"不是"编辑"（[`MyAssistantRow.tsx`](../../packages/desktop/src/renderer/pages/settings/AssistantSettings/home/MyAssistantRow.tsx)），容易被当作没有编辑功能。

## 三、打包分发范围核实

- **专家市场 252 条人设**（含系统提示词、头像）：`crates/aionui-app/assets/marketplace-personas` 通过 `include_dir!` 在**编译期**打进 `aioncore` 二进制（`aionui-assistant/src/marketplace.rs`），任何全新装机用户开箱即有完整目录，不需要额外打包步骤。
- **应用自带的内置 MCP**（`one-export-pdf`/`one-image-generation`/`one-web-tools`）：随 `electron-builder.yml` 的 `asarUnpack` 一起打进安装包。
- **`chrome-devtools`**：查到 [`runBackendMigrations.ts`](../../packages/desktop/src/process/utils/runBackendMigrations.ts) 的 `buildDefaultMcpServers()` 早就把它做成"每个用户首次启动自动种下的默认配置"（`npx -y chrome-devtools-mcp@latest`，`builtin: true`，默认 disabled 待用户手动开）——因为它是公开 npm 包不需要密钥。
- **用户自己连接的其余 MCP**（`ftshare`/`stock-sdk`/`codegraph`）：不会随包分发，是个人账号配置。

## 四、ftshare / stock-sdk 加入默认分发列表（1oneUI，未提交）

用户澄清这两个是股票专家查股票用的，且确认没存密钥。真机 CDP 直连渲染进程查 `GET /api/mcp/servers` 核实：

- `stock-sdk`：`{ command: "npx", args: ["-y", "stock-sdk-mcp"] }`，`env` 为空——和已经内置的 `chrome-devtools` 是同一形态（公开 npm 包，零环境变量）。
- `ftshare`：`{ type: "http", url: "https://market.ft.tech/gateway/mcp" }`，无 `headers`——纯网关地址，同样没有需要脱敏的内容。

在 `buildDefaultMcpServers()` 里照抄 `chrome-devtools` 的写法各加一条 `builtin: true` 的默认种子配置（默认 `enabled: false`，用户自己开），新增两个常量 `BUILTIN_FTSHARE_NAME`/`BUILTIN_STOCK_SDK_NAME`。`bunx tsc --noEmit` 通过。**⚠️ 唯一无法从代码判断的点**：`market.ft.tech`/`stock-sdk-mcp` 这两个第三方服务端有没有对匿名/免费调用限流或使用条款——这个只有用户自己清楚，代码层面判断不了。

## 五、ftshare 工具名不合法 bug 深挖 + 单工具级过滤修复（aionrs，已提交推送）

### 现状核实（不是"已经修好"，是防线生效掩盖了）

用户说"这个 bug 好像已经解决了"。真机 CDP 核实 ftshare 当前持久化的 172 个工具里，`ft_goodwill_market_overview` 的 `properties` 仍然是 `{ "（无业务参数）": {...} }`——上游（`market.ft.tech`）这个 schema bug 本身**没有修**，用户感知不到 400 崩溃，是因为 07-27 那轮加的防线（`aionui-common/tool_schema.rs` + 1oneCore `load_user_mcp_servers`）在起作用。

### 架构挖掘：两条运行路径行为不同

查 `aionui-ai-agent` 发现 1oneCore 里有两条完全独立的会话执行路径，行为不一样：

- **ACP 路径**（`factory/acp.rs`，Claude Code / Codex CLI）：MCP 工具发现发生在 CLI 子进程内部，1oneCore 只能传"要不要把这个 server 的配置发给它"，管不到单个工具——所以 `load_user_mcp_servers` 现在的逻辑是"这个 server 有任何一个工具不合法 → 整个 server 都不注入这次会话"（`factory/acp.rs:500-520` 注释原话："we cannot drop the single bad tool — the agent collects tools from the server itself"）。这条路径的架构限制是真的，本轮没有改。
- **aionrs 路径**（`factory/aionrs.rs` → aionrs 自己的 `aion-mcp` crate）：`load_user_mcp_servers`（1oneCore 这一侧）完全没有任何 schema 校验，直接把 server 配置转发给 aionrs；但 aionrs **自己拥有** MCP 工具发现和拼装逻辑（`aion-mcp/src/manager.rs` 自己发 `tools/list`，`aion-mcp/src/tool_proxy.rs` 自己把工具注册进请求会用到的工具表）——这是 fork 自己的代码，可以改，而且改了是安全的（不像 ACP 那样是黑盒子进程）。

### 修复（aionrs 仓库，`347348f`，已推送 `gaogg521/aionrs` master）

`aion-mcp/src/tool_proxy.rs` 新增 `has_valid_property_keys()`（同 `aionui-common/tool_schema.rs` 一样的 `^[a-zA-Z0-9_.-]{1,64}$` 规则，递归 `properties`/`items`/`anyOf`/`oneOf`/`allOf`/`$defs`/`definitions`），`register_mcp_tools`/`register_single_server_tools` 遇到不合规的工具改成**只跳过那一个工具**（`tracing::warn!` 记录），同一个 server 上其余工具照常注册可用——不再是"一颗老鼠屎坏一锅粥"式的整 server 排除。新增 `McpManager::new_for_test_with_tools` 测试专用构造器（区别于原有 `new_for_test` 恒空工具列表）。9 条新增单测（含"172 个工具只丢 1 个、其余照常注册"的集成用例）+ 全部既有 57 条 aion-mcp 测试 + 540 条 aion-skills 测试全绿，`cargo fmt`/`cargo clippy -D warnings` 干净。

**范围边界（刻意没做的）**：ACP 路径的整 server 排除逻辑本轮没动——那是真实架构限制，不是本轮能力所及；`ft_goodwill_market_overview` 这一个工具本身依然不可用（它的远端 schema 本来就没法通过我们这边的代码修，得 `market.ft.tech` 自己改），但同一 server 剩下的 171 个工具（含股票专家实际在用的）不再被连坐。

### 已重编 + 已换入本机开发环境

1oneCore `Cargo.lock` 更新指向 aionrs 新 commit（`cargo update -p aion-mcp`）→ `cargo build --release -p aionui-app`（约 4 分钟）→ 新 `aioncore.exe` 覆盖进 `1oneUI/resources/bundled-aioncore/win32-x64/aioncore.exe`。覆盖时发现本机开发环境（`aioncore.exe`/`electron.exe`）已经不在跑了（用户自己关掉的，与本轮操作无关），未打断任何正在进行的会话。**用户需要自己重新启动开发环境才能加载到新二进制，本轮未做真机复测**（真机验证留给用户自己用股票专家跑一次 ftshare）。

## 验证

- aionrs：`cargo test -p aion-mcp`（57 全绿，含 9 条新增）+ `cargo test -p aion-skills`（540 全绿，确认下游未受影响）+ `cargo clippy -p aion-mcp -- -D warnings`（干净）+ `cargo fmt --all -- --check`（干净）。
- 1oneUI：`bunx tsc --noEmit` 通过（`runBackendMigrations.ts` 改动部分）。
- 真机 CDP 直连开发环境渲染进程（`ws://127.0.0.1:9230`）核实 `GET /api/mcp/servers` 返回的真实 `transport`/`tools` 字段，用于核实 ftshare/stock-sdk 无密钥、ftshare 那个坏工具当前仍未修。
- **未做**：新 `aioncore.exe` 换入后的真机复测（开发环境本轮结束前已不在跑）；ftshare/stock-sdk 加入默认列表这条改动本身没有真机验证（只做了 `tsc` 类型检查）。
