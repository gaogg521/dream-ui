# 2026-07-28：人设导入(WorkBuddy Claude sub-agent) + Guid 页后端/人设选择器解耦

> **⚠️ 更新（同日晚些时候，架构已再次调整，以此为准）**：下文"一、后端"末尾提到的 AssistantSource 遗留（`'imported'` 被 collapse 成 `'user'`）已修复——加了 `Imported` 枚举变体，四处各自维护的 source 映射全部同步（1oneCore `19461d24`）。**但用 `import_personas` 把 281 个人设直接怼进 `assistant_definitions` 这个做法本身，被用户否决并推翻**：真机验证时用户看到"我的助手"从 5 条变成 286 条，明确要求"不要都挤到我的助手里面，应该单独再建一个表和展示列"。于是新增了完全独立的 `assistant_marketplace_personas` 表 + "专家市场"标签页——281 个人设现在是一个随二进制打包、启动时物化进独立表的可浏览目录，`我的助手` 不受影响，用户点"添加到我的助手"才会调用（同一个）`import_personas` 逻辑生成一条真实助手行。完整设计和真机验证见下方新增的"三、专家市场"章节。之前"直接导入 281 条"那批真机验证数据已用脚本清理干净。1oneCore `52a00adf` / 1oneUI `5749413d7`。

## 背景

用户想把 WorkBuddy 导出的 281 个专家人设（Claude Code sub-agent 格式：YAML frontmatter `name/description/tools` + Markdown 正文系统提示词）接入 One Work，作为可在 App 内直接选用的助手，且要求人设能在 1ONE CLI / Claude Code / Codex CLI 之间通用，不绑定某一个 agent。

调研确认两点：

1. 落点是 Assistant 体系（"选身份开聊"的产品语义），不是 Skill（能力包，不直接可选）。
2. 现有架构不支持"一个助手跨后端通用"——`assistant_definitions.agent_id` 是必填外键，会话创建时无条件采用助手推导出的类型；前端"1ONE CLI / Claude Code / Codex CLI"三个 tab 本质是三个没有人设的裸 CLI 助手，和人设助手混在同一排 pill 里选。

用户确认两条设计取舍：做成永久产品功能（设置页有导入入口）；前端把"选后端"拆成独立常驻的一行切换器，助手列表只列人设。

## 一、后端（1oneCore，commit `ca401c68`）

### 会话创建支持 `conversation_overrides.agent_id`

`AssistantConversationOverridesRequest` 新增 `agent_id: Option<String>`，`aionui-conversation/src/service.rs` 的 `effective_agent_id` 解析优先级改为：`overrides.agent_id` > 助手自身持久化覆盖(`state.agent_id_override`) > 助手默认值(`definition.agent_id`)。无效 id 沿用既有 `resolve_assistant_agent_binding` 返回 `None` 时的 400 路径。3 条 e2e 测试（override 生效/不传回退默认/无效 id 400）。

### `AssistantService::import_personas` + `POST /api/assistants/import-personas`

**关键发现（推翻了计划初稿的假设）**：计划最初设想复用 `rule_inline_content` 字段内联存储系统提示词，但迁移 `029_drop_unused_assistant_definition_fields.sql` 早已把这个字段删了。实际可用机制是已有的 `AssistantService::write_rule(id, locale, content)`——只要 `classify_source(id)` 不是 `Builtin` 就能写，而 `classify_source` 对未知 source 值的 fallback 就是 `_ => AssistantSource::User`，天然兼容新 source 值。

