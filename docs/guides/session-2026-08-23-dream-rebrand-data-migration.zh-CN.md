# Dream 品牌独立化：技术身份收尾与持久化数据迁移

**日期**：2026-08-23 · **范围**：dream-ui + dream-core（跨仓），dream-engine 无代码改动

> 本文档记录的是**整个 AionUi/AionCore/aionrs → One Work / dream 独立品牌改造**里
> **最后一个阶段**（技术身份重命名之后的持久化数据收尾）。如果你需要了解更早期"三仓
> 从哪里来、为什么独立成新仓库、命名规范怎么定的"这些决策背景，先读
> `D:\aionui-m0\DREAM-PLATFORM-DIRECTION.md`（v1.1 决策基线，仍留在旧工作目录里，
> 三个新仓库都没有它的副本）。本文档假定读者已经知道：产品展示名是 **One Work**
> （首字母大写、中间有空格），技术/协议前缀是小写 **`dream`**，三仓分别是
> `dream-ui`（原 1oneUI）/`dream-core`（原 1oneCore）/`dream-engine`（原 aionrs-local）。

## 一、这一阶段解决的问题

早期阶段（不在本文档记录范围内）已经完成了 crate/package 改名、二进制改名、环境变量
批量改名、注释清理。但改名过程中留下一个结构性风险没有处理：**Rust 枚举变体改名会
连带改变它的 serde 序列化值**，而这些值有相当一部分**已经作为字符串写进了 SQLite
数据库**（`conversations.type`、`agent_metadata.agent_type`、`assistant_sessions.agent_type`
等列）、写进了种子数据（`assistants.json` 里 22 个官方助手的 `agent_ref`）、或者被
写死进测试固件和跨仓协议约定（内部 HTTP 头名）。

如果只是简单地把 Rust 里的 `AgentType::Aionrs` 改名成 `AgentType::DreamEngine` 而不做
额外处理，`#[serde(rename_all = "snake_case")]` 这类宏会**自动**把序列化值从
`"aionrs"` 改成 `"dream_engine"` 或类似值——这会让所有已经写着旧值的历史数据库行
在下次读取时匹配不上任何已知枚举分支，一次"看起来只是改了个 Rust 标识符名字"的重构
就能让老用户存量数据全部失效。

这一阶段的核心工作就是：**在完成 wire-value 改名的同时，让历史数据和跨版本/跨仓协议
仍然可用**，并在过程中用"跑全量测试、修复红的、再跑一次"的方式把所有因为改名产生的
真实回归找出来。

## 二、wire-value 迁移的处理模式

### 2.1 Rust 枚举：`rename` + `alias`

对 `dream-core-common::enums::AgentType`、`ConversationSource`、`McpSource` 这几个
序列化值会被持久化的枚举，改名统一用：

```rust
#[serde(rename = "dream", alias = "aionrs")]
DreamEngine,
```

- `rename = "dream"`：新写入的数据统一用规范值 `"dream"`。
- `alias = "aionrs"`：反序列化时同时接受历史值 `"aionrs"`，老数据不需要迁移也能正常
  读出来。

`ConversationSource::DreamUi` 同理，`rename = "dream", alias = "aionui"`；
`McpSource::DreamEngine`/`McpSource::DreamUi` 同理。

### 2.2 冻结哈希派生 ID

`AgentType::id()` 原本是动态计算的：`fnv1a_hex8(self.serde_name().as_bytes())`。
`serde_name()` 从 `"aionrs"` 改成 `"dream"` 之后，这个哈希值会跟着变——但种子 SQL
和十几个测试文件里已经把旧哈希值 `"632f31d2"` 当成**稳定不变的 ID** 写死使用了。
处理方式是在 `id()` 里对 `DreamEngine` 分支单独硬编码冻结旧值，不再跟随
`serde_name()` 变化：

```rust
pub fn id(&self) -> String {
    if matches!(self, AgentType::DreamEngine) {
        return "632f31d2".to_owned(); // 历史哈希值冻结，不随改名变化
    }
    // 其余分支照常动态计算
}
```

### 2.3 新增正向迁移，绝不改历史迁移文件

已发布的迁移文件（`dream-core-db/migrations/001~051`、
`dream-domain-employee/migrations/001~004`）**历史内容不能动**——sqlx 用文件内容的
哈希做 `_sqlx_migrations` 校验，改动历史文件会让所有存量安装升级时报"迁移已应用但
内容被修改"直接崩溃。正确做法是新增下一个编号的正向迁移，把已有数据的旧值 UPDATE
成新值：

