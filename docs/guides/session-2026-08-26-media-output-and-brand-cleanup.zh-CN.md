# 2026-08-26 媒体产物错位修复 + 品牌迁移收尾

> **一句话**：品牌迁移只改了 TS 一半、没改 Rust 一半，把媒体 MCP 的环境变量契约改断了；
> 这一个 bug 是「产物找不到 / 文件树空 / 只显示文件名不出预览」三个现象的共同根因。
> 跨仓：dream-ui + dream-core（dream-core 同名文档记录后端侧）。

---

## 1. 根因：跨语言 env 契约被单边改名

| 端 | 变量名 | 位置 |
| --- | --- | --- |
| Rust 发出 | `AIONUI_MEDIA_WORKSPACE_DIR` / `AIONUI_MEDIA_CONVERSATION_ID` | `dream-core-mcp/src/media_workspace.rs` |
| TS 读取 | `DREAM_MEDIA_WORKSPACE_DIR` / `DREAM_MEDIA_CONVERSATION_ID` | `builtinMcp/imageGenServer.ts` |

两边永不匹配 → `sessionWorkspaceDir()` 退回 `process.cwd()`（= app 数据目录根）。连锁后果：

1. 产物写进 `%APPDATA%\1ONE Code\1one\img-*.jpg`，不在会话工作区 → **右侧文件树看不到**
2. job 既无 `conversationId`、`workspaceDir` 也对不上 → `jobBelongsToConversation()`
   （`common/media/jobView.ts`）把它过滤掉 → **`MediaJobCard` 整个不渲染**
3. 缩略图 / 播放器 / 打开目录 / 重新生成 / 成本行随卡片一起消失

**编译期完全看不出来，也没有任何测试会红** —— 工具只是「什么都没被告知」，安静地退回兜底。
这正是两仓 CLAUDE.md「跨仓协议改名必须两侧同步」铁律的教科书案例。

**修法**：Rust 常量改成 `DREAM_MEDIA_*`；TS 端**新名优先、旧名兜底**
（`readEnv('DREAM_MEDIA_WORKSPACE_DIR', 'AIONUI_MEDIA_WORKSPACE_DIR')`）——
桌面端配的是固定版本的 `aioncore`（`package.json` 的 `aioncoreVersion`），
UI 比后端新是常态，不兜底就得等后端发版才能验证。

两侧各加了**把字面量钉死**的回归测试（`media_workspace.rs` 的
`env_names_match_the_typescript_media_server`）。

## 2. 产物落到 `工作区/outputs/`

`mediaAssets.ts` 新增 `MEDIA_OUTPUT_SUBDIR` / `mediaOutputDir()`，
`saveBase64MediaAsset` 与 `downloadUrlMediaAsset` 共用 `prepareOutputPath()`（写前 mkdir）。
抄的是 `persistReferenceInputs` 已有的 `refs/` 范式。

**两个不能动的地方**（动了就重新弄坏卡片匹配）：

- `toAsset()` 仍以 **workspace** 为基准算 `relativePath` → 结果是 `outputs/img-*.png`，正是想要的
- `mediaJob/index.ts` 的 `origin.workspaceDir` 仍是**会话工作区**，不是 outputs 子目录

**放弃的做法**：让文件树默认展开 `outputs`。`explorerStore` 的 `port.subscribe()` 是批量调用，
塞一个尚不存在的 key 会让整批 reject 并回滚（含 root），把整棵树弄坏。
`outputs/` 靠 watcher 会自己出现，代价只是点一下。

## 3. 正文里的本地图片/视频出预览

`Markdown/LocalFileLink.tsx`：路径命中 `isImagePath` / `isVideoPath` 时，
在 chip 后追加 `GeneratedMediaView`（复用现成组件，走 `one-media://`）。

- 带行号的 `foo.png:12` **不出**预览 —— 那是源码定位，不是要看图
- chip 是 inline 且渲染在 Shadow DOM 里，预览包一层 `.markdown-local-file-preview`
  （`ShadowView.tsx` 里 `display:block`），否则撑坏行内排版