**语义**：按 `id`（同时充当 legacy `assistants` 表主键和 `source_ref`）幂等 upsert——区别于老 `import()`（一次性 Electron 迁移用，插入即跳过，永不覆盖）。实现上复用了 `create()`/`update()`/`import()` 已经在用的"legacy `assistants` 表 → `upsert_definition_from_legacy_user_row` 桥接进 `assistant_definitions`"两段式写入路径，而不是绕开它直接写 `definition_repo`——**这个选择不是随意的**：`delete()`/`set_state()` 对 `AssistantSource::User` 分支的实现要求 legacy 表里必须有对应行（`self.repo.delete(id)`/`self.repo.get(id)` 找不到就 404），如果绕开这条路径直接写 `assistant_definitions`，导入的人设会被创建出来但删不掉。给 `upsert_definition_from_legacy_user_row` 加了一个 `source: &str` 形参（4 个调用点分别传 `"user"`/`"imported"`），`assistant_definitions.source` 新增 `'imported'` 枚举值区别于手写的 `'user'`，但服务层其余所有逻辑（读/改/删/规则分发）不用动，全部落进 `classify_source` 的 `User` fallback 分支。

**迁移 `034_persona_import_assistants.sql`**：SQLite 不支持 `ALTER TABLE ... MODIFY CHECK`，照抄本仓已有先例（迁移 013 的 `_assistants_new` 重建套路）整表重建以放宽 `source` 的 CHECK 约束。

**⚠️ 已知遗留（未修，记录在案）**：`aionui-api-types::AssistantSource`（API 响应枚举，只有 `Builtin/Generated/User` 三个变体）被 `classify_source` 复用于内部分派，同一个类型服务了"内部路径分支"和"对外序列化"两个目的。给它加 `Imported` 变体要同步改 15+ 处 match 分支（真机测试时直接验证到：`GET /api/assistants` 返回的 `source` 字段对导入的人设显示 `"user"`，不是 `"imported"`）。DB 列的 `'imported'` 值本身是真实可用的（upsert-by-id 语义已验证正确），只是没有透传到 API 层——如果后续要在 UI 上把"导入的人设"单独分组展示，需要把这个类型拆成两个（内部分派用 vs 对外序列化用），本轮范围内不做。

7 条新增单测（`import_personas_writes_rule_content_and_tags_source_imported`/`_reimport_overwrites_instead_of_skipping`/`_skips_builtin_collision`/`_fails_on_missing_id` + 3 条 conversation e2e）全绿。

## 二、前端（1oneUI，commit `48e13b256`）

### 人设导入弹窗（设置页永久入口）

`PersonaImportModal.tsx`，仿一键导入 MCP 弹窗（本周之前那轮加的单独勾选交互）：`dialog.showOpen` 多选 `.md` → 新增主进程 IPC `app.read-text-files`（`applicationBridge.ts`，模式抄 `extractRagDocumentFiles`，但不做任何文本抽取转换——frontmatter 必须原样保留，不能走 RAG 那套"抽取干净正文"逻辑）→ `personaImportUtils.ts` 手写 frontmatter 解析器 → 预览列表单独勾选 → `assistants.importPersonas` 批量提交。

**手写解析器而不是引入 YAML 库**：WorkBuddy 源文件的 frontmatter 只有扁平 `key: value` 加偶尔的折叠/字面量块标量（`>-`/`|-`），犯不上上一个 YAML 依赖。真机踩过的坑正是要处理的目标——`a-share-advisor.md` 等大量文件里 `description: >-` 后面直接紧跟下一个 key（没有任何缩进续行），代表折叠块内容为空；解析器识别这个模式后回退取正文首个非标题段落（截断 120 字符）作为 description，而不是把 `>-` 字面量存进去。

### Guid 页拆分"选后端"与"选人设"

`useGuidAssistantSelection.ts` 新增 `selectedBackendAgentId` 状态：默认跟随 `selectedAssistant?.agent_id`（通过 `backendOverriddenRef` 门控的 `useEffect`），用户经 `setSelectedBackendAgentId` 手动选择一次后即视为"显式覆盖"，此后切换人设不再重置它（真机验证：选中"股票专家"人设——其自身默认后端是 Claude——后端切换器仍停留在此前手动选的"1ONE CLI"，未被跳转）；`locationKey` 变化（导航到新会话）时重置覆盖标记。`selectedManagedAgentRuntimeCatalog` 的查找键从 `selectedAssistant.agent_id` 改为 `selectedBackendAgentId`——这一个替换点让下游所有派生状态（model/mode/thought-level/slash commands）全部自动跟着走，不用逐个改。