- `dream-core-db/migrations/052_dream_rebrand_persisted_values.sql`：
  `conversations.type`/`conversations.source`/`agent_metadata.agent_type`/
  `assistant_sessions.agent_type` 四处 `aionrs`/`aionui` → `dream`。
- `dream-domain-employee/migrations/005_dream_rebrand_agent_type.sql`：
  `one_personal_agents.agent_type` 同样迁移。

⚠️ **写这两个迁移之前踩过一次坑**：最初以为 `assistants.preset_agent_type`、
`assistant_overrides.preset_agent_type`、`cron_jobs.agent_type` 三个字段也需要迁移，
但只看了 `migration 001` 就下结论——实际上 `migration 013` 早就把这几张表重建过，
这些列已经被折进 JSON blob 里不再独立存在。按这个错误假设写的 UPDATE 语句在跑测试
时报 `no such column`，级联炸出 `dream-core-ai-agent` 74 个测试失败。**教训：一张表
某个字段的完整生命周期必须顺着所有迁移文件的 `RENAME TO`/表重建逐条追，只读最早的
建表语句是不可靠的。**

Electron 桌面端还有一套**完全独立、跟 dream-core-db 不共享同一份迁移历史**的本地
SQLite 迁移系统（`packages/desktop/src/process/services/database/migrations.ts`），
同样的规则也适用——已发布的 `migration_v21`（历史上把 `'aionrs'` 加进
`conversations.type` 的 CHECK 约束）文件内容不能动，新增
`migration_v27` 做同样的 `UPDATE conversations SET type='dream' WHERE type='aionrs'`
/`source` 迁移（好在 `migration_v22` 已经把 CHECK 约束整个去掉了，不需要重建表，
一条 `UPDATE` 语句就够）。

### 2.4 前端类型改名：用 tsc 报错反查所有需要联动的比较点

`dream-ui` 里凡是 canonical 的联合类型（`AgentType`、`TChatConversation` 的
discriminant 字面量、`ConversationSource`）改名后，`tsc --noEmit` 会精确报出所有
跟严格类型比较的 `TS2367 (no overlap)` 错误——这是发现所有需要联动修改点位最快的
方式，比人工 grep 全代码库可靠。但**松散 `string` 类型的比较**（比如
`backend === 'aionrs'`，`backend` 参数类型就是普通 `string`）tsc 不会报错，必须
额外做 `grep "=== 'aionrs'"` 全仓扫描补充，两种方式缺一个都会漏掉真实的比较点。

## 三、过程中发现并修复的真实生产 bug

以下几条**不是**"测试用例写死了旧值"这种表面问题，是改名本身引入或暴露的、会实际
影响运行时行为的回归：

### 3.1 `AgentErrorOwnership` 前端三处未同步，错误归因分类彻底失效

`dream-core-api-types::agent_error::AgentErrorOwnership` 早期批量重命名时枚举变体
从 `Aionui` 改成了 `Dream`，配合 `#[serde(rename_all = "snake_case")]` 宏，线上实际
序列化值已经是 `"dream"`。但前端三处仍然停在旧值 `"aionui"`：

- `common/chat/chatLib.ts` 的 `AgentErrorOwnership` 类型定义和
  `AGENT_ERROR_OWNERSHIPS` 校验集合
- 13 个语言的 i18n key `conversation.agentError.ownership.aionui`
- `pages/conversation/Messages/hooks.ts`、
  `pages/conversation/platforms/acp/buildSendFailureError.ts` 里构造错误对象时
  仍然写死 `ownership: 'aionui'`

后果：后端返回的错误对象 `ownership` 字段值是 `"dream"`，前端校验集合里没有这个值，
`MessageTips.tsx` 的归因展示（"这是我方 bug / 用户 Agent 配置问题 / 用户模型账号
问题"）全部退化成"未知上游"，用户完全看不出错误到底该找谁负责。

### 3.2 内部 HTTP 头 `x-aionui-forwarded-origin`/`x-aionui-client-ip` 两仓不同步

`dream-ui` 的 WebUI 反代层（`packages/web-host/src/static-server.ts`）和 `dream-core`
的鉴权中间件（`crates/dream-core-auth/src/middleware.rs`）各自定义了同名的两个内部
专用 HTTP 头常量，前者在转发请求时打上，后者读取用来判断"这个请求是不是经过 WebUI
反代"以及"真实客户端 IP 是多少"（用于企业版 IP allowlist 之类的功能）。