**坑**：任何 partial mock 了 `@arco-design/web-react` 的 DOM 测试，只要用到图片路径的本地链接，
现在都会因为缺 `Image` 而崩。已给 `MarkdownViewer.dom.test.tsx` 补上。

## 4. 目录改名一律用「读取回退」，不搬文件

新增 `resolveWithLegacyName(parent, current, legacy)`（`process/utils/utils.ts`），
语义与后端 `data_paths::resolve_with_legacy` 一致：

> 当前名存在 → 用当前名；否则老名存在 → 用老名；都不存在（新装）→ 用当前名。两者都在时当前名优先。

覆盖 `initStorage.ts` 的四个存储文件 + 聊天历史目录：

| 新名 | 老名（只读兜底） |
| --- | --- |
| `one-config.txt` / `one-chat-message.txt` / `one-chat.txt` / `.one-env` | `aionui-*` / `.aionui-env` |
| `one-chat-history/` | `aionui-chat-history/` |

**为什么不做 rename 迁移**：这些文件就是用户数据（自定义 cache/work/log 目录、provider 配置、
会话索引）。指向一个磁盘上不存在的名字**不会报错** —— JSON store 直接当空的、写个新文件，
用户看到的是设置和历史「凭空消失」。

`importOneLegacyDb.ts` 的 `backendDbPath` 也改成同样解析 —— 否则新装机会去探测
`one-backend.db` 而后端在用 `aionui-backend.db`，判断成「还没有后端库」，导入到早已没人读的
遗留库里去。

**`aionui.db` 刻意不改名**：它是只读的历史遗留库，没有任何代码创建它，改名反而弄坏读它的迁移。

## 5. 顺带修掉的真 bug

- `sentry.ts` 的 `getInstallPathKind()` 只认 `\programs\aionui\resources`，
  但实际安装目录是 `executableName` 派生的 `1onecode` → **所有 Windows 装机都误报 `custom`**，
  正好把这个 tag 存在的意义抹掉了。现在两个名字都认。
- `x-aionui-internal` 是跨仓协议头（dream-ui 发、dream-core-cron 收）。
  改成后端认 `x-dream-internal` 与旧名两个、前端两个都发 —— 只改一边会让休眠唤醒后的
  cron 静默 403，界面上没有任何提示。

## 6. 刻意未改（有理由，别「顺手」改掉）

| 项 | 理由 |
| --- | --- |
| `aionui://` 深链、`appId`、`1ONE Code` userData 目录 | CLAUDE.md 列为冻结历史值 |
| Sentry tag 命名空间 `aionui.*` | 改了会断历史报表/告警 |
| localStorage 键、DOM 事件名 | 前者改了会重置用户偏好，后者纯内部约定，本次不在范围 |
| `[[AION_FILES]]` marker 值 | 活的跨进程协议，值本身不含品牌 |
| `_aionui_` 时间戳分隔符 | 两仓都只声明未使用，死常量 |

## 7. 验证

```bash
cd D:/dream/dream-ui && npx tsc --noEmit -p tsconfig.json   # 0 错误
npx vitest run tests/unit/media tests/unit/renderer tests/unit/process
```

端到端（**必须真机点**，单测覆盖不到）：