新增 `BackendSelectionArea.tsx`（常驻，只渲染 `source==='generated'` 的裸 CLI），`GuidPage.tsx` 里 `AssistantSelectionArea` 改传过滤掉裸 CLI 的 `personaAssistants`。`useGuidSend.ts` 的 `assistantOverrides` 新增 `agent_id: selectedBackendAgentId`。

**"未选人设时切后端"这个边界情况**：拆分前，裸 CLI 就是"选后端"本身；拆分后如果只是设 `selectedBackendAgentId` 而不动 `selectedAssistantId`，会出现"选中的助手是旧裸 CLI 身份，但实际跑在新后端上"的名实不符（头像/名字对不上真实运行的后端）。`GuidPage.tsx` 的 `handleSelectBackend` 补了这个分支：仅当当前没有人设或当前就是裸 CLI 时，切后端连带把 `selectedAssistantId` 也切到对应的裸 CLI 助手，保持切换前的行为语义（真机验证：点"1ONE CLI"后端 pill，人设 pill 行始终无高亮，符合预期）。

### `source='imported'` 波及的前端分支（真机会踩到、当场发现修复的）

`AssistantSource` 前端类型只有 `builtin/generated/user` 三值时，`assistantUtils.ts::groupMyAssistants` 按 `source==='user'` 精确匹配把助手分进"我的助手"列表——**导入的人设会因为不满足这个精确匹配而从列表里完全消失**（虽然本轮真机验证到后端 `AssistantSource` 枚举实际把 `'imported'` collapse 成了 `"user"` 对外吐出，这个前端分支眼下不会被触发，但保留这层防御是对的——万一将来后端把 `Imported` 变体补上，前端不用跟着再改一遍）。新增共享 `isMutableAssistantSource()` helper，同时也用于修复另外 3 处按 `source==='user'` 精确匹配的 `canDelete` 判定（不然导入的人设会显示但删不掉）。

## 验证

- 后端：`cargo test -p aionui-assistant`（106 全绿，含新增 7 条）+ `cargo build --workspace`（全量编译过）。
- 前端：`bunx tsc --noEmit`（0 错误）+ `bun run lint:fix`（0 错误，842 条无关预存警告）+ `node scripts/check-i18n.js`（通过，264 条无关预存警告）。
- 真机（重编 `aioncore.exe` release 内嵌 + `bun run dev`，走 CDP 原始 WebSocket 直连渲染进程 `127.0.0.1:9230`，未用 chrome-devtools MCP——它连的是独立浏览器实例，看不到 Electron 窗口）：
  - Guid 页初始渲染：后端切换器 5 个 pill（1ONE CLI/Claude Code/Codex CLI/Cursor/OpenClaw），人设行只有 3 个真实人设（不含裸 CLI）——确认拆分生效且默认状态未变。
  - 点裸 CLI 后端 pill（无人设选中态）→ 人设行保持无高亮（旧"裸 CLI 模式切换即换身份"语义保留）。
  - 选人设"股票专家"→ 再点"1ONE CLI"后端 pill → 再选人设"管家" → 再选回"股票专家"：全程后端切换器停在"1ONE CLI"不跳，人设 pill 正确跟随点击——解耦行为符合设计。
  - 直接对真实开发库调用 `POST /api/assistants/import-personas`：首次导入 `imported:1`；同 id 二次导入（改名改内容）后 `imported:1`（不是 `skipped`，覆盖生效）；`GET` 验证 `rules.content` 是新内容；`DELETE` 成功、二次 `GET` 返回 404——完整 CRUD 链路 + 迁移 034 在真实长期开发库上验证通过；测试数据已清理，未遗留。
  - 未做：native 文件选择对话框本身（CDP 摸不到原生对话框）、真实发消息触达后端 agent（会调真实 CLI 有副作用，判断不必要——`conversation_overrides.agent_id` 的正确性已经在会话创建 e2e 里验证过，Guid 页这端只是把已验证正确的 DOM 状态原样透传）。