`dream-ui` 侧的测试文件已经改成期望新值 `x-dream-*`，但两侧生产代码都还是旧值
`x-aionui-*`——这是一次"只改了一半"的历史遗留，被这次全量测试驱动的排查揪出来。
**这类跨仓协议改名必须两侧同步改，只改一边不会报任何编译或运行时错误，只是功能
在运行时悄悄失效**（WebUI 来源识别永远判定失败、真实客户端 IP 永远拿不到）。

两侧常量值：`WEBUI_PROXY_HEADER`/`CLIENT_IP_HEADER`，均改为
`x-dream-forwarded-origin`/`x-dream-client-ip`。

### 3.3 会话分叉功能对 dream 会话 100% 报错（影响面最大的一个）

`dream-core-conversation::service.rs` 里 `aionrs_capability_agent_id()` 函数，在
会话没有显式绑定 `assistant_snapshot` 时的兜底逻辑，硬编码调用
`self.resolve_assistant_agent_binding(user_id, "aionrs")` 去查找内置 dream agent
的 `agent_id`。这个函数底层是 `dream-core-db::agent_binding::resolve_agent_binding_from_rows`——
一个**严格字符串匹配**（`row.agent_type == value`，不做任何别名归一化）的函数。

数据库里 `agent_metadata.agent_type` 字段值早已经是 `"dream"`（迁移 052 已经改过），
传入字面量 `"aionrs"` 永远查不到匹配行，返回空 `agent_id`，导致
`fork_capability_for_agent` 拿着空 `agent_id` 查能力表得到 `None`，最终报错
`FORK_UNSUPPORTED: this agent does not support session forking`。

**影响范围**：任何没有走"选择助手"UI 流程、没有显式助手快照的 dream 类型会话（比如
渠道/cron/API 直接创建的会话）尝试分叉时**必现失败**，即便它本应该支持分叉。这条
bug `cargo check`/`tsc` 完全测不出来（纯运行时字符串比较），是 `cargo test --workspace`
里 `dream-core-conversation/tests/conversation_extended.rs` 的 fork 相关集成测试
才暴露出来的。

修复：把硬编码的 `"aionrs"` 改成 `"dream"`。

### 3.4 CI / 打包脚本的环境变量名滞后于代码

代码里这些环境变量早就改名成 `DREAM_*`：`DREAM_MULTI_INSTANCE`、
`DREAM_EXTENSIONS_PATH`、`DREAM_DEBUG_AUTO_UPDATE_CURRENT_VERSION`、
`DREAM_BACKEND_LOCAL_BINARY`、`DREAM_BACKEND_LOCAL_BUNDLE_DIR`、`DREAM_ALLOW_REMOTE`、
`DREAM_HUB_TAG`、`DREAM_BACKEND_RUN_ID`、`DREAM_BACKEND_ARCH`、`DREAM_BACKEND_VERSION`、
`DREAM_OPEN_BROWSER`。但下面这些文件设置这些变量时用的还是旧名字 `AIONUI_*`，代码
根本读不到，功能悄悄回落到默认值（多开模式失效、e2e 测试用的 extensions 路径失效
等，都不会报错）：

`package.json`（`start:multi` 脚本）、`.github/workflows/_build-reusable.yml`、
`.github/workflows/pr-e2e-artifacts.yml`、`docker-compose.yml`、
`scripts/build-fast-debug-versions.ps1`、`scripts/build-fast-debug-worktrees.ps1`、
`scripts/dev-bootstrap.mjs`、`scripts/packaged-launch.mjs`、`scripts/install-ubuntu.sh`
（这个是 Linux 安装脚本自己内部用的变量名，改成 `DREAM_VERSION`/`DREAM_WORKDIR`/
`DREAM_MODE` 是为了品牌一致性，不是修复真实 bug，因为它是脚本自己设置自己读取，
原本就没有不一致）。

### 3.5 `bun install` 从来没坏，坏的是一个陈旧的内部符号链接

上一轮会话把 `bun install` 判断成"卡死"，其实完整跑一遍只要约 200 秒（装 893 个包）。
真正的问题是：**上一次不完整/中断的安装**在 `node_modules/.bun` 缓存目录里留下了
一个陈旧符号链接——`@codemirror+language@6.12.3` 包内部指向 `@codemirror/state`
的链接还停在旧版本 **6.6.0**，而其余所有相关包（`@uiw/codemirror-extensions-basic-setup`、
`@codemirror/search`、`@codemirror/view`、`@codemirror/commands` 等）的同名链接
都已经指向新版本 **6.7.1**。