1. 对话里让助手生成一张图 → 文件应在 `<会话工作区>/outputs/img-*.jpg`，
   **不再**出现在 `%APPDATA%\1ONE Code\1one\` 根部
2. 右侧文件树自动出现 `outputs/`（watcher 驱动，免刷新）
3. 消息流里出现 `MediaJobCard`：缩略图 / 打开目录 / 重新生成 / 成本行齐全
4. 视频走一遍
5. 正文里直接写一个本地图片路径（不走生成工具）→ chip 下方出缩略图，点击可放大

**改了后端就必须重编**：Rust 侧的 `DREAM_MEDIA_*` 改名要等新 `aioncore` 发版 +
抬 `aioncoreVersion` 才生效；在那之前靠 TS 的旧名兜底工作。

## 8. 已知问题（既有，非本次引入）

- `npx oxlint` 跑不起来：配置里引用了不存在的规则 `no-await-thenable`
- dream-core 在 HEAD 时不是 fmt-clean，`cargo fmt --all` 会连带重排大量无关文件；
  本次把格式化拆成了独立提交

---

## 9. 第二轮：剩余品牌残留清理（同日追加）

第一轮刻意跳过的那批，按「持久化与否」分两类处理完了。

### 安全直改（纯内部约定，从不持久化、两端都在仓库内）

| 类别 | 旧 → 新 |
| --- | --- |
| window CustomEvent 名 ×10 | `aionui-workspace-*` / `aionui-chat-*` / `aionui-update-*` / `aionui-open-*` / `aionui:speech-to-text-config-changed` → `one-*` / `one:*` |
| AudioWorklet processor | `aionui-pcm-capture` → `one-pcm-capture` |
| CDP 内部协议 | WS 路径 `/aionui-cdp` → `/one-cdp`；`aionui-browser-{target,session,context}` → `one-browser-*` |
| preload E2E 全局 | `__aionuiE2ETest` → `__oneE2ETest` |

### 持久化 → 一律做兼容，不做破坏性改名

**localStorage 键**（11 个）：新增 `renderer/utils/storage/legacyStorageKeys.ts`，
在 `main.tsx` 最开头跑一次 `migrateLegacyLocalStorageKeys()`——**拷贝而非移动**，
老键留在原地，降级回旧版本仍能读到。

> `__aionui_theme` 是例外：`index.html` 的内联脚本在任何模块加载前就要读它（防闪白），
> JS 迁移来不及，所以那两处直接写成 `getItem('__one_theme') || getItem('__aionui_theme')`。

**`aionui.dir` env 键**：读时 `getSync('one.dir') ?? getSync('aionui.dir')`，
写时**两个键都写**，降级不丢用户自定义的 cache/work/log 目录。

**内置浏览器 MCP 名** `aionui-browser` → `one-browser`：新增
`BUILTIN_BROWSER_MCP_LEGACY_NAMES`。这里**必须**做兼容——「是否已注册」是按名字判断的
（`runBackendMigrations.ts` 的 `existing.find(...)`），只认新名会给存量安装**再插一条**，
变成两个都启用的浏览器 MCP 驱动同一个内嵌浏览器。命中老名时顺便把 `name` 一起 update 改写前进，
否则渲染层那个「Agent 正在操作浏览器」的角标（按当前名匹配工具调用流）永远不亮。

**headless 数据目录** `~/.aionui-server` → `~/.one-server`：同样是「新名不存在且老名存在就用老名」。

### 这一轮仍然不动（有硬理由）

| 项 | 理由 |
| --- | --- |
| `aionui-assistant` | 是**已发布 SQL 迁移**里的 `source_ref`（`018_reset_builtin_assistant_enabled.sql`），迁移文件不可改 |
| `persist:aionui-browser` session partition | 改了内嵌浏览器的 cookie / 登录态全丢 |
| `aionui.*` Sentry tag 命名空间 | 改了断历史报表与告警 |
| `migrations.ts` 里的 `'aionui'` source 值 | 是 schema 历史，已发布的迁移不可改 |
| `aionui://` 深链、`appId`、`1ONE Code` 目录 | CLAUDE.md 冻结值 |

### 验证

`tsc` 0 错误；`npx vitest run` **544 文件 / 5059 测试全绿，0 失败**。
dream-engine 全仓扫描无任何 `aionui` 残留。

---

## 10. 第三轮：`aionui://` → `dream://`，浏览器 partition

### 深链 scheme：**后端必须先放行**

`aionui://` 能改，但有个致命前置：dream-core 的 `sanitize_deep_link_scheme`
（`dream-domain-sso/src/routes.rs`）对**任何不认识的值都 fallback 回 `"aionui"`**。
桌面端配的是固定版本 aioncore，所以如果 UI 单方面改成只发/只认 `dream://`：

> 用户在浏览器里登录成功 → 后端回调页拿 `aionui://sso-callback` → UI 不认 → 静默丢弃 →
> **SSO 登录直接坏掉，且界面上没有任何报错**。