## 三、专家市场（Expert Marketplace）——同日晚些时候，架构推翻重做

### 起因

真机验证时用户截图看到"我的助手"从 5 条变成 286 条（含批量导入的 281 个 WorkBuddy 人设），当场要求："我们刚才导入的 workbuddy 专家你不要都挤到'我的助手'里面，应该单独再建一个表和展示列，名字叫做'专家市场'，类似于 workbuddy 的设计。"

调研确认：`builtin`（官方助手）看似"目录"，实则每次启动都物化成 `assistant_definitions` 真实行，和 `imported` 走的是同一张表——照抄这个模式换汤不换药。真正匹配"浏览目录、主动选择才拥有"的架构，是让市场目录**完全独立**于 `assistant_definitions`。WorkBuddy 源数据（`expert-list.md`/`_records.json`/`_meta_map.json`）没有任何分类/标签字段，参考截图里的分类 pill（"OPC·一人公司/腾讯专家/…"）是 WorkBuddy 自己应用内的分类，这份导出数据没带出来——v1 做成搜索 + 网格卡片，不编造分类。

### 后端

新表 `assistant_marketplace_personas`（迁移 035）+ `IAssistantMarketplaceRepository`（`aionui-db`，list/get/upsert_many）。目录内容随二进制打包（新增 `crates/aionui-app/assets/marketplace-personas/personas.json` + `rules/{id}.md`，281 个人设的 name/description/rule_content，照抄 `builtin.rs` 的 `include_dir!` 套路），新模块 `crates/aionui-assistant/src/marketplace.rs` 负责加载 + `materialize_marketplace_personas()`（幂等 upsert，每次启动跑一遍，和 `materialize_builtin_definitions()` 并列调用于 `aionui-app/src/router/state.rs`）——**这意味着全新装机的用户也能看到完整 281 条目录，不是这台机器独有的一次性数据**。

刻意不把 marketplace 逻辑塞进已经 6479 行的 `aionui-assistant/src/service.rs`（AGENTS.md 明文规定 1000 行/文件上限，这个文件已经 6.5 倍超标）——`AssistantRouterState` 新增平级字段 `marketplace_repo`，新路由 `GET /api/assistants/marketplace`（浏览，逐条查 `AssistantService::exists()` 判断 `installed`）+ `POST /api/assistants/marketplace/{id}/install`（安装，读目录条目组一个单元素 `ImportAssistantsRequest` 直接调用**已有的** `import_personas()`——安装就是复用上一轮做完测过的 upsert-by-id 逻辑，没有重新造"变成我自己的助手"这一段）。

顺带修了真机 CDP 验证时发现的遗留：`AssistantSource` 枚举只有 `Builtin/Generated/User` 三个变体，导入的人设在四处分散的字符串→枚举映射里全被 collapse 成 `"user"` 对外吐出（DB 列本身是对的，upsert-by-source_ref 判重靠它，只是没透传到 API）。加 `Imported` 变体后编译器揪出 10 处非穷尽 match 全部按"等同 User"处理，`deletable` 字段判定同步修正，新增回归测试锁死。

### 前端