CodeMirror 6 的 `Facet`/`Extension` 系统靠**对象引用身份**识别扩展项是否合法，两个
不同版本构造出来的 Facet 互不认识，于是 `EditorState.create()` 内部
`Configuration.resolve()` 抛出 `Unrecognized extension value in extension set`，
代码预览（`CodeEditor.tsx`）、Markdown 预览、HTML 预览三个编辑器组件全部在渲染时
崩溃（对应 21 个 vitest 用例失败）。

排查过程：先怀疑"依赖树里同时存在两个版本"（这类问题的常见病因），但检查发现所有
`@codemirror/state` 符号链接最终都指向同一个物理目录（`.bun/@codemirror+state@6.7.1`）
——说明不是"依赖树分裂"，而是 bun 增量安装时，`@codemirror+language@6.12.3` 这个
包本身版本号没变，bun 认为不需要重新计算它*内部*依赖的符号链接，于是链接还停留在
上一次 lockfile 状态。

修复：`rm -rf node_modules && bun install` 全新安装（保证所有内部符号链接一次性
重新计算，不留历史残留）。验证：4 个受影响的测试文件全部转绿，随后全量
`bun run vitest run` 546 个测试文件 / 5059 个测试用例 100% 通过。

## 四、验证记录

- **前端**：`bun run vitest run` 全量 546 文件 / 5059 用例，0 失败（含 3.5 节
  CodeMirror 根因修复后的验证）。
- **后端**：`cargo test --workspace` 反复迭代约 10 余轮才收敛为 0 失败——workspace
  下有几十个 crate、上百个测试二进制，`cargo test` 默认 `--fail-fast` 每轮只暴露
  下一个未被触及的 crate 里的问题，必须完整跑完（用 `--no-fail-fast` 或换用下面的
  `cargo-nextest`）才能真正确认全绿。过程中安装了 `cargo-nextest`
  （`cargo install cargo-nextest --locked`），全量 9543 条测试跑一遍比
  `cargo test --workspace` 快出一个数量级，之后的全量验证都建议优先用
  `cargo nextest run --workspace --no-fail-fast`。

## 五、关键决策记录（后续改动前必看，不要被误当成 bug 改掉）

- **运行时身份不变**：`appId`（`com.huanle.oneone.ai`）、`executableName`
  （`1onecode`）、深链协议 scheme（`aionui://`）、`PROD_USERDATA_APP_NAME`
  （内部锁定的历史值）全部刻意保持不变——这是独立于本次数据迁移之外的一条更早的
  决策，改这几项会导致老用户 `%APPDATA%` 数据和 `userData` 目录失联。
- **产品展示名是 "One Work"**（首字母大写、中间有空格），代码里
  `common/platform/index.ts::BRAND_DISPLAY_NAME` 与 `electron-builder.yml` 的
  `productName` 都是这个值，`package.json` 同步。⚠️ 这个名字在本轮工作中间被口头/
  打字反复误传成 "OneWork"、"ONE WORK" 两种变体，一度改动了配置文件又撤回——**任何
  时候要动这个值之前，先读 `BRAND_DISPLAY_NAME` 常量的实际值，不要凭记忆或转述**。
- **持久化 wire-value 改名统一走 `#[serde(rename = "新值", alias = "旧值")]`**（见
  第二节），不要为了"彻底改干净"而删掉 `alias`。
- **哈希派生的稳定 ID 改名前必须检查是否被写死进种子数据/断言**（见 2.2）。
- **`resolve_agent_binding_from_rows` 这类函数是 strict-match，不做别名归一化**——
  任何硬编码传入旧值当查找 key 的调用点，改名后会静默返回空结果而不报错，这类
  bug 只能靠完整跑一遍测试才能发现（3.3 就是这样漏网的）。

## 六、不在本轮范围内、明确未处理的事项

以下事项来自 `DREAM-PLATFORM-DIRECTION.md` 的待决清单，用户明确表示本轮不用管：

- `dream` 域名、商标、协议 scheme 的可用性核查
- 最终 Electron `appId`/可执行文件名/安装目录名称的正式定案
- `mobile/` 目录的处置（删除/独立归档/保留）
- 引擎 OAuth 的正式 client ID 与外部服务登记