正确顺序（本次已按此执行）：

1. **dream-core 先放行**：`sanitize_deep_link_scheme` 增加 `dream` / `dream-dev`，
   保留 `aionui` / `aionui-dev`；**默认 fallback 仍是 `aionui`** —— 不发 `scheme` 参数的
   是老客户端，它只向 OS 注册过 `aionui://`。
2. **UI 两个都注册、两个都认**：
   - `PROTOCOL_SCHEME = 'dream' / 'dream-dev'`（唯一对外发出的值）
   - 新增 `LEGACY_PROTOCOL_SCHEMES` / `ACCEPTED_PROTOCOL_SCHEMES` / `isDeepLinkUrl()`
   - `parseDeepLinkUrl` 由严格单值比较改为 `ACCEPTED_PROTOCOL_SCHEMES.includes(...)`
   - `index.ts` 的 argv 匹配（两处）与 `setAsDefaultProtocolClient` 改为遍历全部 accepted scheme
   - `electron-builder.yml` 的 `protocols.schemes` 两个都列

⚠️ 这意味着**后端不发版的话，新 UI 走的仍是 `aionui://` 回调路径**（后端 fallback），
但因为两个都注册、两个都认，功能是好的。发版后自动切到 `dream://`。

### 浏览器 session partition

`persist:aionui-browser` → `persist:one-browser`，但**不是无条件改名**。
partition 就是内嵌浏览器的 cookie 和登录态（Electron 存在
`userData/Partitions/<name>`），直接改名不会报错，只会开一个空 profile —— 用户替 Agent
过的所有登录全部消失，且没有任何提示。

新增 `process/utils/browserPartition.ts` 的 `resolveBrowserPartition()`：
**老 partition 目录存在就继续用老的，只有新装才拿新名**。进程内只解析一次（值中途变会把
浏览器状态劈成两个 profile）。渲染进程通过 preload 的 `__browserPartition` 拿解析结果，
主进程 `applicationBridge` 也走同一个函数。

### 这两个确认「新用户不受影响」，因此无需处理

- **`migrations.ts` 里的 `'aionui'`**：`runLegacyDatabaseMigrations` 在
  `aionui.db` 不存在时直接 early return。新装机**从来不会执行**这些迁移，那些字符串是
  纯历史 schema。而且已发布的迁移内容改了会破坏校验和。
- **`aionui-assistant`**：是 dream-core 已发布 SQL 迁移
  （`018_reset_builtin_assistant_enabled.sql`）里的 `source_ref`。与上一条不同的是，
  新装机**会**跑这些迁移，所以新用户库里确实带这个值 —— 但改它需要「改 manifest + 新增一条
  正向迁移改写存量行」，属于独立变更，本次未做。

### 验证

`tsc` 0 错误；`npx vitest run` **545 文件 / 5066 测试全绿**。
新增 `tests/unit/process/deepLinkSchemes.test.ts` 钉住「新旧 scheme 都认、其它一律拒绝」。
`cargo test -p dream-domain-sso` 68 passed。

---

## 11. 第四轮：内置管家与技能改名（迁移 053）

这是最后一块「新用户也会看到」的上游品牌。与 `migrations.ts`（Electron 侧遗留库，
新装机根本不执行）不同，**dream-core 的迁移在新库上是全跑的**，所以不改的话
全新用户依然会拿到 `aionui-assistant`，工作区文件树里依然是 `.dream/skills/aionui-config`。

### 涉及 5 个标识符

`aionui-assistant` → `one-assistant`，以及四个技能
`aionui-config` / `aionui-troubleshooting` / `aionui-webui-public` / `aionui-webui-setup`
→ `one-*`。

改动面：1 个头像 + 3 个 rule markdown + 4 个技能目录 + 1 个 references 文档全部改名；
`assistants.json` 的 `id` / `avatar` / `rule_file` / 两处技能列表；技能 markdown 里的互相引用。

### 运行时环境变量同批改掉