设置页三个标签从"我的助手/官方"扩成"我的助手/官方/专家市场"（`AssistantHomeTabs.tsx` 的 `HomeTab` 类型三值化，`SettingsPageHeader` 的 `tabs` 数组加第三项）。新组件 `ExpertMarketplaceGrid.tsx`（仿 `OfficialAssistantsGrid.tsx` 的卡片网格布局，去掉不适用的 enable 开关/duplicate 菜单，换成"添加到我的助手"/已安装态"已添加 ✓ + 去对话"）+ 新 hook `useMarketplacePersonas`（独立 SWR key，浏览市场不触碰 `useAssistantList` 的缓存）。侧边栏 "AGENT助手" 同批改名"助手与专家"（13 语言），图标从 `Ghost` 图标换成用户提供的豆包头像（`resources/doubao.png` 复制进 `packages/desktop/src/renderer/assets/icons/doubao.png` 按 Vite asset import 惯例引入；⚠️ 该文件实际字节是 JPEG 但扩展名是 `.png`——保留 `.png` 扩展名不改，因为项目全局类型声明只认 `*.svg`/`*.png` 两种 asset module，改成 `.jpg` 会导致 tsc 报"找不到模块声明"）。

### 数据清理

上一轮批量导入的 281 条 `assistant_definitions` 行（`source='imported'`）用一次性脚本按 id 循环调 `DELETE /api/assistants/{id}` 全部清空——这是本机开发数据清理，不是产品逻辑（全新装机的用户从来没有过这 281 行）。

### 验证

- 后端：新增 7 条测试（`aionui-db` 仓储 CRUD 2 条 + `aionui-assistant` 内嵌加载器 1 条 + `aionui-app` marketplace 路由 e2e 3 条含"浏览不产生真实助手行"的显式断言 + `AssistantSource` API 契约回归 1 条）全绿；`cargo build --workspace` 全量编译通过；`assistants_e2e.rs` 全量 55 条无回归。
- 前端：`tsc`/`lint`/`check-i18n` 全过。
- 真机（重编 release + 内嵌，CDP 原始 WebSocket 直连）：
  - 侧边栏确认渲染豆包头像 + "助手与专家"文案。
  - 设置页三个标签计数：我的助手 7（5 裸 CLI + 2 手写）、官方助手 22、专家市场 281——清理脚本跑完后"我的助手"完全不含误导入的 281 条。
  - 专家市场网格渲染全部 281 张卡片；搜索框输入 "a-share-advisor" 过滤到 1 张；点击该卡片"添加到我的助手"按钮 → 1.5 秒后卡片文案变为"已添加"+"去对话"，直接调后端接口验证确认 `assistant_definitions` 真的多了一行（`source: "imported"`, `deletable: true`）——UI 到后端全链路打通；随后 `DELETE` 清理掉这条测试安装记录，`GET /api/assistants/marketplace` 复核该条目 `installed` 变回 `false`，未在用户环境遗留测试数据。

## 四、专家市场数据源升级（281 条→252 条，真实中文名+角色名+分类+头像）

### 起因

用户通过 WorkBuddy 另外拉到一批更完整的专家数据（同一天但独立于上面"三、专家市场"用的那批），核实后确认可用，明确要求"换成更好数据"。原数据源（`crates/aionui-app/assets/marketplace-personas/personas.json` 旧版）连中文名和头像都没有——id/name 是 `a-share-advisor` 这类通用 kebab-case 标识，`rules/*.md` 没有 frontmatter，真机截图确认卡片全部显示统一机器人占位图标 + 英文标识符。新数据源（WorkBuddy `catalog_data.json` 252 条，`id/prof_zh/role_zh/desc_zh/cat_zh/avatar` 字段齐全）离产品要的"中文名+头像+分类"只差一层数据搬运。

### 后端（`aionui-assistant`/`aionui-db`/`aionui-api-types`）

- **`marketplace.rs`**：`MarketplaceManifestEntry`/`MarketplacePersona` 新增 `display_name`/`role_name`/`category`/`has_avatar` 四个字段；新增 `marketplace_avatar_bytes(id)` 从内嵌 `avatars/{id}.webp` 读字节。**`materialize_marketplace_personas` 补了一步 `repo.delete_missing(&keep_ids)`**——`upsert_many` 是纯 UPSERT，从不删除旧行，直接换 manifest 会让上一代的 281 个 id 变成永久孤儿行（这是本轮踩到的真实教训，不是预防性代码）。
- **迁移 `036_marketplace_persona_display_fields.sql`**：给 `assistant_marketplace_personas` 加 `display_name TEXT`/`role_name TEXT`/`category TEXT`/`has_avatar INTEGER NOT NULL DEFAULT 0`（纯 flag，头像字节不进这张表，走内嵌资源）。`aionui-db` 的 `MarketplacePersonaRow`/`UpsertMarketplacePersonaParams`/`IAssistantMarketplaceRepository`（新增 `delete_missing`）/`sqlite_assistant_marketplace.rs` 同步跟进。
- **`aionui-api-types::MarketplacePersonaResponse`** 加 `display_name`/`role_name`/`category`/`avatar`（`avatar` 是相对路由 `/api/assistants/marketplace/{id}/avatar`，不是字节本身）。`routes.rs` 新增 `GET /api/assistants/marketplace/{id}/avatar`（未安装状态下也能取头像，复用 `get_avatar` 同款 content-type 推断）。
- **`marketplace_install` 的两处关键修正**：①安装时把新建助手的 `name` 换成 `entry.display_name`（不是原来的 `entry.name`）——快捷选择 chip、会话头部等展示面直接渲染 `assistant.name`，不会去读市场卡片的展示层覆盖，不改这行的话装完的助手名字会打回原始 PascalCase id；②`import_personas` 本身刻意不写头像（那是给用户手填路径设计的），安装成功后用新增的 `AssistantService::set_avatar_from_bytes(id, bytes, "webp")` 单独补一刀，把内嵌头像字节写进真正的助手记录（`avatar_type='user_asset'`），让"我的助手"tab 里也能看到同一张头像。
- 数据资产：`personas.json`（`version: "2"`，252 条，`id` 沿用 PascalCase 与个人 `~/.claude/agents` 保持一致可追溯）+ `rules/{id}.md`（去 frontmatter 纯正文）+ `avatars/{id}.webp`（源图 512×512 PNG 用 ffmpeg 压到 128×128 WebP，8 张 SVG 头像该 ffmpeg build 解不了，脚本里 fallback 到 `npx sharp-cli`）。

### 前端

`MarketplacePersona` 类型加对应字段；`ExpertMarketplaceGrid.tsx` 标题从 `persona.name` 改成 `persona.display_name || persona.name`，头像从硬编码 `<Robot/>` 换成 `resolveAvatarImageSrc(persona.avatar)`（同"我的助手"tab 复用的解析逻辑），解析失败才 fallback 机器人图标；搜索匹配同时纳入 `display_name`。`category` 字段已落库但本轮不做分类筛选 UI（范围外，留作后续）。

### 验证

`cargo test -p aionui-assistant -p aionui-db -p aionui-api-types -p aionui-app`（含 `assistants_e2e.rs`）全绿；前端 `tsc`/`lint` 过。真机重编内嵌 + CDP：专家市场标签页从显示 281 张机器人占位卡片变为 252 张真实中文名+头像卡片；点击安装后"我的助手"里的新条目头像正确显示（验证 `set_avatar_from_bytes` 链路）；直接查 SQLite 确认 `assistant_marketplace_personas` 行数收敛到 252，无旧数据孤儿行。

## 五、Guid 页聊天框"+"菜单新增专家选择器（对标 WorkBuddy 交互，纯前端新功能）

### 背景

用户参考竞品 WorkBuddy 的截图，要求聊天输入框也能像 WorkBuddy 一样直接从"+"菜单选专家，而不是必须先去设置页。这条经历了好几轮设计反复，记录取舍而非只记最终态：