`AIONUI_{USER_ID,CONVERSATION_ID,HELPER_BIN,BASE_URL,RUNTIME_TOKEN}` → `ONE_*`
（定义在 `dream-core-ai-agent/src/types.rs`）。

**新旧两套都注入**：内置技能和 helper CLI 跟后端同一个二进制发布、不存在版本偏移，
但**技能是用户可自己写的** —— 谁的自定义技能里写了 `$AIONUI_BASE_URL`，只发新名会让
那条命令收到空字符串，坏了还没地方看。

`CONVERSATION_RUNTIME_ENV_NAMES` 列全 10 个名字，重新 apply 时两套一起清，
漏一个会把上一个会话的 id 泄漏到下一个。

### 迁移 053 覆盖的列

| 表 | 列 |
| --- | --- |
| `assistant_definitions` | `assistant_id`、`source_ref`、`rule_resource_ref`、`avatar_value`、`default_skill_ids`、`default_disabled_builtin_skill_ids`、`custom_skill_names` |
| `assistant_overrides` | `assistant_id`（它的主键就是 assistant id） |
| `cron_jobs` | `agent_config` JSON 的 `$.assistant_id` |
| `skills` | 四行 builtin 的 `name` |

**`source_ref` 是最要命的一列**：它是清单的身份列（与 `source` 组成唯一索引），而清单每次
启动都按**新** id 重新播种。漏改的行不会匹配上，会被**再播种一遍** —— 用户会看到两个管家。

JSON 列是 TEXT，替换针对**带引号的 token**（`"aionui-config"` 而不是裸名），
否则 `aionui-config-extra` 这种更长的 id 会被误伤。测试里专门钉了这一条。

`skills` 用 `UPDATE OR IGNORE ... SET name` 而不是删除重建，保住用户的单技能开关；
`path` 仍指向旧目录，由启动时的 builtin 技能同步按 name 修正。

### 测试姿势的坑

新增 `crates/dream-core-db/tests/builtin_assistant_rebrand_migration.rs`（5 个用例）。
两个踩过的坑：

1. **手搓 `Migrator` 跑全链路会挂在 042**（`no such table: _assistant_definitions_old`）。
   改用项目标准的 `init_database_memory()`。
2. 但 `init_database_memory()` 已经跑过 053，sqlx 的版本账本会让 `Migrator` **跳过**它 ——
   种下的旧行原封不动，5 个断言全部「假通过」。所以测试改成
   **直接 `include_str!` 迁移文件并执行 SQL**，测的才是真语句。

### 前端

`useTalkToButler.ts` 的 `BUTLER_ASSISTANT_ID` 改为 `one-assistant`，
但**新旧 id 都匹配** —— 桌面端配的是固定版本 aioncore，比后端新是常态，
只认新 id 会让「找管家」在没升级后端的装机上静默返回空。

### 仍未改

`AIONUI_LOG_DIR` / `AIONUI_FONTS_DIR` / `AIONUI_CHANNEL_SEND`：全仓扫过，
**没有任何代码设置或解析它们**（只出现在技能文本和一个 bundled JS 里）。
改了只有「仓外某处在用」的风险、没有收益，留着。

---

## 12. 第五轮：`AIONUI_*` 环境变量家族彻底改名

### 先确认了一件事：这批**不是**跨仓契约

一开始以为 dream-ui 拉起后端时会设 `AIONUI_{CACHE,WORK,LOG}_DIR`（`index.ts` 里有句注释这么提）。
实际查下来 **dream-ui 一个都没设** —— 它用的是 `DREAM_BACKEND_*`；`AIONUI_WORK_DIR` 是后端
`bootstrap/environment.rs` **自己设给自己子进程**的。所以这批是后端内部 + 运维可设的 CLI 变量，
可以彻底改。

### 做法：一次性采纳，而不是 50 个回退

`AIONUI_*` → `ONE_*` 共 38 个变量。没有在每个读取点写回退（其中一半是 clap 的
`#[arg(env = "...")]`，只接受一个名字），而是在 `main()` / `admin.rs` 最开头调用
`dream_core_common::adopt_legacy_env()`：