1. 最初按用户第一版描述做了"完全去掉旧的选人设 pill 行，只留新加号菜单"，随即被用户打断纠正："保留我们原本的设计，专家的选择可以参考 workbuddy，这样不破坏原来的 UI"——即两种入口并存。
2. 按并存实现后用户又看到截图反悔："为什么这里还有 2 排啊，只要一排啊，跟我们是之前一致即可"——最终**倒回单排**，旧的常驻"选人设"pill 行（`AssistantSelectionArea`）整个从 `GuidPage.tsx` 移除，专家选择完全收进"+"菜单。
3. 后续三轮视觉打磨均由用户主动提出：①"+"按钮加呼吸动效防止用户看不到入口，选中专家要有绿勾+可移除的 chip（同 WorkBuddy 选中态）；②呼吸动效颜色最初用 `var(--primary-6)` 会跟主题混色变不明显，改成固定色 `rgba(255, 158, 0, ...)` 错开主题色调；③选中后的 chip 最初放在输入框上方单独一行（仿文件附件 chip 的位置），用户要求"应该跟加号，模型等这些保持一行"，改为直接渲染进 `GuidActionRow.tsx` 的 `.actionTools` 容器（不在 `GuidInputCard.tsx` 里）。

### 实现

新组件 `GuidExpertPickerGrid.tsx`（`packages/desktop/src/renderer/pages/guid/components/`）：3 列头像网格，默认视图只显示已安装助手，选中态绿勾（`CheckOne`），未安装态"+"角标；底部"召唤更多专家"跳转设置页专家市场 tab（`AssistantNavigationState` 新增 `initialTab`）。`GuidActionRow.tsx` 新增三个 `Menu.SubMenu`（技能/MCP/专家，此前只有技能和 MCP 两个）+ 对应的 `is*SubmenuOpen` 受控状态；选中的人设 chip（头像+名字+×）直接渲染在 `.actionTools` 里，与"+"按钮、模型选择器同一行。`index.module.css` 新增 `plusButtonPulse` 呼吸动画。

## 六、聊天框专家搜索框 IME（中文输入法）闪退 bug 修复

### 现象与定位

用户报告：在"+"菜单的专家搜索框里用中文输入法打字（拼音选字阶段，哪怉只打出第一个候选字母 `g`）会导致整个"+"菜单闪退回普通聊天框；直接粘贴中文文本、或输入英文/数字都不会触发。用户提供的录屏（逐帧分析）把症状从"整个菜单消失"精确定位到：**外层"+"Dropdown 保持展开，但内层 `Menu.SubMenu`（专家市场/技能/MCP 各自的搜索+网格弹层）自己collapse 收起**——回退成只看到平铺的"+"一级菜单。

### 修复

`GuidActionRow.tsx` 把三个 `Menu.SubMenu` 的 `triggerProps.popupVisible` 从 Arco 内部管理改为完全受控状态（`isSkillSubmenuOpen`/`isMcpSubmenuOpen`/`isExpertSubmenuOpen`），并加了两层"忽略此次关闭"的判定：

1. **第一轮（focus 检测）**：`ignoreCloseWhileSearchFocused` 检查 `document.activeElement` 是不是三个搜索框之一，是则拒绝这次 `onVisibleChange(false)`。
2. **第二轮（组合输入事件检测，更可靠）**：focus 检测存在竞态——IME 候选框弹出时输入框可能有一瞬的 blur，`document.activeElement` 检查的时机不对就会漏判。改成在 `GuidActionRow` 根节点监听原生 `compositionstart`/`compositionend`（合成事件按 React 组件树冒泡，即使弹层本身通过 portal 挂在别处的 DOM 节点，事件仍会冒泡到根节点的 handler），用一个 `isComposingRef` 覆盖整段合成期间（`compositionstart`→`compositionend`）——这段时间内任何"想关闭"的尝试一律忽略，不依赖任何时间点的 focus 快照。

用户真机手工测试确认修复生效（本轮 CDP 合成事件模拟对这个场景验证力有限，最终判据是用户自己的真实 IME 操作）。

## 七、专家市场搜索范围打通（Guid 页 + 团队创建/添加成员）+ 搜索结果计数动态化

### 起因

用户在验证上面第六节 IME 修复时顺带发现："+"菜单的专家搜索（和"团队"页新建团队/添加成员的助手搜索）只能搜到已安装的助手（"我的助手"+"官方助手"，共 35 条），搜不到完整的 252 条专家市场目录——例如搜"安全"搜不到专家市场里带"安全"关键字的专家，但设置页专家市场 tab 自己的搜索能搜到。根因：搜索数据源只接了 `personaAssistants`（installed 列表），没有接 `useMarketplacePersonas()` 的完整目录。

### 修复

**Guid 页**（`GuidExpertPickerGrid.tsx`）：新增 `marketplacePersonas` prop，搜索时把已安装匹配（按 `assistants`）和市场匹配（按 `marketplacePersonas`，同时匹配 `display_name`/`description`）按 id 合并（已安装优先），未安装的条目点击触发 `onInstallAndSelect`（先装后选，一步到位）而不是 `onSelect`。`GuidPage.tsx` 新增 `handleInstallAndSelectPersona`：调 `useMarketplacePersonas().install()` → `refreshManagedAgentCatalogAndAssistants()` 刷新已安装列表 → `agentSelection.setSelectedAssistantId(id)`。

**团队页**（新建团队弹窗桌面/窄屏两种布局 + 已有团队"添加成员"弹窗，三处入口共用同一个 `TeamAssistantPicker.tsx`，改一处三处生效）：`assistantSelectUtils.tsx` 新增 `TeamAssistantOption.installed` 字段 + `marketplacePersonaToOption()` + `mergeWithMarketplaceMatches()`（同一套合并算法，独立实现——`TeamAssistantOption` 与 Guid 页用的 `Assistant`/`PickerEntry` 是完全不同的类型，没有强行复用一套通用逻辑）。`TeamAssistantPicker.tsx`/`TeamAssistantPickerDropdown.tsx` 透传 `marketplacePersonas`/`onInstallAndSelect`；`TeamCreateModal.tsx`/`TeamAddMemberPopover.tsx` 各自实现 `handleInstallAndSelectAssistant`（`installMarketplacePersona(id)` 拿到刚装好的 `Assistant` → 直接 `assistantToOption()` 转换 → 走原有的选中/添加逻辑，不必等 SWR 刷新完成再反查）。

**顺带修的计数标题失真**：`TeamCreateModal.tsx` 左栏标题"所有助手 (35)"是固定的已安装总数，搜索命中市场结果时这个数字不会变，看起来像"搜索范围还是只有 35 个"。`TeamAssistantPicker.tsx` 新增 `onResultsChange` 回调（`useEffect` 上报当前 `query`/结果数），父组件按有无搜索词切换标题文案：无搜索词显示"所有助手 (N)"，有搜索词显示"找到 N 个结果"（新 i18n key `team.create.searchResultsWithCount`，13 语言齐全）。

新增 i18n key（13 语言齐全）：`team.create.marketplaceInstallHint`（未安装条目的 title 提示）、`team.create.searchResultsWithCount`。

### 验证

`tsc`/`lint`（0 错误，842 条无关预存警告）/`check-i18n` 全过。真机 CDP：Guid 页搜"安全"命中与设置页专家市场搜索完全一致的结果集，点击未安装的"软件工坊"→ 自动安装并选中，chip 正确显示；团队创建弹窗同样搜"安全"命中一致结果集，点击未安装的"安全工程师"成功以 Leader 身份加入草稿列表（用户随后用它实际建了一个"安全测试"团队，两个市场安装的专家都成功唤醒会话——冷启动 attach 各花费 16-19 秒，属于团队会话首次拉起进程的固有开销，与本轮搜索/安装逻辑改动无关，未在本轮范围内处理）。