> 遍历 `ADOPTED_ENV_SUFFIXES`，凡 `ONE_X` 未设而 `AIONUI_X` 有值就拷过去。新名永远优先。

必须在 clap 解析前、runtime 起来前调用（`set_var` 在多线程下是 unsound 的，函数标了 `unsafe`
并在文档里写明了这个契约）。运维那边设了老名字的启动脚本继续生效，读取点全部只认新名。

改动量：272 处带引号的 env 名、88 处散文/标识符、12 处技能资源、11 个文件的常量改名
（`AIONUI_FILES_MARKER` → `ONE_FILES_MARKER` 等，**只改标识符，wire 值 `[[AION_FILES]]` 不动**）。
`cmd_capabilities.rs` 对外声明的也换成新名。

### 差点引入的安全回归

`registry.rs::is_blocked_override_env_key` 是道护栏：禁止用户自定义的 env override 覆盖内部变量，
判断依据是 `AIONUI_` 前缀。改名后如果不同步，**用户就能覆盖 `ONE_RUNTIME_TOKEN` / `ONE_BASE_URL`**。
已改成两个前缀都拦，测试补了大小写两种写法。

### 两次「改名把自己的兜底改没了」

批量正则改名会打到**记录旧值的代码本身**，今天中了两次：

1. `legacy_env.rs` 的测试 —— 本来是「设 `AIONUI_DATA_DIR`、断言 `ONE_DATA_DIR` 拿到值」，
   被扫描改成设置和断言同一个变量，测试全绿但什么都没测。
2. `types.rs` 的 `LEGACY_*` 常量 —— 值被改成新名，于是「双注入」变成同一个名字写两遍，
   **旧名兜底整个消失**。这个是靠一个 `count() == 1` 断言碰巧抓到的。

两处都改成 `concat!("AIONUI", "_X")` 构造，未来的字面量扫描碰不到；`types.rs` 另加了个测试
断言两种拼写必须不同。**教训：写完批量改名，要专门回头检查"负责兼容旧值"的那些文件。**

### 仍未改

`AIONUI_LOG_DIR`（skill 文本里）、`AIONUI_FONTS_DIR`、`AIONUI_CHANNEL_SEND`：
全仓扫过没有任何代码设置或解析，只出现在技能文本和一个 bundled JS 里。
改了只有「仓外某处在用」的风险、没有收益。

### 验证

`cargo nextest run --workspace`：**9636 测试全过**（1982s）。
`npx vitest run`：**546 文件 / 5076 测试全过，Unhandled Error 0**。

⚠️ 这两个数字来之不易 —— 中途因为并发跑出过一堆假故障，见下节。

## 13. 测试执行踩的坑（已写进 AGENTS.md）

同一个 `target/` 上叠了 4 个 `cargo test --workspace` 没停，加上还和 vitest 并发，
制造出三种**看起来像产品 bug 的假故障**：

| 症状 | 真相 |
| --- | --- |
| `LNK1104: cannot open file '…-<hash>.exe'` | 另一个 run（或被 kill 后的孤儿测试进程）占着输出文件。链接就挂了，报告显示 `0 ok / 0 failed` |
| `stderr_monitor` / `shutdown_watchdog` 超时 `Elapsed` | CPU 饥饿。空闲机器上单独跑全过 |
| vitest 21 个文件"消失" | worker 起不到，**但仍退出码 0 并报「524 passed」**。546 文件缩到 525，316 个测试没跑 |

规则已写进 `dream-core/AGENTS.md`（新增一节 NEVER run two builds against the same target）、
`dream-ui/AGENTS.md` 和 `.claude/skills/testing/SKILL.md`：

1. 起新的 workspace run 前先停旧的
2. kill 之后要清孤儿测试进程（`cargo` 不一定带走子进程）
3. 不要和 vitest 并发
4. 改了源码就作废当前跑的结果
5. **按文件/用例计数判断，不要只看退出码**

顺带把 `dream-core/AGENTS.md` 里推荐命令从 `cargo test` 换成 `cargo nextest run`
（本机快约 10 倍），并修掉 10 处残留的 `aionui-<crate>` 占位符。
